"""Global harmonized table (pipeline/export_global.py).

1. Against the golden harmonize cases (what web/src/lib/harmonize.ts computes): every single-tile
   case fed through the vectorized per-cell code gives the same k tables and monthly rows.
2. End to end on a small synthetic build: every exported row equals pipeline.harmonize for an area
   covering that cell, raw totals equal the cube, the CSV matches the Parquet file.
3. On the real fixture build (data/processed), when present.
"""

import gzip
import io
import json
import math
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from pipeline import cubes, grid
from pipeline import export_global as eg
from pipeline.harmonize import harmonize

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = json.loads((ROOT / "tests/golden/harmonize_cases.json").read_text(encoding="utf-8"))
TOL = GOLDEN["tolerance"]
STRATUM_KEYS = {"aoi": 0, "tile": 1, "global": 2, "aoi-sparse": 3, "none": 4}


def close(a, b) -> bool:
    if a is None or b is None or (isinstance(a, float) and math.isnan(a)) or (isinstance(b, float) and math.isnan(b)):
        na = a is None or math.isnan(a)
        nb = b is None or math.isnan(b)
        return na and nb
    return math.isclose(a, b, rel_tol=TOL["rel"], abs_tol=TOL["abs"])


@pytest.mark.parametrize("case", [c for c in GOLDEN["cases"] if len(c["input"]["tiles"]) == 1],
                         ids=lambda c: c["name"])
def test_matches_golden_single_tile_cases(case):
    inp, exp = case["input"], case["expected"]
    n_t, t0 = inp["nT"], inp["t0"]
    series = np.array(inp["perTile"][0], dtype=float).reshape(-1, n_t)[:3]
    res = eg.harmonize_cells(series[None], inp["tiles"], t0, inp["manifest"], inp["calibration"])
    for key, table in (("kModis", res["k_modis"]), ("kN20", res["k_n20"])):
        for m in range(12):
            e = exp[key][m]
            assert eg.STRATA[table["stratum"][0, m]] == e["stratum"], (key, m)
            for f in ("k", "lo", "hi"):
                assert close(float(table[f][0, m]), e[f]), (key, m, f)
    rows = [r for r in exp["rows"] if r is not None]
    assert len(rows) == len(res["year"])
    for j, r in enumerate(rows):
        assert (res["year"][j], res["month"][j]) == (r["year"], r["month"])
        assert ["modis", "snpp", "n20"][res["era"][j]] == r["era"]
        assert res["n_dekads"][j] == r["nDekads"]
        for f in ("modis", "snpp", "n20", "viirs", "spliced", "harmonized", "lo", "hi"):
            assert close(float(res[f][0, j]), r[f]), (r["year"], r["month"], f)


