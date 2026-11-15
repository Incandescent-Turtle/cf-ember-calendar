"""Downloadable global harmonized table (CONTRACTS.md -> Global harmonized table).

Monthly harmonized hotspot activity per 1-degree cell for the whole record, from the existing
build only (read-only): processed/cube/l10/global.bin.gz + calibration.json + manifest.json.

Each 1-degree cell is treated exactly like an area drawn in the browser that covers that cell:
the same eras, the same k choice (the cell's own overlap fit if it reaches min_modis_fcd, else
its 10-degree tile's k, else global), the same year bootstrap for the band. So a row equals the
calendar CSV row the app exports for that cell (pipeline/harmonize.py is the reference twin of
web/src/lib/harmonize.ts; tests/pipeline/test_export_global.py checks rows against it).

Only cell-months with some raw activity (MODIS, S-NPP or NOAA-20 FCD > 0) are written; a missing
cell-month means 0 in every column. `percentile` from the calendar CSV is left out (it is relative
to an area's own history and the current year; recompute it from the table if needed).

    uv run python -m pipeline.export_global --data-dir D:/ember --out data/exports
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np
import polars as pl

from pipeline import grid
from pipeline.calibrate import N20_FIT, S_MODIS, S_N20, S_SNPP, fit_ratio
from pipeline.cubes import read_cube
from pipeline.harmonize import SWITCH_DATE

log = logging.getLogger("pipeline.export_global")

BASENAME = "global_harmonized_monthly_1deg"
CHUNK = 2000  # cells per batch: 2000 x 3 series x ~940 dekads x 8 B ~ 45 MB

COLUMNS = [
    "cell", "lon_center", "lat_center", "tile",
    "year", "month", "harmonized", "harmonized_lo", "harmonized_hi", "modis_fcd", "viirs_fcd",
    "k", "k_stratum", "k_lo", "k_hi", "snpp_fcd", "n20_fcd", "era", "partial", "n_dekads", "k_source",
]
STRATA = ["aoi", "tile", "global", "aoi-sparse", "none"]  # codes 0..4, as in harmonize.choose_k


def _t(date: str) -> int:
    return grid.dekad_index(dt.date.fromisoformat(date))


def _arr(block: dict | None, key: str) -> np.ndarray:
    """calibration.json list (null = undefined) -> float array of 12."""
    if not block or block.get(key) is None:
        return np.full(12, np.nan)
    return np.array([np.nan if v is None else float(v) for v in block[key]])


def choose_k_cells(fit: dict, tiles: list[str], tile_blocks: dict | None, global_block: dict | None,
                   min_den: float) -> dict:
    """Vectorized harmonize.choose_k for single-cell areas (one tile each).

    With one tile, the MODIS-weighted mean over tiles is just that tile's k. Returns arrays
    (nCells, 12): k, lo, hi, den and stratum codes (index into STRATA)."""
    n = len(tiles)
    k, lo, hi, den = (np.array(fit[key], dtype=float).reshape(n, 12) for key in ("k", "lo", "hi", "den"))
    out_k, out_lo, out_hi = np.full((n, 12), np.nan), np.full((n, 12), np.nan), np.full((n, 12), np.nan)
    stratum = np.full((n, 12), 4, dtype=np.int8)
    todo = np.ones((n, 12), dtype=bool)

    def take(mask: np.ndarray, code: int, kk, ll, hh) -> None:
        sel = mask & todo
        out_k[sel], out_lo[sel], out_hi[sel] = np.broadcast_to(kk, (n, 12))[sel], \
            np.broadcast_to(ll, (n, 12))[sel], np.broadcast_to(hh, (n, 12))[sel]
        stratum[sel] = code
        todo[sel] = False

    take((den >= min_den) & np.isfinite(k), 0, k, lo, hi)
    if tile_blocks:
        tk, tl, th = (np.full((n, 12), np.nan) for _ in range(3))
        usable = np.zeros((n, 12), dtype=bool)
        for i, tile in enumerate(tiles):
            b = tile_blocks.get(tile)
            if not b:
                continue
            tk[i], tl[i], th[i] = _arr(b, "k"), _arr(b, "lo"), _arr(b, "hi")
            nm = np.array(b["n_modis"], dtype=float) if b.get("n_modis") else np.full(12, min_den)
            usable[i] = np.isfinite(tk[i]) & (nm >= min_den)
        take(usable, 1, tk, tl, th)
    gk, gl, gh = _arr(global_block, "k"), _arr(global_block, "lo"), _arr(global_block, "hi")
    take(np.broadcast_to(np.isfinite(gk), (n, 12)), 2, gk, gl, gh)
    take((den > 0) & np.isfinite(k), 3, k, lo, hi)
    return {"k": out_k, "lo": out_lo, "hi": out_hi, "den": den, "stratum": stratum}


def _source(code: int, den: float, tile: str, fit_label: str, den_label: str) -> str:
    """k_source as the calendar CSV writes it (ASCII), with "this cell" for "this area"."""
    if code == 0:
        return f"this cell, {fit_label} ({round(den):,} {den_label})"
    if code == 1:
        return f"10 deg tile {tile}"
    if code == 2:
        return "global"
    if code == 3:
        return f"this cell, sparse ({round(den):,} {den_label}; no calibration file)"
    return "no calibration available"


def harmonize_cells(fcd: np.ndarray, tiles: list[str], t0: int, manifest: dict, cal: dict | None) -> dict:
    """fcd: (nCells, 3, nT) dekad FCD (MODIS, S-NPP, NOAA-20) from t0.

    Returns per-cell k tables and monthly arrays (nCells, nMonths) plus the month axis."""
    n_c, _, n_t = fcd.shape
    M, V, N = fcd[:, S_MODIS], fcd[:, S_SNPP], fcd[:, S_N20]
    t_switch, t_n20 = _t(SWITCH_DATE), _t(manifest["snpp_end"])
    t_ov_a, t_ov_b = _t(manifest["overlap"]["start"]), _t(manifest["overlap"]["end"])
    t_na, t_nb = _t(N20_FIT[0]), min(_t(N20_FIT[1]), t_n20 - 1)
    min_den = manifest["min_modis_fcd"]
    cal = cal or {}
    n20 = cal.get("n20") or {}
    km = choose_k_cells(fit_ratio(V, M, t0, t_ov_a, t_ov_b), tiles, cal.get("tile"), cal.get("global"), min_den)
    kn = choose_k_cells(fit_ratio(V, N, t0, t_na, t_nb), tiles, n20.get("tile"), n20.get("global"), min_den)

    t = np.arange(t0, t0 + n_t)
    mon = (t // 3) % 12
    era = np.where(t < t_switch, 0, np.where(t < t_n20, 1, 2))  # 0 modis, 1 snpp, 2 n20
    is_m, is_s, is_n = era == 0, era == 1, era == 2
    h, lo, hi = np.zeros((n_c, n_t)), np.zeros((n_c, n_t)), np.zeros((n_c, n_t))
    for key, dst in (("k", h), ("lo", lo), ("hi", hi)):
        dst[:, is_m] = km[key][:, mon[is_m]] * M[:, is_m]
        dst[:, is_s] = V[:, is_s]
        dst[:, is_n] = kn[key][:, mon[is_n]] * N[:, is_n]
    viirs = np.where(is_n, N, V)
    spliced = np.where(is_m, M, np.where(is_s, V, N))

    # dekads -> months (contiguous runs of the same (year, month))
    midx = (t // 36) * 12 + mon
    starts = np.flatnonzero(np.r_[True, midx[1:] != midx[:-1]])
    red = lambda a: np.add.reduceat(a, starts, axis=1)
    return {
        "k_modis": km, "k_n20": kn,
        "year": 2000 + t[starts] // 36, "month": mon[starts], "era": era[starts],
        "n_dekads": np.diff(np.r_[starts, n_t]),
        "modis": red(M), "snpp": red(V), "n20": red(N), "viirs": red(viirs), "spliced": red(spliced),
        "harmonized": red(h), "lo": red(lo), "hi": red(hi),
    }


def _rows(res: dict, cells: np.ndarray, tiles: list[str], manifest: dict) -> pl.DataFrame:
    raw = res["modis"] + res["snpp"] + res["n20"]
    ci, mi = np.nonzero(raw > 0)
    year, month, era = res["year"][mi], res["month"][mi], res["era"][mi]
    snpp = res["snpp"][ci, mi]
    # the calendar's viirs_fcd: undefined before 2012 and in Jan 2012 without S-NPP data
    viirs = np.where((year < 2012) | ((year == 2012) & (month == 0) & (snpp == 0)), np.nan, res["viirs"][ci, mi])
    km, kn = res["k_modis"], res["k_n20"]
    k_tab = {key: np.where(era == 0, km[key][ci, month], np.where(era == 2, kn[key][ci, month], 1.0))
             for key in ("k", "lo", "hi")}
    code = np.where(era == 0, km["stratum"][ci, month], np.where(era == 2, kn["stratum"][ci, month], -1))
    den = np.where(era == 0, km["den"][ci, month], kn["den"][ci, month])
    ov = f"{manifest['overlap']['start'][:4]}-{manifest['overlap']['end'][:4]}"
    n20_label = f"{N20_FIT[0][:7]} -> {N20_FIT[1][:7]}"
    cache: dict[tuple, str] = {}
    sources = []
    for c, e, cd, d in zip(ci.tolist(), era.tolist(), code.tolist(), den.tolist()):
        if e == 1:
            sources.append("VIIRS S-NPP (reference series)")
            continue
        key = (c, e, cd, d) if cd in (0, 3) else (tiles[c] if cd == 1 else "", cd)
        if key not in cache:
            cache[key] = _source(cd, d, tiles[c], ov if e == 0 else n20_label,
                                 "MODIS FCD" if e == 0 else "NOAA-20 FCD")
        sources.append(cache[key])
    cell = cells[ci]
    w, s = cell % 360 - 180, cell // 360 - 90
    return pl.DataFrame({
        "cell": cell.astype(np.int32),
        "lon_center": (w + 0.5).astype(np.float32),
        "lat_center": (s + 0.5).astype(np.float32),
        "tile": [tiles[c] for c in ci.tolist()],
        "year": year.astype(np.int16),
        "month": (month + 1).astype(np.int8),
        "harmonized": res["harmonized"][ci, mi],
        "harmonized_lo": res["lo"][ci, mi],
        "harmonized_hi": res["hi"][ci, mi],
        "modis_fcd": res["modis"][ci, mi].astype(np.int32),
        "viirs_fcd": viirs,
        "k": k_tab["k"], "k_stratum": [("reference" if e == 1 else STRATA[cd]) for e, cd in zip(era.tolist(), code.tolist())],
        "k_lo": k_tab["lo"], "k_hi": k_tab["hi"],
        "snpp_fcd": np.where(year < 2012, np.nan, snpp),
        "n20_fcd": res["n20"][ci, mi].astype(np.int32),
        "era": np.array(["modis", "snpp", "n20"])[era],
        "partial": res["n_dekads"][mi] < 3,
        "n_dekads": res["n_dekads"][mi].astype(np.int8),
        "k_source": sources,
    }).with_columns(pl.col(pl.Float64).fill_nan(None))


def load_inputs(processed: Path) -> tuple[dict, dict | None, np.ndarray, np.ndarray, int, int]:
    """manifest, calibration, active L10 cells, dense (nCells, 3, nT) FCD, t0, nT."""
    manifest = json.loads((processed / "manifest.json").read_text(encoding="utf-8"))
    cal_path = processed / "calibration.json"
    cal = json.loads(cal_path.read_text(encoding="utf-8")) if cal_path.exists() else None
    cube = read_cube(processed / manifest["l10"])
    t0, t1 = manifest["dekad_range"]
    n_t = t1 - t0 + 1
    keep = (cube.s <= S_N20) & (cube.t >= t0) & (cube.t <= t1)
    s, t, c, v = (a[keep].astype(np.int64) for a in (cube.s, cube.t, cube.c, cube.v))
    cells, ci = np.unique(c, return_inverse=True)
    fcd = np.zeros((len(cells), 3, n_t), dtype=np.float32)  # exact for these integer counts; float64 per chunk
    np.add.at(fcd, (ci, s, t - t0), v)
    return manifest, cal, cells, fcd, t0, n_t


def tile_of_l10(c: int) -> str:
    return grid.tile_id_from_index((c // 360) // 10, (c % 360) // 10)


def export(processed: Path, out: Path) -> dict:
    started = time.time()
    manifest, cal, cells, fcd, t0, n_t = load_inputs(processed)
    tiles = [tile_of_l10(int(c)) for c in cells]
    log.info("L10: %d active 1-degree cells, %d dekads from %d; totals MODIS %d, S-NPP %d, NOAA-20 %d",
             len(cells), n_t, t0, *(int(fcd[:, i].sum(dtype=np.float64)) for i in range(3)))
    frames = []
    for a in range(0, len(cells), CHUNK):
        b = min(a + CHUNK, len(cells))
        res = harmonize_cells(fcd[a:b].astype(np.float64), tiles[a:b], t0, manifest, cal)
        frames.append(_rows(res, cells[a:b], tiles[a:b], manifest))
        log.info("cells %d-%d: %d rows", a, b, frames[-1].height)
    df = pl.concat(frames).sort(["cell", "year", "month"])
    out.mkdir(parents=True, exist_ok=True)
    pq = out / f"{BASENAME}.parquet"
    csv = out / f"{BASENAME}.csv.gz"
    df.write_parquet(pq, compression="zstd", compression_level=9, statistics=True)
    # CSV like the calendar CSV: 4 decimals, empty = undefined, true/false
    text = df.with_columns(pl.col(pl.Float64).round(4)).write_csv(float_precision=None, null_value="")
    with open(csv, "wb") as fh, gzip.GzipFile(filename="", fileobj=fh, mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(text.encode("ascii"))
    # totals must match the cube exactly (raw) and the sum of the parts (harmonized)
    stats = {
        "rows": df.height,
        "cells": int(df["cell"].n_unique()),
        "years": [int(df["year"].min()), int(df["year"].max())],
        "raw_totals": {"modis": int(df["modis_fcd"].sum()), "snpp": int(df["snpp_fcd"].fill_null(0).sum()),
                       "n20": int(df["n20_fcd"].sum())},
        "cube_totals": {k: int(fcd[:, i].sum(dtype=np.float64)) for i, k in enumerate(("modis", "snpp", "n20"))},
        "harmonized_total": float(df["harmonized"].sum()),
        "strata": dict(df.group_by("k_stratum").len().iter_rows()),
        "bytes": {"parquet": pq.stat().st_size, "csv_gz": csv.stat().st_size},
        "seconds": round(time.time() - started, 1),
    }
    write_readme(out, manifest, stats)
    (out / f"{BASENAME}.stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    log.info("export: %s", json.dumps(stats))
    return stats


def write_readme(out: Path, manifest: dict, stats: dict) -> None:
    t0, t1 = manifest["dekad_range"]
    first, last = grid.dekad_range(t0)[0], grid.dekad_range(t1)[1]
    text = f"""# Global harmonized hotspot activity, monthly, 1 degree

