"""Look at real FIRMS files before trusting the docs.

    uv run python -m pipeline.inspect <file.csv|file.zip> [...] [--per-member]

Prints per file: columns + inferred dtypes, row count, date range, lat/lon
range, and value counts for satellite, instrument, confidence, type, version.
A zip with <= 5 CSVs (Archive Download) is reported per member; a big yearly
country zip is reported as one union unless --per-member is given.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from pipeline.config import Config, connect
from pipeline.sources import Source, csv_files, sql_list

COUNT_COLS = ["satellite", "instrument", "confidence", "type", "version", "daynight"]
MAX_VALUES = 15


def _report(con, label: str, paths: list[Path]) -> None:
    files = sql_list(paths)
    print(f"\n=== {label}  ({len(paths)} csv)")
    typed = con.execute(
        f"DESCRIBE SELECT * FROM read_csv({files}, union_by_name=true, sample_size=20000)"
    ).fetchall()
    print("columns:", ", ".join(f"{r[0]}:{r[1]}" for r in typed))
    con.execute(
        f"CREATE OR REPLACE TEMP TABLE insp AS SELECT * FROM "
        f"read_csv({files}, union_by_name=true, all_varchar=true)"
    )
    cols = [r[0] for r in con.execute("DESCRIBE insp").fetchall()]
    n, dmin, dmax, la0, la1, lo0, lo1 = con.execute(
        "SELECT count(*), min(acq_date), max(acq_date), "
        "min(latitude::DOUBLE), max(latitude::DOUBLE), "
        "min(longitude::DOUBLE), max(longitude::DOUBLE) FROM insp"
    ).fetchone()
    print(f"rows: {n:,}   dates: {dmin} .. {dmax}")
    print(f"lat: {la0} .. {la1}   lon: {lo0} .. {lo1}")
    tmin, tmax, tlen = con.execute(
        "SELECT min(acq_time), max(acq_time), min(length(acq_time)) FROM insp"
    ).fetchone()
    print(f"acq_time: {tmin} .. {tmax} (min length {tlen})")
    for c in COUNT_COLS:
        if c not in cols:
            print(f"{c}: <absent>")
            continue
        rows = con.execute(
            f"SELECT {c}, count(*) FROM insp GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall()
        shown = ", ".join(f"{v!s}={k:,}" for v, k in rows[:MAX_VALUES])
        more = f" (+{len(rows) - MAX_VALUES} more)" if len(rows) > MAX_VALUES else ""
        print(f"{c}: {shown}{more}")
    if "version" in cols:
        rows = con.execute(
            "SELECT version, substr(acq_date, 1, 4) y, count(*) FROM insp "
            "GROUP BY 1, 2 ORDER BY 2, 1"
        ).fetchall()
        print("version x year:", ", ".join(f"{v}/{y}={k:,}" for v, y, k in rows))
    con.execute("DROP TABLE insp")


def inspect(path: Path, per_member: bool = False) -> None:
    cfg = Config()
    con = connect(cfg)
    src = Source(Path(path))
    with csv_files(src, cfg.tmp_dir) as paths:
        if not paths:
            print(f"\n=== {src.path.name}: no CSV members")
            return
        if per_member or len(paths) <= 5:
            for p in paths:
                _report(con, f"{src.path.name} :: {p.name.split('_', 1)[-1]}", [p])
        else:
            _report(con, src.path.name, paths)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--per-member", action="store_true")
    args = ap.parse_args()
    for f in args.files:
        inspect(f, args.per_member)


if __name__ == "__main__":
    main()
