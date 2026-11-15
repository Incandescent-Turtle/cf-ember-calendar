"""Staging -> cleaned `hotspots` table (DATA.md schema), one (sensor, year) at a time.

Rules (HARMONIZATION.md Step 1), applied in this order; the row count after
each is logged per sensor-year to logs/clean_counts.csv:

  0 raw
  1 valid       lat/lon in range, date+time parse, known sensor
  2 type        keep type == 0, or type missing (NRT)
  3 static      rows without `type`: drop if within ~1 km (3x3 0.01-deg cells) of a
                static source (SP type 1/2, or a cell detected on > 50% of the
                instrument's data days in a year)
  4 confidence  MODIS conf >= MODIS_MIN_CONF; VIIRS conf in VIIRS_KEEP_CONF
  5 sp_nrt      drop NRT rows for a (sensor, date) that has SP rows
  6 exact_dup   one row per (sensor, lat, lon, acq_datetime), SP preferred

Output: hotspots/instrument=*/year=*/tile10=*/<sensor>_<i>.parquet
"""

from __future__ import annotations

import csv
import itertools
import logging
import re
import shutil
from pathlib import Path

import duckdb

from pipeline.config import Config

log = logging.getLogger(__name__)

RULES = ["raw", "valid", "type", "static", "confidence", "sp_nrt", "exact_dup"]
STATIC_PERSIST_FRAC = 0.5
STATIC_MIN_DATA_DAYS = 30  # don't run the persistence rule on near-empty years
N_COLS01 = 36000

HOTSPOT_COLUMNS = """
    md5_number_lower(sensor || '|' || printf('%.5f', lat) || '|' || printf('%.5f', lon)
                     || '|' || strftime(acq_datetime, '%Y-%m-%dT%H:%M')) AS hid,
    sensor, instrument, lat, lon, acq_datetime, acq_date, daynight, frp, scan, track,
    scan * track AS pixel_area_km2,
    CASE
      WHEN instrument = 'MODIS' THEN
        CASE WHEN conf_num < 30 THEN 'low' WHEN conf_num < 80 THEN 'nominal' ELSE 'high' END
      ELSE CASE conf_letter WHEN 'l' THEN 'low' WHEN 'n' THEN 'nominal' WHEN 'h' THEN 'high' END
    END AS conf_class,
    conf_raw, type, processing, version, bt_mir_k, bt_tir_k, cell01, tile10,
    year::SMALLINT AS year, month
"""


def _glob(p: Path) -> str:
    return f"'{p.as_posix()}/**/*.parquet'"


def staging_partitions(cfg: Config) -> list[tuple[str, int]]:
    out = []
    for d in sorted(cfg.staging_dir.glob("sensor=*/year=*")):
        out.append((d.parent.name.split("=", 1)[1], int(d.name.split("=", 1)[1])))
    return out


def build_static_mask(con: duckdb.DuckDBPyConnection, cfg: Config) -> int:
    """Write interim/static_cells.parquet (dilated 3x3). Returns number of cells."""
    out = cfg.interim / "static_cells.parquet"
    stg = _glob(cfg.staging_dir)
    con.execute(f"""
    COPY (
      WITH s AS (
        SELECT * FROM read_parquet({stg}, hive_partitioning=true)
        WHERE sensor <> 'UNKNOWN' AND cell01 IS NOT NULL
      ),
      typed AS (
        SELECT DISTINCT cell01, 'type12' AS why FROM s
        WHERE processing = 'SP' AND type IN (1, 2)
      ),
      data_days AS (
        SELECT instrument, year, count(DISTINCT acq_date) AS nd FROM s GROUP BY ALL
      ),
      cell_days AS (
        SELECT instrument, year, cell01, count(DISTINCT acq_date) AS cd FROM s GROUP BY ALL
      ),
      persistent AS (
        SELECT DISTINCT cell01, 'persistent' AS why FROM cell_days JOIN data_days USING (instrument, year)
        WHERE nd >= {STATIC_MIN_DATA_DAYS} AND cd > {STATIC_PERSIST_FRAC} * nd
      ),
      seeds AS (SELECT cell01 FROM typed UNION SELECT cell01 FROM persistent)
      SELECT DISTINCT cell01 + dr * {N_COLS01} + dq AS cell01
      FROM seeds, (SELECT unnest([-1, 0, 1]) AS dr), (SELECT unnest([-1, 0, 1]) AS dq)
    ) TO '{out.as_posix()}' (FORMAT parquet)
    """)
    n = con.execute(f"SELECT count(*) FROM '{out.as_posix()}'").fetchone()[0]
    log.info("static-source mask: %d cells (3x3 dilated)", n)
    return n


