"""Observed hotspots for a curated fire (read-only from the processed points, CONTRACTS.md)."""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

import duckdb
import yaml

FIRES = Path(__file__).parent / "fires.yaml"
EPOCH = dt.datetime(2000, 1, 1, tzinfo=dt.UTC)
SENSORS = {1: "MODIS_TERRA", 2: "MODIS_AQUA", 3: "VIIRS_SNPP", 4: "VIIRS_NOAA20", 5: "VIIRS_NOAA21"}


def load_fire(fire_id: str) -> dict:
    fires = yaml.safe_load(FIRES.read_text(encoding="utf-8"))["fires"]
    return next(f for f in fires if f["id"] == fire_id)


def detections(points_dir: Path, fire: dict) -> duckdb.DuckDBPyRelation:
    """Detections inside the fire's bbox and dates, with ISO time and sensor names."""
    w, s, e, n = fire["bbox"]
    start = dt.datetime.fromisoformat(str(fire["start"])).replace(tzinfo=dt.UTC)
    end = dt.datetime.fromisoformat(str(fire["end"])).replace(tzinfo=dt.UTC) + dt.timedelta(days=1)
    t0, t1 = ((x - EPOCH).total_seconds() / 60 for x in (start, end))
    years = range(start.year, end.year + 1)
    files = [str(points_dir / tile / f"{y}.parquet") for tile in fire["points_tiles"] for y in years]
    con = duckdb.connect(config={"memory_limit": "1GB", "threads": 2})
    case = " ".join(f"WHEN {k} THEN '{v}'" for k, v in SENSORS.items())
    return con.sql(
        f"""SELECT lat, lon, TIMESTAMP '2000-01-01' + to_minutes(t_utc) AS t_utc,
                   CASE sensor {case} END AS sensor, frp, daynight, conf, scan, track
            FROM read_parquet({files!r})
            WHERE lon BETWEEN {w} AND {e} AND lat BETWEEN {s} AND {n}
              AND t_utc >= {t0} AND t_utc < {t1}
            ORDER BY t_utc"""
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--points", type=Path, default=Path("data/processed/points"))
    ap.add_argument("--out", type=Path, default=Path("docs/report/rekindle"))
    a = ap.parse_args()
    fire = load_fire(a.fire)
    rel = detections(a.points, fire)
    a.out.mkdir(parents=True, exist_ok=True)
    by_pass = rel.query(
        "d", "SELECT date_trunc('hour', t_utc) AS hour_utc, sensor, count(*) AS n, "
        "round(sum(frp), 1) AS frp_sum FROM d GROUP BY ALL ORDER BY 1, 2")
    by_pass.write_csv(str(a.out / f"{a.fire}_detections_by_hour.csv"))
    first = rel.query("d", "SELECT * FROM d WHERE t_utc = (SELECT min(t_utc) FROM d)")
    first.write_csv(str(a.out / f"{a.fire}_first_detections.csv"))
    print(rel.query("d", "SELECT sensor, count(*), min(t_utc), max(t_utc) FROM d GROUP BY 1"))
    print(first)


if __name__ == "__main__":
    main()