Files: `{BASENAME}.parquet` (zstd) and `{BASENAME}.csv.gz` (same columns, ASCII, header row).
Built from the Ember Calendar data build of {manifest['built_at']} (record {first} to {last}; the
last dekad and month may be partial). {stats['rows']:,} rows, {stats['cells']:,} 1-degree cells.

## Unit: VIIRS-equivalent fire-cell-days (FCD)

A **fire-cell-day** is one 0.01-degree cell (about 1 km) with at least one cleaned satellite hotspot
on one UTC day (NASA FIRMS; vegetation fires only, low-confidence detections removed). Several
detections in the same cell and day count once, so the unit depends far less on pixel size than
detection counts. **VIIRS-equivalent** means the series is expressed on the scale of VIIRS S-NPP:

- before 2012-02: MODIS FCD x k (k = MODIS -> VIIRS ratio of sums per calendar month, fitted on
  {manifest['overlap']['start'][:4]}-{manifest['overlap']['end'][:4]});
- 2012-02 until the dekad before {manifest['snpp_end']}: VIIRS S-NPP FCD as is (the reference series);
- from the dekad containing {manifest['snpp_end']}: VIIRS NOAA-20 FCD x k_N20 (NOAA-20 -> S-NPP).

These are counts of hotspot activity, not numbers of fires and not burned area.

