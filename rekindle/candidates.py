"""Find candidate curated fires in the processed FIRMS points (read-only; S6b fallback).

    uv run python -m rekindle.candidates --points D:/ember/processed/points --region argentina

Bins VIIRS detections (S-NPP, NOAA-20, NOAA-21) into 0.2° cells and 10-day windows and ranks the
windows by the number of distinct overpasses, keeping those that burn on ≥ 3 days. Years are limited to
those with MERRA-2 and a MCD12Q1 year before the fire. DuckDB memory_limit 1 GB, 2 threads.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb

REGIONS = {
    # name: (tiles, lon/lat box W, S, E, N)
    "argentina": (["S20W070", "S20W060", "S30W070", "S30W060", "S40W070", "S40W060",
                   "S50W070"], (-73.6, -55.0, -53.6, -21.8)),
    "canada": (["N40W130", "N40W120", "N40W110", "N40W100", "N40W090", "N40W080",
                "N50W130", "N50W120", "N50W110", "N50W100", "N50W090", "N50W080"],
               (-141.0, 41.7, -52.6, 60.0)),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--points", type=Path, default=Path("D:/ember/processed/points"))
    ap.add_argument("--region", choices=list(REGIONS), default="argentina")
    ap.add_argument("--years", default="2023,2024,2025,2026")
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()
    tiles, (w, s, e, n) = REGIONS[a.region]
    files = [str(a.points / t / f"{y}.parquet") for t in tiles for y in a.years.split(",")
             if (a.points / t / f"{y}.parquet").exists()]
    con = duckdb.connect(config={"memory_limit": "1GB", "threads": 2})
    # t_utc = minutes since 2000-01-01; a pass = (sensor, t_utc rounded to 10 min).
    q = f"""
    WITH d AS (
      SELECT lon, lat, sensor, t_utc, frp,
             floor(lon / 0.2) AS cx, floor(lat / 0.2) AS cy,
             floor(t_utc / 1440) AS day
      FROM read_parquet({files!r})
      WHERE sensor IN (3, 4, 5) AND lon BETWEEN {w} AND {e} AND lat BETWEEN {s} AND {n}
    ), win AS (
      SELECT cx, cy, floor(day / 10) AS w10, count(*) AS n_det,
             count(DISTINCT day) AS n_days,
             count(DISTINCT (sensor, floor(t_utc / 10))) AS n_passes,
             min(day) AS d0, max(day) AS d1, round(sum(frp)) AS frp_sum,
             round(avg(lon), 3) AS lon, round(avg(lat), 3) AS lat
      FROM d GROUP BY cx, cy, w10
    )
    SELECT lon, lat, DATE '2000-01-01' + CAST(d0 AS INTEGER) AS first_day,
           DATE '2000-01-01' + CAST(d1 AS INTEGER) AS last_day, n_days, n_passes, n_det, frp_sum
    FROM win WHERE n_days >= 3 AND n_det BETWEEN 100 AND 4000
    ORDER BY n_passes DESC, n_days DESC LIMIT {a.top}
    """
    print(f"{len(files)} files")
    print(con.sql(q).df().to_string(index=False))


if __name__ == "__main__":
    main()
