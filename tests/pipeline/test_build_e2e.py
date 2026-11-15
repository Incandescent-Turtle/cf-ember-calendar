"""End-to-end build on a tiny synthetic input that exercises every cleaning rule
and both FIRMS delivery formats (Archive Download zip, yearly country zip, loose CSV)."""

import datetime as dt
import json
import shutil
import zipfile
from dataclasses import replace

import duckdb
import numpy as np
import pytest

from pipeline import build_all, cubes, grid
from pipeline.config import Config

# Archive Download format: MODIS-style brightness names, satellite/instrument SNPP
AD_HDR = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight"
SP_ROWS = [  # + type
    "-29.15,-67.70,330,0.4,0.4,2020-07-05,0318,SNPP,SNPP,n,2,290,5,N,0",   # a1 keep
    "-29.15,-67.70,330,0.4,0.4,2020-07-05,0318,SNPP,SNPP,n,2,290,5,N,0",   # a2 exact dup
    "-29.147,-67.697,340,0.4,0.4,2020-07-05,1830,SNPP,SNPP,h,2,290,9,D,0",  # a3 same cell-day as a1
    "-29.20,-67.80,310,0.4,0.4,2020-07-05,0318,SNPP,SNPP,l,2,290,1,N,0",   # a4 low conf
    "-30.50,-65.00,360,0.4,0.4,2020-07-05,0318,SNPP,SNPP,n,2,290,50,N,2",  # a5 static (type 2)
    "-29.15,-67.70,330,0.4,0.4,2020-07-15,0318,SNPP,SNPP,n,2,290,5,N,0",   # a6 next dekad
]
NRT_ROWS = [
    "-29.40,-67.40,330,0.4,0.4,2020-07-05,0400,SNPP,SNPP,n,2.0NRT,290,5,N",      # n1 SP exists that day
    "-30.5005,-65.0005,330,0.4,0.4,2020-08-01,0400,SNPP,SNPP,n,2.0NRT,290,5,N",  # n2 next to static
    "-29.00,-67.00,330,0.4,0.4,2020-08-01,0400,SNPP,SNPP,n,2.0NRT,290,5,N",      # n3 keep
    "-28.50,-66.50,330,0.4,0.4,2020-08-01,45,SNPP,SNPP,h,2.0NRT,290,5,N",        # n4 keep, short time
]
# Yearly country zip format
MODIS_HDR = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type"
MODIS_AR = [
    "-29.15,-67.70,320,1.0,1.0,2020-07-05,1400,Terra,MODIS,50,6.03,300,20,D,0",  # m1
    "-29.149,-67.699,320,1.0,1.0,2020-07-05,1700,Aqua,MODIS,85,6.03,300,20,D,0", # m2 same cell-day
    "-29.30,-67.30,320,1.0,1.0,2020-07-05,1400,Terra,MODIS,20,6.03,300,20,D,0",  # m3 low conf
]
MODIS_CL = [MODIS_AR[0]]  # border duplicate in a second country file
N20_HDR = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type"
N20_ROWS = ["-29.15,-67.70,330,0.4,0.4,2020-07-05,0408,N20,VIIRS,n,2,290,5,N,0"]


def _csv(hdr, rows):
    return "\n".join([hdr, *rows]) + "\n"


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("e2e")
    raw = root / "raw"
    raw.mkdir()
    with zipfile.ZipFile(raw / "DL_FIRE_SV-C2_1.zip", "w") as z:
        z.writestr("fire_archive_SV-C2_1.csv", _csv(AD_HDR + ",type", SP_ROWS))
        z.writestr("fire_nrt_SV-C2_1.csv", _csv(AD_HDR, NRT_ROWS))
        z.writestr("Readme.txt", "x")
    (raw / "DL_FIRE_SV-C2_1").mkdir()  # extracted copy next to the zip must be ignored
    (raw / "DL_FIRE_SV-C2_1" / "fire_archive_SV-C2_1.csv").write_text(_csv(AD_HDR + ",type", SP_ROWS))
    with zipfile.ZipFile(raw / "modis_2020_all_countries.zip", "w") as z:
        z.writestr("modis/2020/", "")
        z.writestr("modis/2020/modis_2020_Argentina.csv", _csv(MODIS_HDR, MODIS_AR))
        z.writestr("modis/2020/modis_2020_Chile.csv", _csv(MODIS_HDR, MODIS_CL))
    (raw / "viirs-jpss1_2020_x.csv").write_text(_csv(N20_HDR, N20_ROWS))

    cfg = replace(Config(), data_dir=root / "data", modis_min_conf=30, viirs_keep_conf=("n", "h"))
    report = build_all.build(cfg, [raw], build_all.STEPS)
    return cfg, report


def _clean(report, sensor):
    return next(r for r in report["clean"] if r["sensor"] == sensor and r["year"] == 2020)


def test_clean_counts(built):
    _, report = built
    snpp = _clean(report, "VIIRS_SNPP")
    assert [snpp[k] for k in ["raw", "valid", "type", "static", "confidence", "sp_nrt",
                              "exact_dup"]] == [10, 10, 9, 8, 7, 6, 5]
    terra = _clean(report, "MODIS_TERRA")
    assert (terra["raw"], terra["confidence"], terra["exact_dup"]) == (3, 2, 1)
    assert _clean(report, "MODIS_AQUA")["exact_dup"] == 1
    assert _clean(report, "VIIRS_NOAA20")["exact_dup"] == 1


