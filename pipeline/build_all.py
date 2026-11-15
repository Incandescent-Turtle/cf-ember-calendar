"""End-to-end build: FIRMS files -> hotspots -> fire-cell-days -> cubes + points + manifest.

    uv run python -m pipeline.build_all --fixture             # tests/fixtures -> ./data
    uv run python -m pipeline.build_all --data-dir "$SCRATCH/ember"   # reads <dir>/raw
    ... [--inputs PATH ...] [--steps ingest,clean,fcd,cubes,points,manifest]

Writes only under DATA_DIR: interim/ (staging, hotspots, fcd_daily, logs) and
processed/ (cube/, points/, manifest.json). Calibration and validation are
separate steps (S3).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys
import time
from dataclasses import replace
from pathlib import Path

from pipeline import clean, cubes, fcd, ingest, points
from pipeline.config import REPO_ROOT, Config, connect

log = logging.getLogger("pipeline")

STEPS = ["ingest", "clean", "fcd", "cubes", "points", "manifest"]
FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures"


def _setup_logging(cfg: Config) -> None:
    cfg.logs_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fh = logging.FileHandler(cfg.logs_dir / "build.log", mode="a", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.handlers[:] = [fh, sh]


def _dir_mb(path: Path) -> float:
    if not path.exists():
        return 0.0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / 2**20


def row_counts(con, cfg: Config) -> dict[str, int]:
    """Cleaned detections per series group (MODIS = Terra + Aqua)."""
    files = clean.hotspot_files(cfg)
    if not files:
        return {}
    rows = con.execute(f"""
        SELECT {fcd.SENSOR_GROUP_SQL} AS g, count(*) FROM read_parquet(
          '{cfg.hotspots_dir.as_posix()}/**/*.parquet', hive_partitioning=true)
        GROUP BY 1 ORDER BY 1""").fetchall()
    return {g: int(n) for g, n in rows}


def write_manifest(con, cfg: Config, cube_stats: dict | None = None) -> dict:
    proc = cfg.processed
    tiles = sorted(p.name.removesuffix(".bin.gz") for p in (proc / "cube" / "l01").glob("*.bin.gz"))
    if cube_stats and "dekad_range" in cube_stats:
        dekad_range = cube_stats["dekad_range"]
    else:
        c = cubes.read_cube(proc / "cube" / "l10" / "global.bin.gz")
        dekad_range = [int(c.t.min()), int(c.t.max())]
    pt_tiles = sorted(d.name for d in (proc / "points").glob("*") if d.is_dir())
    pt_years = sorted({int(f.stem) for f in (proc / "points").glob("*/*.parquet")})
    counts = {k: 0 for k in ("MODIS", "VIIRS_SNPP", "VIIRS_NOAA20")}
    counts.update(row_counts(con, cfg))
    manifest = {
        "version": 1,
        "built_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dekad_range": dekad_range,
        "series": cubes.SERIES_NAMES,
        "tiles": tiles,
        "l10": "cube/l10/global.bin.gz",
        "overlap": {"start": cfg.cal_start, "end": cfg.cal_end},
        "snpp_end": cfg.snpp_end,
        "min_modis_fcd": cfg.cal_min_modis_fcd,
        "points": {"years": [pt_years[0], pt_years[-1]] if pt_years else [],
                   "tiles": pt_tiles},
        "row_counts": counts,
        "sizes_mb": {"cubes": round(_dir_mb(proc / "cube"), 4),
                     "points": round(_dir_mb(proc / "points"), 4)},
    }
    proc.mkdir(parents=True, exist_ok=True)
    (proc / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def build(cfg: Config, inputs: list[Path], steps: list[str]) -> dict:
    _setup_logging(cfg)
    con = connect(cfg)
    report: dict = {"data_dir": str(cfg.data_dir), "inputs": [str(p) for p in inputs],
                    "memory_limit": cfg.duckdb_memory_limit, "timings_s": {}}
    log.info("build: steps=%s inputs=%s data_dir=%s", steps, inputs, cfg.data_dir)
    cube_stats = None
    for step in steps:
        t0 = time.perf_counter()
        if step == "ingest":
            report["ingest"] = ingest.ingest_all(con, cfg, inputs)
            report["staging"] = [list(r) for r in ingest.staging_counts(con, cfg)]
        elif step == "clean":
            report["clean"] = clean.clean_all(con, cfg)
        elif step == "fcd":
            report["fcd"] = fcd.fcd_all(con, cfg)
        elif step == "cubes":
            cube_stats = cubes.build_cubes(con, cfg)
            report["cubes"] = {k: v for k, v in cube_stats.items() if k != "tiles"}
            report["cubes"]["n_tiles"] = len(cube_stats["tiles"])
            if cube_stats["l01_totals"] != cube_stats["fcd_totals"] or \
                    cube_stats["l10_totals"] != cube_stats["fcd_totals"]:
                raise RuntimeError(f"cube totals != fcd totals: {cube_stats}")
        elif step == "points":
            report["points"] = points.write_points(con, cfg)
        elif step == "manifest":
            report["manifest"] = write_manifest(con, cfg, cube_stats)
            m = report["manifest"]
            log.info("manifest: rows %s | cubes %.2f MB | points %.2f MB | %d tiles | dekads %s",
                     m["row_counts"], m["sizes_mb"]["cubes"], m["sizes_mb"]["points"],
                     len(m["tiles"]), m["dekad_range"])
        else:
            raise ValueError(f"unknown step {step}")
        report["timings_s"][step] = round(time.perf_counter() - t0, 1)
        log.info("step %s done in %.1f s", step, report["timings_s"][step])
    path = cfg.logs_dir / "build_report.json"
    path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    log.info("report: %s", path)
    return report


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--fixture", action="store_true", help="inputs = tests/fixtures")
    mode.add_argument("--data-dir", type=Path, help="DATA_DIR; inputs = <dir>/raw")
    ap.add_argument("--inputs", type=Path, nargs="+", help="override input files/dirs")
    ap.add_argument("--steps", default=",".join(STEPS))
    args = ap.parse_args(argv)

    cfg = Config()
    if args.data_dir:
        cfg = replace(cfg, data_dir=args.data_dir)
        inputs = args.inputs or [args.data_dir / "raw"]
    else:
        inputs = args.inputs or [FIXTURE_DIR]
    steps = [s.strip() for s in args.steps.split(",") if s.strip()]
    build(cfg, inputs, steps)


if __name__ == "__main__":
    main()
