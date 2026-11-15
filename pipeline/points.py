"""Cleaned hotspots -> points/<tile>/<year>.parquet (CONTRACTS.md -> Points file).

Both instruments in one file per (tile, year), sorted by lat, row groups of
100,000, zstd.
"""

from __future__ import annotations

import logging
import shutil

import duckdb

from pipeline.clean import hotspot_files
from pipeline.config import Config
from pipeline.sources import sql_list

log = logging.getLogger(__name__)

SENSOR_CODES = {"MODIS_TERRA": 1, "MODIS_AQUA": 2, "VIIRS_SNPP": 3, "VIIRS_NOAA20": 4,
                "VIIRS_NOAA21": 5}
ROW_GROUP = 100_000

POINT_COLUMNS = f"""
    lat::FLOAT AS lat,
    lon::FLOAT AS lon,
    date_diff('minute', TIMESTAMP '2000-01-01 00:00:00', acq_datetime)::INTEGER AS t_utc,
    (CASE sensor {' '.join(f"WHEN '{k}' THEN {v}" for k, v in SENSOR_CODES.items())}
     END)::UTINYINT AS sensor,
    frp::FLOAT AS frp,
    (CASE daynight WHEN 'D' THEN 0 WHEN 'N' THEN 1 ELSE 255 END)::UTINYINT AS daynight,
    (CASE conf_class WHEN 'low' THEN 0 WHEN 'nominal' THEN 1 WHEN 'high' THEN 2 ELSE 255 END
    )::UTINYINT AS conf,
    scan::FLOAT AS scan,
    track::FLOAT AS track,
    bt_mir_k::FLOAT AS bt_mir,
    bt_tir_k::FLOAT AS bt_tir,
    coalesce(type, 255)::UTINYINT AS type
"""


def tile_years(cfg: Config) -> list[tuple[str, int]]:
    pairs = {
        (d.name.split("=", 1)[1], int(d.parent.name.split("=", 1)[1]))
        for d in cfg.hotspots_dir.glob("instrument=*/year=*/tile10=*")
    }
    return sorted(pairs)


def write_points(con: duckdb.DuckDBPyConnection, cfg: Config) -> dict:
    out = cfg.processed / "points"
    if out.exists():
        shutil.rmtree(out)
    stats = {"files": 0, "rows": 0, "bytes": 0, "tiles": set(), "years": set()}
    for tile, year in tile_years(cfg):
        files = hotspot_files(cfg, year=year, tile=tile)
        dest = out / tile / f"{year}.parquet"
        dest.parent.mkdir(parents=True, exist_ok=True)
        n = con.execute(f"""
            COPY (
              SELECT {POINT_COLUMNS}
              FROM read_parquet({sql_list(files)}, hive_partitioning=true, union_by_name=true)
              ORDER BY lat, lon, t_utc
            ) TO '{dest.as_posix()}'
            (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP})""").fetchone()[0]
        stats["files"] += 1
        stats["rows"] += n
        stats["bytes"] += dest.stat().st_size
        stats["tiles"].add(tile)
        stats["years"].add(year)
    stats["tiles"] = sorted(stats["tiles"])
    stats["years"] = sorted(stats["years"])
    log.info("points: %d files, %d rows, %.1f MB", stats["files"], stats["rows"],
             stats["bytes"] / 2**20)
    return stats