def test_hotspot_fields(built):
    cfg, _ = built
    con = duckdb.connect()
    rows = con.execute(f"""
        SELECT sensor, processing, conf_class, acq_datetime, bt_mir_k, type, tile10, cell01, hid
        FROM read_parquet('{cfg.hotspots_dir.as_posix()}/**/*.parquet', hive_partitioning=true)
        WHERE lat = -28.5""").fetchall()
    assert len(rows) == 1
    sensor, proc, conf, ts, bt, typ, tile, cell, hid = rows[0]
    assert (sensor, proc, conf, typ, tile) == ("VIIRS_SNPP", "NRT", "high", None, "S30W070")
    assert ts == dt.datetime(2020, 8, 1, 0, 45) and bt == 330
    assert cell == grid.cell01(-28.5, -66.5) and hid > 0


def test_cubes_match_expected(built):
    cfg, _report = built
    l01 = cubes.read_cube(cfg.processed / "cube" / "l01" / "S30W070.bin.gz")
    got = {(int(s), int(t), int(c)): int(v) for s, t, c, v in zip(l01.s, l01.t, l01.c, l01.v)}

    def key(series, d, lat, lon):
        return (series, grid.dekad_index(d), grid.l01_of_cell01(grid.cell01(lat, lon))[1])

    jul5, jul15, aug1 = dt.date(2020, 7, 5), dt.date(2020, 7, 15), dt.date(2020, 8, 1)
    expected = {
        key(1, jul5, -29.15, -67.70): 1,   # a1 + a3: one cell-day
        key(1, jul15, -29.15, -67.70): 1,
        key(1, aug1, -29.0, -67.0): 1,
        key(1, aug1, -28.5, -66.5): 1,
        key(0, jul5, -29.15, -67.70): 1,   # Terra + Aqua same cell-day
        key(2, jul5, -29.15, -67.70): 1,
    }
    assert got == expected
    l10 = cubes.read_cube(cfg.processed / "cube" / "l10" / "global.bin.gz")
    assert l10.v.sum() == 6
    assert set(l10.c.tolist()) == {grid.l10_cell(-29.15, -67.70), grid.l10_cell(-28.5, -66.5)}


def test_points(built):
    cfg, _ = built
    files = list((cfg.processed / "points").glob("*/*.parquet"))
    assert [f.relative_to(cfg.processed / "points").as_posix() for f in files] == ["S30W070/2020.parquet"]
    con = duckdb.connect()
    a = con.execute(f"SELECT * FROM '{files[0].as_posix()}'").fetchnumpy()
    assert len(a["lat"]) == 8
    assert np.all(np.diff(a["lat"]) >= 0)
    assert set(a["sensor"].tolist()) == {1, 2, 3, 4}
    types = {r[0]: r[1] for r in con.execute(f"DESCRIBE SELECT * FROM '{files[0].as_posix()}'").fetchall()}
    assert types["lat"] == "FLOAT" and types["t_utc"] == "INTEGER" and types["type"] == "UTINYINT"
    t = con.execute(f"SELECT t_utc, type FROM '{files[0].as_posix()}' WHERE lat = -28.5").fetchone()
    assert t == ((dt.datetime(2020, 8, 1, 0, 45) - dt.datetime(2000, 1, 1)).total_seconds() // 60, 255)


def test_manifest(built):
    cfg, _ = built
    m = json.loads((cfg.processed / "manifest.json").read_text())
    assert m["row_counts"] == {"MODIS": 2, "VIIRS_SNPP": 5, "VIIRS_NOAA20": 1}
    assert m["tiles"] == ["S30W070"]
    assert m["dekad_range"] == [grid.dekad_index(dt.date(2020, 7, 5)),
                                grid.dekad_index(dt.date(2020, 8, 1))]
    assert m["points"] == {"years": [2020, 2020], "tiles": ["S30W070"]}
    assert m["sizes_mb"]["cubes"] > 0 and m["sizes_mb"]["points"] > 0
    assert m["series"] == ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"]


def test_add_sources_matches_full_build(built, tmp_path):
    """build without the MODIS zip, then --add it: same cubes and counts as one full build."""
    full_cfg, _ = built
    raw_all = full_cfg.data_dir.parent / "raw"
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "viirs-jpss1_2020_x.csv").write_text((raw_all / "viirs-jpss1_2020_x.csv").read_text())
    shutil.copy(raw_all / "DL_FIRE_SV-C2_1.zip", raw / "DL_FIRE_SV-C2_1.zip")
    cfg = replace(full_cfg, data_dir=tmp_path / "data")
    build_all.build(cfg, [raw], build_all.STEPS)
    build_all.main(["--data-dir", str(cfg.data_dir), "--add",
                    "--inputs", str(raw_all / "modis_2020_all_countries.zip")])
    for rel in ("cube/l10/global.bin.gz", "cube/l01/S30W070.bin.gz"):
        a, b = cubes.read_cube(full_cfg.processed / rel), cubes.read_cube(cfg.processed / rel)
        for col in "stcv":
            assert np.array_equal(getattr(a, col), getattr(b, col)), (rel, col)
    m_full = json.loads((full_cfg.processed / "manifest.json").read_text())
    m_add = json.loads((cfg.processed / "manifest.json").read_text())
    assert m_add["row_counts"] == m_full["row_counts"]
    assert (cfg.processed / "calibration.json").exists()
    # adding the same source again is idempotent
    build_all.main(["--data-dir", str(cfg.data_dir), "--add",
                    "--inputs", str(raw_all / "modis_2020_all_countries.zip")])
    m_again = json.loads((cfg.processed / "manifest.json").read_text())
    assert m_again["row_counts"] == m_full["row_counts"]
