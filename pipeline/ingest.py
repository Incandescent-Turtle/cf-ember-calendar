"""FIRMS CSV/zip -> normalized staging Parquet, hive-partitioned by sensor/year.

Every source is read with `all_varchar` (FIRMS columns change type and name
between delivery formats, see DATA.md) and cast explicitly. Nothing is dropped
here except rows whose satellite code is unknown (logged); cleaning is clean.py.

    staging/sensor=<SENSOR>/year=<YYYY>/<source>_<i>.parquet
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

import duckdb

from pipeline import grid
from pipeline.config import Config
from pipeline.sources import Source, csv_files, discover, sql_list

log = logging.getLogger(__name__)

SATELLITE_TO_SENSOR = {
    "TERRA": "MODIS_TERRA", "T": "MODIS_TERRA",
    "AQUA": "MODIS_AQUA", "A": "MODIS_AQUA",
    "N": "VIIRS_SNPP", "SNPP": "VIIRS_SNPP", "NPP": "VIIRS_SNPP", "SUOMI NPP": "VIIRS_SNPP",
    "N20": "VIIRS_NOAA20", "NOAA-20": "VIIRS_NOAA20", "NOAA20": "VIIRS_NOAA20",
    "J1": "VIIRS_NOAA20", "1": "VIIRS_NOAA20",
    "N21": "VIIRS_NOAA21", "NOAA-21": "VIIRS_NOAA21", "NOAA21": "VIIRS_NOAA21",
    "J2": "VIIRS_NOAA21", "2": "VIIRS_NOAA21",
}

# staging columns (order matters for readability only)
STAGING_COLUMNS = [
    "sensor", "instrument", "lat", "lon", "acq_datetime", "acq_date", "daynight", "frp",
    "scan", "track", "conf_raw", "type", "processing", "version", "bt_mir_k", "bt_tir_k",
    "cell01", "tile10", "year", "month", "source",
]


def _col(cols: set[str], *names: str) -> str:
    """First of `names` present in the CSV, else NULL."""
    present = [f'"{n}"' for n in names if n in cols]
    if not present:
        return "NULL"
    return present[0] if len(present) == 1 else f"coalesce({', '.join(present)})"


def _num(expr: str) -> str:
    return "NULL::DOUBLE" if expr == "NULL" else f"TRY_CAST(trim({expr}) AS DOUBLE)"


def _sensor_case() -> str:
    whens = " ".join(
        f"WHEN '{k}' THEN '{v}'" for k, v in SATELLITE_TO_SENSOR.items()
    )
    return f"CASE upper(trim(satellite)) {whens} ELSE NULL END"


def select_sql(files: list[Path], cols: set[str], source: str) -> str:
    """Normalizing SELECT for one source (all CSVs share a header family)."""
    hhmm = "lpad(regexp_replace(trim(acq_time), '\\.0+$', ''), 4, '0')"
    nrt_from_name = "regexp_matches(lower(filename), 'fire_nrt|_nrt')"
    version = _col(cols, "version")
    proc = (
        f"CASE WHEN {version} ILIKE '%NRT%' OR {nrt_from_name} THEN 'NRT' ELSE 'SP' END"
        if version != "NULL"
        else f"CASE WHEN {nrt_from_name} THEN 'NRT' ELSE 'SP' END"
    )
    type_expr = _col(cols, "type")
    type_sql = "NULL::TINYINT" if type_expr == "NULL" else f"TRY_CAST(trim({type_expr}) AS TINYINT)"
    cell = grid.sql_cell01("lat", "lon")
    return f"""
    WITH r AS (
        SELECT * FROM read_csv({sql_list(files)}, union_by_name=true, all_varchar=true,
                               header=true, filename=true)
    ), n AS (
        SELECT
            {_sensor_case()} AS sensor,
            TRY_CAST(trim(latitude) AS DOUBLE) AS lat,
            TRY_CAST(trim(longitude) AS DOUBLE) AS lon,
            TRY_CAST(trim(acq_date) AS DATE) AS acq_date,
            {hhmm} AS hhmm,
            upper(trim({_col(cols, 'daynight')})) AS daynight,
            {_num(_col(cols, 'frp'))} AS frp,
            {_num(_col(cols, 'scan'))} AS scan,
            {_num(_col(cols, 'track'))} AS track,
            trim({_col(cols, 'confidence')}) AS conf_raw,
            {type_sql} AS type,
            {proc} AS processing,
            trim({version}) AS version,
            {_num(_col(cols, 'bright_ti4', 'brightness'))} AS bt_mir_k,
            {_num(_col(cols, 'bright_ti5', 'bright_t31'))} AS bt_tir_k
        FROM r
    )
    SELECT
        sensor,
        CASE WHEN sensor LIKE 'MODIS%' THEN 'MODIS' ELSE 'VIIRS' END AS instrument,
        lat, lon,
        acq_date::TIMESTAMP
            + to_hours(TRY_CAST(substr(hhmm, 1, 2) AS INTEGER))
            + to_minutes(TRY_CAST(substr(hhmm, 3, 2) AS INTEGER)) AS acq_datetime,
        acq_date, daynight, frp, scan, track, conf_raw, type, processing, version,
        bt_mir_k, bt_tir_k,
        CASE WHEN lat IS NULL OR lon IS NULL THEN NULL ELSE {cell} END AS cell01,
        CASE WHEN lat IS NULL OR lon IS NULL THEN NULL ELSE {grid.sql_tile10(cell)} END AS tile10,
        year(acq_date)::SMALLINT AS year,
        month(acq_date)::SMALLINT AS month,
        '{source}' AS source
    FROM n
    """


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name)


def ingest_source(con: duckdb.DuckDBPyConnection, src: Source, staging: Path,
                  tmp_root: str | None = None) -> dict[str, int]:
    """Stream one source into staging. Returns {'rows': n}."""
    name = _safe(src.name)
    with csv_files(src, tmp_root) as files:
        if not files:
            log.warning("%s: no CSV files", src.path)
            return {"rows": 0}
        # Each Archive Download zip mixes SP and NRT with different headers; group by
        # header so union_by_name never invents mismatched columns.
        groups: dict[tuple[str, ...], list[Path]] = {}
        for f in files:
            with open(f, encoding="utf-8", errors="replace") as fh:
                header = tuple(h.strip().lower() for h in fh.readline().strip().split(","))
            groups.setdefault(header, []).append(f)
        total = 0
        for gi, (header, gfiles) in enumerate(groups.items()):
            sel = select_sql(gfiles, set(header), name)
            # one pass: unknown satellites / unparseable dates land in sensor=UNKNOWN or
            # year=0 partitions, which clean.py reports and drops.
            n = con.execute(
                f"""COPY (SELECT * REPLACE (coalesce(sensor, 'UNKNOWN') AS sensor,
                                           coalesce(year, 0)::SMALLINT AS year)
                         FROM ({sel}))
                TO '{staging.as_posix()}'
                (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (sensor, year),
                 FILENAME_PATTERN '{name}_g{gi}_{{i}}', OVERWRITE_OR_IGNORE true)"""
            ).fetchone()[0]
            total += n
        log.info("ingested %s: %d rows", src.path.name, total)
        return {"rows": total}


def ingest_all(con: duckdb.DuckDBPyConnection, cfg: Config, inputs: list[Path],
               fresh: bool = True) -> list[dict]:
    staging = cfg.staging_dir
    if fresh and staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    sources = [s for root in inputs for s in discover(root)]
    if not sources:
        raise FileNotFoundError(f"no FIRMS CSV/zip files under {inputs}")
    log.info("ingest: %d sources", len(sources))
    report = []
    for src in sources:
        r = ingest_source(con, src, staging, cfg.tmp_dir)
        report.append({"source": str(src.path), **r})
    return report


def staging_counts(con: duckdb.DuckDBPyConnection, cfg: Config) -> list[tuple]:
    """(sensor, year, processing, rows) in staging."""
    return con.execute(
        f"""SELECT sensor, year, processing, count(*) FROM
        read_parquet('{cfg.staging_dir.as_posix()}/**/*.parquet', hive_partitioning=true)
        GROUP BY ALL ORDER BY ALL"""
    ).fetchall()