def _flag_sql(cfg: Config, part_glob: str, static_path: Path) -> str:
    keep = ", ".join(f"'{c}'" for c in cfg.viirs_keep_conf)
    return f"""
    WITH p AS (
      SELECT *,
        TRY_CAST(conf_raw AS INTEGER) AS conf_num,
        lower(left(conf_raw, 1)) AS conf_letter
      FROM read_parquet('{part_glob}', hive_partitioning=true)
    ),
    sp_dates AS (SELECT DISTINCT acq_date FROM p WHERE processing = 'SP'),
    st AS (SELECT cell01 FROM read_parquet('{static_path.as_posix()}'))
    SELECT p.*,
      coalesce(sensor <> 'UNKNOWN' AND lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180
               AND acq_datetime IS NOT NULL AND p.cell01 IS NOT NULL, false) AS ok_valid,
      coalesce(type IS NULL OR type = 0, false) AS ok_type,
      (type IS NOT NULL OR st.cell01 IS NULL) AS ok_static,
      coalesce(CASE WHEN instrument = 'MODIS' THEN conf_num >= {cfg.modis_min_conf}
                    ELSE conf_letter IN ({keep}) END, false) AS ok_conf,
      NOT (processing = 'NRT' AND sp.acq_date IS NOT NULL) AS ok_nrt
    FROM p
    LEFT JOIN st ON p.cell01 = st.cell01
    LEFT JOIN sp_dates sp ON p.acq_date = sp.acq_date
    """


def clean_partition(con: duckdb.DuckDBPyConnection, cfg: Config, sensor: str, year: int,
                    static_path: Path) -> dict[str, int]:
    part = cfg.staging_dir / f"sensor={sensor}" / f"year={year}"
    con.execute(
        f"CREATE OR REPLACE TEMP TABLE flagged AS "
        f"{_flag_sql(cfg, (part / '*.parquet').as_posix(), static_path)}"
    )
    counts = dict(zip(RULES[:6], con.execute("""
        SELECT count(*),
          count(*) FILTER (ok_valid),
          count(*) FILTER (ok_valid AND ok_type),
          count(*) FILTER (ok_valid AND ok_type AND ok_static),
          count(*) FILTER (ok_valid AND ok_type AND ok_static AND ok_conf),
          count(*) FILTER (ok_valid AND ok_type AND ok_static AND ok_conf AND ok_nrt)
        FROM flagged""").fetchone()))
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE kept AS
        SELECT {HOTSPOT_COLUMNS} FROM flagged
        WHERE ok_valid AND ok_type AND ok_static AND ok_conf AND ok_nrt
        QUALIFY row_number() OVER (
            PARTITION BY lat, lon, acq_datetime
            ORDER BY (processing = 'SP') DESC, version DESC) = 1
    """)
    con.execute("DROP TABLE flagged")
    counts["exact_dup"] = con.execute("SELECT count(*) FROM kept").fetchone()[0]
    if sensor != "UNKNOWN" and counts["exact_dup"]:
        _remove_outputs(cfg, sensor, year)
        con.execute(f"""
            COPY kept TO '{cfg.hotspots_dir.as_posix()}'
            (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (instrument, year, tile10),
             FILENAME_PATTERN '{sensor}_{{i}}', OVERWRITE_OR_IGNORE true)""")
    con.execute("DROP TABLE kept")
    return counts


def _remove_outputs(cfg: Config, sensor: str, year: int) -> None:
    inst = "MODIS" if sensor.startswith("MODIS") else "VIIRS"
    for f in cfg.hotspots_dir.glob(f"instrument={inst}/year={year}/tile10=*/{sensor}_*.parquet"):
        f.unlink()


def clean_all(con: duckdb.DuckDBPyConnection, cfg: Config, fresh: bool = True,
              only: list[tuple[str, int]] | None = None) -> list[dict]:
    if fresh and cfg.hotspots_dir.exists():
        shutil.rmtree(cfg.hotspots_dir)
    cfg.hotspots_dir.mkdir(parents=True, exist_ok=True)
    cfg.logs_dir.mkdir(parents=True, exist_ok=True)
    static_path = cfg.interim / "static_cells.parquet"
    if fresh or not static_path.exists():
        build_static_mask(con, cfg)
    report = []
    for sensor, year in only or staging_partitions(cfg):
        c = clean_partition(con, cfg, sensor, year, static_path)
        report.append({"sensor": sensor, "year": year, **c})
        log.info("clean %-12s %d  %s", sensor, year,
                 " > ".join(f"{k}={c[k]:,}" for k in RULES))
        assert all(c[a] >= c[b] for a, b in itertools.pairwise(RULES)), "counts must not grow"
    write_counts(cfg, report)
    return report


def write_counts(cfg: Config, report: list[dict]) -> Path:
    path = cfg.logs_dir / "clean_counts.csv"
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["sensor", "year", *RULES])
        w.writeheader()
        w.writerows(report)
    return path


def hotspot_files(cfg: Config, instrument: str = "*", year: int | str = "*",
                  tile: str = "*") -> list[Path]:
    return sorted(cfg.hotspots_dir.glob(f"instrument={instrument}/year={year}/tile10={tile}/*.parquet"))


def hotspot_years(cfg: Config) -> list[int]:
    ys = {int(re.sub(r"\D", "", d.name)) for d in cfg.hotspots_dir.glob("instrument=*/year=*")}
    return sorted(ys)