## Rows and columns

One row per 1-degree cell and month **with any raw activity**. A cell-month that is missing has 0 in
every column. The values equal what the Ember Calendar app computes, and exports as its calendar CSV,
for an area covering exactly that cell. The column names and meanings are the calendar CSV's
(docs/CONTRACTS.md), plus the cell columns. `percentile` is left out (relative to an area's history).

| column | meaning |
|---|---|
| cell | 1-degree cell id = row x 360 + col, row = floor(lat + 90), col = floor(lon + 180) |
| lon_center, lat_center | cell centre, degrees WGS84 |
| tile | 10-degree tile containing the cell (e.g. S30W070), the stratum for tile k |
| year, month | calendar month, month 1-12 (UTC) |
| harmonized | harmonized hotspot activity, VIIRS-equivalent FCD |
| harmonized_lo, harmonized_hi | the same with k at its 5th / 95th bootstrap percentile |
| modis_fcd | raw MODIS FCD (Terra + Aqua), whole record |
| viirs_fcd | raw VIIRS FCD: S-NPP before the NOAA-20 switch, NOAA-20 after; empty before 2012 |
| k | factor applied this month (1 in the S-NPP era) |
| k_stratum | where k comes from: aoi (this cell's own overlap, >= {manifest['min_modis_fcd']} FCD in the denominator), tile, global, aoi-sparse, none, or reference (S-NPP era) |
| k_lo, k_hi | bootstrap 5th / 95th percentile of k (200 year resamples) |
| snpp_fcd, n20_fcd | raw VIIRS S-NPP / NOAA-20 FCD (snpp empty before 2012) |
| era | modis, snpp or n20: which series the harmonized value comes from |
| partial | true if fewer than 3 dekads of the month are in the record |
| n_dekads | dekads (10-day periods) of the month in the record |
| k_source | human-readable source of k ("this cell, ..." = "this area" in the app) |

Empty / null = undefined (e.g. no k available for that month). Numbers in the CSV are rounded to
4 decimals; the Parquet file keeps full precision. Sums over cells are exact for the raw columns;
harmonized sums over several cells differ from the app's value for the combined area whenever the
cells' k differ (the app fits one k for the whole drawn area).

Method: docs/HARMONIZATION.md and the app's Methodology page (validation, seam test).

## Acknowledgement and licence

Source data: NASA FIRMS active fire detections, MODIS Collection 6.1 (MCD14ML / MCD14DL; Terra,
Aqua) and VIIRS 375 m (VNP14IMG, Suomi NPP; VJ114IMG, NOAA-20). "We acknowledge the use of imagery
from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and
Information System (ESDIS)." NASA Earth science data are open, with no restrictions on use.

This derived table: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the code that makes it
is MIT (repository LICENSE). When you use it, cite "Ember Calendar harmonized MODIS + VIIRS
hotspot activity" and NASA FIRMS.
"""
    (out / "README.md").write_text(text, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, required=True, help="build root (reads <data-dir>/processed)")
    ap.add_argument("--out", type=Path, default=Path("data/exports"), help="output directory (not the build)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        datefmt="%H:%M:%S", stream=sys.stdout)
    processed = args.data_dir / "processed"
    if args.out.resolve().is_relative_to(args.data_dir.resolve()):
        ap.error("--out must be outside --data-dir (the build is read-only)")
    export(processed, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