# ------------------------------------------------------------------ synthetic build
def _manifest(t0: int, t1: int) -> dict:
    return {"version": 1, "built_at": "2026-11-15T00:00:00Z", "dekad_range": [t0, t1],
            "series": cubes.SERIES_NAMES, "tiles": ["S30W070", "S30W060"], "l10": "cube/l10/global.bin.gz",
            "overlap": {"start": "2013-01-01", "end": "2021-12-31"}, "snpp_end": "2026-11-02",
            "min_modis_fcd": 200}


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory):
    root = tmp_path_factory.mktemp("export")
    processed = root / "processed"
    t0, t1 = grid.dekad_index(__import__("datetime").date(2000, 11, 1)), grid.dekad_index(
        __import__("datetime").date(2026, 11, 15))
    rng = np.random.default_rng(7)
    # dense cell (own k), sparse cell in a calibrated tile (tile k), sparse cell in a tile without
    # calibration (global k), cell with only recent NOAA-20 activity
    cells = {grid.l10_cell(-29.5, -67.5): 30.0, grid.l10_cell(-28.5, -66.5): 0.4,
             grid.l10_cell(-25.5, -55.5): 0.3, grid.l10_cell(-21.5, -61.5): 0.0}
    s, t, c, v = [], [], [], []
    for cell, lam in cells.items():
        for tt in range(t0, t1 + 1):
            year = 2000 + tt // 36
            for ser, scale, start, stop in ((0, 1.0, 0, 9999), (1, 2.6, 2012, 2026), (2, 2.4, 2018, 2026)):
                if not (start <= year <= stop) or (ser == 1 and tt >= grid.dekad_index(
                        __import__("datetime").date(2026, 11, 2))):
                    continue
                val = rng.poisson(lam * scale * (1 + (tt // 3) % 12 / 6))
                if lam == 0.0 and ser == 2 and year == 2026:
                    val = 3
                if val:
                    s.append(ser), t.append(tt), c.append(cell), v.append(val)
    cubes.write_cube(processed / "cube/l10/global.bin.gz", cubes.LEVEL_L10, s, t, c, v)
    man = _manifest(t0, t1)
    (processed / "manifest.json").write_text(json.dumps(man))
    blk = lambda k, n: {"k": [k] * 12, "lo": [k * 0.9] * 12, "hi": [k * 1.1] * 12, "n_modis": [n] * 12}
    cal = {"global": blk(2.9, 10**6), "tile": {"S30W070": blk(2.5, 5000)},
           "n20": {"global": blk(1.05, 10**6), "tile": {"S30W070": blk(1.1, 3000)}}}
    (processed / "calibration.json").write_text(json.dumps(cal))
    out = root / "out"
    stats = eg.export(processed, out)
    return {"processed": processed, "out": out, "stats": stats, "manifest": man, "cal": cal,
            "cube": (np.array(s), np.array(t), np.array(c), np.array(v)), "t0": t0, "nT": t1 - t0 + 1}


def _cell_rows(df: pl.DataFrame, cell: int) -> dict:
    return {(r["year"], r["month"]): r for r in df.filter(pl.col("cell") == cell).iter_rows(named=True)}


def test_rows_equal_reference_harmonize_per_cell(synthetic):
    df = pl.read_parquet(synthetic["out"] / f"{eg.BASENAME}.parquet")
    assert df.columns == eg.COLUMNS
    s, t, c, v = synthetic["cube"]
    strata_seen = set()
    for cell in np.unique(c):
        per = np.zeros((1, 4, synthetic["nT"]))
        sel = c == cell
        np.add.at(per, (0, s[sel], t[sel] - synthetic["t0"]), v[sel])
        tile = eg.tile_of_l10(int(cell))
        ref = harmonize(per, [tile], synthetic["t0"], synthetic["manifest"], synthetic["cal"])
        got = _cell_rows(df, int(cell))
        n_active = 0
        for r in ref["rows"]:
            if r is None or r["modis"] + r["snpp"] + r["n20"] == 0:
                continue
            n_active += 1
            g = got[(r["year"], r["month"] + 1)]
            assert g["tile"] == tile
            assert g["modis_fcd"] == r["modis"] and g["n20_fcd"] == r["n20"]
            assert close(g["harmonized"], r["harmonized"]) and close(g["harmonized_lo"], r["lo"])
            assert close(g["harmonized_hi"], r["hi"])
            assert g["era"] == r["era"] and g["n_dekads"] == r["n_dekads"] and g["partial"] == r["partial"]
            if r["era"] == "snpp":
                assert (g["k"], g["k_stratum"], g["k_source"]) == (1.0, "reference", "VIIRS S-NPP (reference series)")
            else:
                ks = (ref["k_modis"] if r["era"] == "modis" else ref["k_n20"])[r["month"]]
                assert g["k_stratum"] == ks["stratum"] and close(g["k"], ks["k"])
                assert close(g["k_lo"], ks["lo"]) and close(g["k_hi"], ks["hi"])
                strata_seen.add(g["k_stratum"])
            if r["year"] < 2012:
                assert g["viirs_fcd"] is None and g["snpp_fcd"] is None
            else:
                assert g["snpp_fcd"] == r["snpp"]
        assert n_active == len(got)
    assert {"aoi", "tile", "global"} <= strata_seen


def test_totals_csv_and_readme(synthetic):
    st, out = synthetic["stats"], synthetic["out"]
    assert st["raw_totals"] == st["cube_totals"]
    df = pl.read_parquet(out / f"{eg.BASENAME}.parquet")
    with gzip.open(out / f"{eg.BASENAME}.csv.gz", "rb") as fh:
        raw = fh.read()
    raw.decode("ascii")  # ASCII only, like the calendar CSV
    csv = pl.read_csv(io.BytesIO(raw), infer_schema_length=None)
    assert csv.columns == eg.COLUMNS and csv.height == df.height
    assert abs(csv["harmonized"].sum() - df["harmonized"].sum()) < 1e-3 * df.height
    readme = (out / "README.md").read_text(encoding="utf-8")
    for needle in ("VIIRS-equivalent fire-cell-days", "LANCE FIRMS", "CC BY 4.0", "k_stratum"):
        assert needle in readme


def test_refuses_to_write_inside_the_build(synthetic):
    data_dir = synthetic["processed"].parent
    with pytest.raises(SystemExit):
        eg.main(["--data-dir", str(data_dir), "--out", str(data_dir / "exports")])


FIXTURE = ROOT / "data" / "processed"


@pytest.mark.skipif(not (FIXTURE / "manifest.json").exists(), reason="no fixture build (uv run python -m pipeline.build_all --fixture)")
def test_fixture_build(tmp_path):
    st = eg.export(FIXTURE, tmp_path)
    assert st["raw_totals"] == st["cube_totals"] and st["rows"] > 0
