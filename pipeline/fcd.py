"""Cleaned hotspots -> daily fire-cell-days on the 0.01-degree counting grid.

One row per active (sensor_group, cell01, UTC date):
    sensor_group  MODIS (Terra + Aqua) | VIIRS_SNPP | VIIRS_NOAA20 | VIIRS_NOAA21
    cell01, acq_date, fcd (= 1), n_det, frp_sum
Written to fcd_daily/sensor_group=*/year=*/fcd_<i>.parquet, one year at a time.
"""

from __future__ import annotations

import logging
import shutil

import duckdb

from pipeline.clean import hotspot_files, hotspot_years
from pipeline.config import Config
from pipeline.sources import sql_list

log = logging.getLogger(__name__)

SENSOR_GROUP_SQL = "CASE WHEN instrument = 'MODIS' THEN 'MODIS' ELSE sensor END"


def fcd_year(con: duckdb.DuckDBPyConnection, cfg: Config, year: int) -> dict[str, int]:
    files = hotspot_files(cfg, year=year)
    if not files:
        return {}
    for old in cfg.fcd_dir.glob(f"sensor_group=*/year={year}/*.parquet"):
        old.unlink()
    con.execute(f"""
        COPY (
          SELECT {SENSOR_GROUP_SQL} AS sensor_group, cell01, acq_date,
                 1::UTINYINT AS fcd, count(*)::INTEGER AS n_det, sum(frp) AS frp_sum,
                 {year}::SMALLINT AS year
          FROM read_parquet({sql_list(files)}, hive_partitioning=true, union_by_name=true)
          GROUP BY ALL
        ) TO '{cfg.fcd_dir.as_posix()}'
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (sensor_group, year),
         FILENAME_PATTERN 'fcd_{{i}}', OVERWRITE_OR_IGNORE true)""")
    rows = con.execute(f"""
        SELECT sensor_group, count(*) FROM read_parquet(
          '{cfg.fcd_dir.as_posix()}/sensor_group=*/year={year}/*.parquet', hive_partitioning=true)
        GROUP BY 1 ORDER BY 1""").fetchall()
    return dict(rows)


def fcd_all(con: duckdb.DuckDBPyConnection, cfg: Config, fresh: bool = True) -> list[dict]:
    if fresh and cfg.fcd_dir.exists():
        shutil.rmtree(cfg.fcd_dir)
    cfg.fcd_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for year in hotspot_years(cfg):
        counts = fcd_year(con, cfg, year)
        log.info("fcd %d  %s", year, "  ".join(f"{k}={v:,}" for k, v in counts.items()))
        report.extend({"year": year, "sensor_group": k, "fcd": v} for k, v in counts.items())
    return report
