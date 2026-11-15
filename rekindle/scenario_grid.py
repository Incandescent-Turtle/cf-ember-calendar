"""Counterfactual scenario grid around a calibrated baseline (REKINDLE.md §6).

    uv run python -m rekindle.scenario_grid --fire chilecito-2026 --workers 3

Each grid run = the baseline (ignitions, fuels, terrain, ROS multiplier, duration) with a
constant 10 m wind (speed, from-direction) and a dead fuel moisture from the axes. Writes
data/rekindle/<fire>/runs/<key>.npy (float32 arrival seconds, inf = unburned); existing files
are skipped, so the run can be resumed. Counterfactuals only if the baseline passed the gate.
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle.hindcast import CFG, MOISTURE_AXIS, moisture
from rekindle.levelset import run_levelset
from rekindle.scenario import Scenario, WindSample

WIND_MS = [0, 3, 6, 9, 12, 15]
WIND_FROM = [0, 45, 90, 135, 180, 225, 270, 315]


def run_key(ws: int, wd: int, m: int) -> str:
    return f"ws{ws:02d}_wd{wd:03d}_m{m:02d}"


def grid_runs(moist_axis=MOISTURE_AXIS) -> list[tuple[int, int, int]]:
    """All axis combinations; calm (ws = 0) runs once per moisture, as wd = 0."""
    out = []
    for m in moist_axis:
        for ws in WIND_MS:
            for wd in [0] if ws == 0 else WIND_FROM:
                out.append((ws, wd, m))
    return out


_G: dict = {}


def _init(fire: str, cal: dict, out: str) -> None:
    dom, meta = dm.load(fire)
    _G.update(dom=dom, meta=meta, cal=cal, out=Path(out))


def _run(args: tuple[int, int, int]) -> tuple[str, float, bool]:
    ws, wd, m = args
    key = run_key(ws, wd, m)
    path = _G["out"] / f"{key}.npy"
    if path.exists():
        return key, 0.0, False
    cal = _G["cal"]
    sc = Scenario(ignitions=dm.ignitions(_G["meta"]), duration_s=cal["hours"] * 3600,
                  wind=(WindSample(0.0, float(ws), float(wd)),), moisture=moisture(m),
                  ros_multiplier=cal["ros_multiplier"], label=key)
    res = run_levelset(_G["dom"], sc, CFG)
    tmp = path.with_suffix(".tmp.npy")
    np.save(tmp, res.arrival_time_s.astype(np.float32))
    tmp.replace(path)
    return key, res.metrics["wall_s"], res.metrics["edge_reached"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--keys", default=None, help="comma list of run keys (default: whole grid)")
    ap.add_argument("--force", action="store_true", help="run counterfactuals even if gate failed")
    a = ap.parse_args()
    base = dm.DATA / a.fire
    cal = json.loads((base / "calibration.json").read_text())
    out = base / "runs"
    out.mkdir(exist_ok=True)
    shutil.copyfile(base / "baseline.npy", out / "baseline.npy")
    if cal["status"] != "validated" and not a.force:
        print(f"status {cal['status']}: baseline only, no counterfactuals (REKINDLE.md §5)")
        return
    runs = grid_runs()
    if a.keys:
        want = set(a.keys.split(","))
        runs = [r for r in runs if run_key(*r) in want]
    todo = [r for r in runs if not (out / f"{run_key(*r)}.npy").exists()]
    print(f"{len(runs)} grid runs, {len(todo)} to do, {a.workers} workers, "
          f"×{cal['ros_multiplier']}, {cal['hours']} h", flush=True)
    t0 = time.time()
    with Pool(a.workers, initializer=_init, initargs=(a.fire, cal, str(out))) as pool:
        for i, (key, wall, edge) in enumerate(pool.imap_unordered(_run, todo), 1):
            print(f"[{i}/{len(todo)}] {key} {wall:.0f} s{' edge' if edge else ''} "
                  f"(elapsed {time.time() - t0:.0f} s)", flush=True)
    print(f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
