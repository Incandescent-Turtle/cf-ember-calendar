"""Find candidate curated fires in the processed FIRMS points (read-only; S6b fallback).

    uv run python -m rekindle.candidates --points D:/ember/processed/points --region argentina

Bins VIIRS detections (S-NPP, NOAA-20, NOAA-21) into 0.2° cells and 10-day windows and ranks the
windows by the number of distinct overpasses, keeping those that burn on ≥ 3 days. Years are limited to
those with MERRA-2 and a MCD12Q1 year before the fire. DuckDB memory_limit 1 GB, 2 threads.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import duckdb
import numpy as np

REGIONS = {
    # name: (tiles, lon/lat box W, S, E, N)
    "argentina": (["S20W070", "S20W060", "S30W070", "S30W060", "S40W070", "S40W060",
                   "S50W070"], (-73.6, -55.0, -53.6, -21.8)),
    "canada": (["N40W130", "N40W120", "N40W110", "N40W100", "N40W090", "N40W080",
                "N50W130", "N50W120", "N50W110", "N50W100", "N50W090", "N50W080"],
               (-141.0, 41.7, -52.6, 60.0)),
}


# Free-spread pre-screen thresholds (pre-registered in DECISIONS.md, 15:16; do not tune).
SCREEN = {"min_days": 3, "min_r_final_km": 5.0, "max_first_pass_span_km": 3.0,
          "burst_h": 3.0, "max_burst_km": 3.0, "plateau_h": 48.0, "plateau_t_min_h": 6.0,
          "plateau_min_km": 1.0, "plateau_min_frac": 0.15, "recur_days": 20, "recur_years": 2,
          "recur_box_deg": 0.05, "box_deg": 0.2, "run_days": 6}


def _km(lon0, lat0, lon, lat):
    k = 111.32
    return np.hypot((np.asarray(lon) - lon0) * k * math.cos(math.radians(lat0)),
                    (np.asarray(lat) - lat0) * 110.57)


def spread_screen(det: np.ndarray, other_year_days: dict[int, int] | None = None,
                  c: dict = SCREEN) -> dict:
    """Pre-screen one candidate fire. det: rows (lon, lat, t_h, pass_id) sorted by t_h, t_h = hours
    after the first detection; passes = distinct pass_id. Returns the profile, each rule's verdict
    and `ok`. other_year_days: {year: days with detections in the recurrence box}."""
    t = det[:, 2]
    passes = sorted(set(zip(t.tolist(), det[:, 3].tolist())))
    first_pid = passes[0][1]
    ign = det[det[:, 3] == first_pid]
    span = float(max(_km(a[0], a[1], ign[:, 0], ign[:, 1]).max() for a in ign)) if len(ign) else 0.0
    # distance of each detection from the nearest ignition pixel
    d = np.min(np.stack([_km(g[0], g[1], det[:, 0], det[:, 1]) for g in ign]), axis=0)
    prof = []
    for tt, pid in passes:
        sel = (det[:, 3] == pid) & (t == tt)
        prof.append((tt, float(d[sel].max())))
    tp = np.array([p[0] for p in prof])
    rmax = np.maximum.accumulate(np.array([p[1] for p in prof]))
    r_final = float(rmax[-1])
    days = len({int(x // 24) for x in tp})

    def r_at(h: float) -> float:
        i = np.searchsorted(tp, h, side="right")
        return float(rmax[i - 1]) if i else 0.0

    burst = r_at(c["burst_h"])
    need = max(c["plateau_min_km"], c["plateau_min_frac"] * r_final)
    plateau = None
    for t_a in tp[tp >= c["plateau_t_min_h"]]:
        t_b = t_a + c["plateau_h"]
        if tp[-1] <= t_b:
            break
        if r_at(t_b) - r_at(t_a) < need:
            plateau = (float(t_a), float(t_b), round(r_at(t_b) - r_at(t_a), 2))
            break
    recur = sorted(y for y, n in (other_year_days or {}).items() if n >= c["recur_days"])
    rules = {
        "P0_enough": days >= c["min_days"] and r_final >= c["min_r_final_km"],
        "P1_single_start": span <= c["max_first_pass_span_km"],
        "P2_no_burst": burst <= c["max_burst_km"],
        "P3_no_plateau": plateau is None,
        "P4_no_recurrence": len(recur) < c["recur_years"],
    }
    return {"ok": all(rules.values()), "rules": rules, "r_final_km": round(r_final, 2),
            "days": days, "n_passes": len(passes), "first_pass_span_km": round(span, 2),
            "r_burst_km": round(burst, 2), "plateau": plateau, "recurrence_years": recur,
            "profile": [(round(a, 2), round(float(b), 2)) for (a, _), b in zip(prof, rmax)]}


def screen_candidate(con, points: Path, tiles: list[str], lon: float, lat: float,
                     first_day: str, c: dict = SCREEN) -> dict:
    """Load the candidate's detections (all sensors) and other-year activity, then screen it."""
    import datetime as dt

    d0 = dt.date.fromisoformat(str(first_day))
    y = d0.year
    m0 = (d0 - dt.date(2000, 1, 1)).days * 1440
    m1 = m0 + c["run_days"] * 1440
    b = c["box_deg"]
    files = [str(points / t / f"{yy}.parquet") for t in tiles for yy in (y - 1, y, y + 1)
             if (points / t / f"{yy}.parquet").exists()]
    rows = con.sql(f"""
        SELECT lon, lat, t_utc, sensor FROM read_parquet({files!r})
        WHERE t_utc >= {m0} AND t_utc < {m1} AND lon BETWEEN {lon - b} AND {lon + b}
          AND lat BETWEEN {lat - b} AND {lat + b} ORDER BY t_utc""").fetchnumpy()
    t_h = (rows["t_utc"] - rows["t_utc"].min()) / 60.0
    pid = rows["sensor"] * 1e7 + np.floor(rows["t_utc"] / 10)  # (sensor, 10-min) = one overpass
    det = np.column_stack([rows["lon"], rows["lat"], t_h, pid])
    rb = c["recur_box_deg"]
    yfiles = [str(p) for t in tiles for p in sorted((points / t).glob("*.parquet"))
              if 2019 <= int(p.stem) <= 2026 and int(p.stem) != y]
    other = {}
    if yfiles:
        for yy, n in con.sql(f"""
            SELECT year(DATE '2000-01-01' + CAST(floor(t_utc / 1440) AS INTEGER)) AS yy,
                   count(DISTINCT floor(t_utc / 1440)) FROM read_parquet({yfiles!r})
            WHERE lon BETWEEN {lon - rb} AND {lon + rb} AND lat BETWEEN {lat - rb} AND {lat + rb}
            GROUP BY yy""").fetchall():
            if yy != y:
                other[int(yy)] = int(n)
    out = spread_screen(det, other, c)
    out.update(lon=lon, lat=lat, first_day=str(d0), n_det=len(det), other_year_days=other)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--points", type=Path, default=Path("D:/ember/processed/points"))
    ap.add_argument("--region", choices=list(REGIONS), default="argentina")
    ap.add_argument("--years", default="2023,2024,2025,2026")
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--screen", action="store_true", help="free-spread pre-screen of each window")
    ap.add_argument("--check", default=None,
                    help="screen one fire instead: lon,lat,first_day (e.g. a curated fire)")
    ap.add_argument("--out", type=Path, default=None, help="screen results JSON")
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
    if a.check:
        lo, la, day = a.check.split(",")
        r = screen_candidate(con, a.points, tiles, float(lo), float(la), day)
        print({k: v for k, v in r.items() if k != "profile"})
        return
    if not a.screen:
        con.sql(q).show(max_rows=a.top, max_width=200)
        return
    import json

    results = []
    for lon, lat, first_day, last_day, n_days, n_passes, n_det, _ in con.sql(q).fetchall():
        r = screen_candidate(con, a.points, tiles, lon, lat, first_day)
        r.update(window_passes=n_passes, window_days=n_days)
        results.append(r)
        fails = [k for k, v in r["rules"].items() if not v]
        print(f"{lon:8.3f} {lat:8.3f} {first_day} passes {n_passes:3d} R {r['r_final_km']:5.1f} km "
              f"burst {r['r_burst_km']:4.1f} span {r['first_pass_span_km']:4.1f} "
              f"plateau {r['plateau']} recur {r['recurrence_years']} -> "
              f"{'PASS' if r['ok'] else 'fail ' + ','.join(fails)}")
    if a.out:
        a.out.write_text(json.dumps(results, indent=1, default=str))


if __name__ == "__main__":
    main()
