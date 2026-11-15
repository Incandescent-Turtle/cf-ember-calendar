"""Reference harmonization (HARMONIZATION.md step 4). Twin of web/src/lib/harmonize.ts.

    H(t) = k[m] * MODIS(t)        t <  first dekad of 2012-02
    H(t) = VIIRS_SNPP(t)          up to the dekad before the one containing snpp_end
    H(t) = k_N20[m] * NOAA20(t)   from the dekad containing snpp_end

k per calendar month comes from the AOI's own overlap sums if they reach min_modis_fcd,
else the MODIS-FCD-weighted mean of the AOI's tile ks, else global, else the sparse AOI
ratio ("aoi-sparse", only when there is no calibration file), else none.
Input/output shapes follow the TS code, so golden cases can be fed to both.
"""

from __future__ import annotations

import datetime as dt
import math

import numpy as np

from pipeline import grid
from pipeline.calibrate import N20_FIT, S_MODIS, S_N20, S_SNPP, fit_ratio

SWITCH_DATE = "2012-02-01"


def _t(date: str) -> int:
    return grid.dekad_index(dt.date.fromisoformat(date))


def _finite(x) -> bool:
    return x is not None and math.isfinite(x)


def choose_k(aoi_fit: dict, per_tile_den: list[tuple[str, np.ndarray]], tile_blocks: dict | None,
             global_block: dict | None, min_den: float) -> list[dict]:
    out = []
    for m in range(12):
        k, den = aoi_fit["k"][m], aoi_fit["den"][m]
        if den >= min_den and math.isfinite(k):
            out.append({"k": k, "lo": aoi_fit["lo"][m], "hi": aoi_fit["hi"][m], "stratum": "aoi"})
            continue
        if tile_blocks:
            usable = [(tl, d) for tl, d in per_tile_den
                      if tl in tile_blocks and _finite(tile_blocks[tl]["k"][m])
                      and (tile_blocks[tl].get("n_modis") or [min_den] * 12)[m] >= min_den]
            if usable:
                w = sum(d[m] for _, d in usable)

                def agg(key: str, usable=usable, w=w, m=m) -> float:
                    return sum((d[m] / w if w > 0 else 1 / len(usable)) * tile_blocks[tl][key][m]
                               for tl, d in usable)

                out.append({"k": agg("k"), "lo": agg("lo"), "hi": agg("hi"), "stratum": "tile",
                            "tiles": [tl for tl, _ in usable]})
                continue
        if global_block and _finite(global_block["k"][m]):
            out.append({"k": global_block["k"][m], "lo": global_block["lo"][m],
                        "hi": global_block["hi"][m], "stratum": "global"})
            continue
        if den > 0 and math.isfinite(k):
            out.append({"k": k, "lo": aoi_fit["lo"][m], "hi": aoi_fit["hi"][m],
                        "stratum": "aoi-sparse"})
            continue
        out.append({"k": math.nan, "lo": math.nan, "hi": math.nan, "stratum": "none"})
    return out


def harmonize(per_tile: np.ndarray, tiles: list[str], t0: int, manifest: dict,
              cal: dict | None) -> dict:
    """per_tile: (n_tiles, 4, nT) dekad FCD from t0. Returns k tables and monthly rows."""
    per_tile = np.asarray(per_tile, dtype=float)
    n_t = per_tile.shape[2]
    tot = per_tile.sum(axis=0)
    M, V, N = tot[S_MODIS], tot[S_SNPP], tot[S_N20]
    t_switch = _t(SWITCH_DATE)
    t_n20 = _t(manifest["snpp_end"])
    t_ov_a, t_ov_b = _t(manifest["overlap"]["start"]), _t(manifest["overlap"]["end"])
    t_na = _t(N20_FIT[0])
    t_nb = min(_t(N20_FIT[1]), t_n20 - 1)
    min_den = manifest["min_modis_fcd"]

    def per_tile_sums(s: int, t_a: int, t_b: int):
        res = []
        for i, tl in enumerate(tiles):
            den = np.zeros(12)
            for t in range(max(t_a, t0), min(t_b, t0 + n_t - 1) + 1):
                den[grid.dekad_month(t)] += per_tile[i, s, t - t0]
            res.append((tl, den))
        return res

    cal = cal or {}
    k_modis = choose_k(fit_ratio(V, M, t0, t_ov_a, t_ov_b), per_tile_sums(S_MODIS, t_ov_a, t_ov_b),
                       cal.get("tile"), cal.get("global"), min_den)
    n20 = cal.get("n20") or {}
    k_n20 = choose_k(fit_ratio(V, N, t0, t_na, t_nb), per_tile_sums(S_N20, t_na, t_nb),
                     n20.get("tile"), n20.get("global"), min_den)

    y0 = 2000 + t0 // 36
    y1 = 2000 + (t0 + n_t - 1) // 36
    years = list(range(y0, y1 + 1))
    rows: list[dict | None] = [None] * (len(years) * 12)
    dekads = []  # dekadal harmonized values, for month-to-date
    for i in range(n_t):
        t = t0 + i
        year, month = 2000 + t // 36, grid.dekad_month(t)
        idx = (year - y0) * 12 + month
        era = "modis" if t < t_switch else "snpp" if t < t_n20 else "n20"
        row = rows[idx]
        if row is None:
            row = rows[idx] = {
                "year": year, "month": month, "modis": 0.0, "snpp": 0.0, "n20": 0.0,
                "viirs": 0.0, "spliced": 0.0, "harmonized": 0.0, "lo": 0.0, "hi": 0.0,
                "era": era, "stratum": None if era == "snpp" else
                (k_modis if era == "modis" else k_n20)[month]["stratum"],
                "partial": False, "n_dekads": 0}
        m, v, n = M[i], V[i], N[i]
        row["modis"] += m
        row["snpp"] += v
        row["n20"] += n
        row["n_dekads"] += 1
        if era == "modis":
            k = k_modis[month]
            h, lo, hi = k["k"] * m, k["lo"] * m, k["hi"] * m
            row["viirs"] += v
            row["spliced"] += m
        elif era == "snpp":
            h = lo = hi = v
            row["viirs"] += v
            row["spliced"] += v
        else:
            k = k_n20[month]
            h, lo, hi = k["k"] * n, k["lo"] * n, k["hi"] * n
            row["viirs"] += n
            row["spliced"] += n
        row["harmonized"] += h
        row["lo"] += lo
        row["hi"] += hi
        dekads.append(h)
    for r in rows:
        if r is not None:
            r["partial"] = r["n_dekads"] < 3
    return {"years": years, "rows": rows, "k_modis": k_modis, "k_n20": k_n20,
            "t_switch": t_switch, "t_n20": t_n20, "t0": t0, "dekads": np.array(dekads)}


def month_percentile(h: dict, month: int, value: float, exclude_year: int) -> float:
    """Mid-rank percentile among complete same-month years, excluding exclude_year
    (twin of monthPercentile in harmonize.ts)."""
    base = []
    for y in h["years"]:
        if y == exclude_year:
            continue
        r = h["rows"][(y - h["years"][0]) * 12 + month]
        if r is not None and not r["partial"] and math.isfinite(r["harmonized"]):
            base.append(r["harmonized"])
    if not base or not math.isfinite(value):
        return math.nan
    below = sum(b < value for b in base)
    eq = sum(b == value for b in base)
    return 100 * (below + 0.5 * eq) / len(base)
