"""Burst-and-stall diagnostic: distance from ignition vs time, observed vs the calibrated model.

    uv run python -m rekindle.spread_profile --fire chilecito-2026

Observed: for each overpass after t0, the largest distance from the nearest ignition among its
detections (detection times are upper bounds, so this is a lower bound on how far the fire had
got). Model: the head-run distance, i.e. the largest distance from the nearest ignition among
cells the calibrated baseline has reached by each hour. A free-spread model gives a distance that
keeps growing; a fire that bursts and then stalls shows a jump and a plateau (DECISIONS.md, S6b
input check). Same logic as `rekindle.input_check`, written out as data and a figure.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from rekindle import domain as dm


def observed_profile(meta: dict) -> list[dict]:
    """Per overpass (t > 0): hours after t0, max and median km from the nearest ignition, n."""
    t0 = dm.parse_t(meta["t0"])
    ig = np.array([(g["x_m"], g["y_m"]) for g in meta["ignitions"]])
    by_t: dict[float, list[float]] = {}
    for o in meta["observed"]:
        t_h = (dm.parse_t(o["t"]) - t0).total_seconds() / 3600
        if t_h <= 0:
            continue
        d = float(np.min(np.hypot(ig[:, 0] - o["x_m"], ig[:, 1] - o["y_m"]))) / 1000
        by_t.setdefault(round(t_h, 3), []).append(d)
    return [{"t_h": t, "max_km": round(max(v), 3), "median_km": round(float(np.median(v)), 3),
             "n": len(v)} for t, v in sorted(by_t.items())]


def model_head_distance(arrival_s: np.ndarray, meta: dict, dx: float, hours: int) -> list[float]:
    """Largest distance (km) from the nearest ignition among cells reached by each hour 0..hours."""
    from scipy.spatial import cKDTree

    ny = arrival_s.shape[0]
    reached = np.isfinite(arrival_s) & (arrival_s <= hours * 3600)
    ii, jj = np.nonzero(reached)
    if ii.size == 0:
        return [0.0] * (hours + 1)
    x = (jj + 0.5) * dx
    y = ny * dx - (ii + 0.5) * dx
    ig = np.array([(g["x_m"], g["y_m"]) for g in meta["ignitions"]])
    dist, _ = cKDTree(ig).query(np.column_stack([x, y]))
    t = arrival_s[ii, jj]
    order = np.argsort(t)
    t, run_max = t[order], np.maximum.accumulate(dist[order])
    k = np.searchsorted(t, np.arange(hours + 1) * 3600.0, side="right")
    return [round(float(run_max[i - 1]) / 1000, 3) if i else 0.0 for i in k]


def profile(fire: str, run_dir: Path | None = None) -> dict:
    """Both curves for a fire's calibrated baseline (run_dir = a variant dir, default the fire)."""
    run_dir = run_dir or dm.DATA / fire
    cal = json.loads((run_dir / "calibration.json").read_text())
    _, meta = dm.load(fire)
    arr = np.load(run_dir / "baseline.npy")
    hours = int(cal["hours"])
    return {"fire": fire, "ros_multiplier": cal["ros_multiplier"], "hours": hours,
            "model_settings": cal.get("model_settings"),
            "observed": observed_profile(meta),
            "model_km_by_hour": model_head_distance(arr, meta, float(meta["dx_m"]), hours),
            "definition": "observed = max distance from the nearest ignition among each overpass's "
                          "detections (times are upper bounds); model = max distance from the "
                          "nearest ignition among cells the calibrated baseline reached by that hour"}


def figure(p: dict, figs: Path, name: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figs.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    obs = p["observed"]
    ax.plot([o["t_h"] for o in obs], [o["max_km"] for o in obs], "o", ms=4, color="#1f1f1f",
            label="FIRMS: farthest detection per overpass")
    ax.plot(range(p["hours"] + 1), p["model_km_by_hour"], "-", color="#c2410c", lw=2,
            label=f"model head run (ROS ×{p['ros_multiplier']})")
    ax.set(xlabel="hours after the first detection", ylabel="km from the nearest ignition",
           xlim=(0, p["hours"]), ylim=(0, None))
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8, loc="lower right")
    ax.set_title(f"{p['fire']}: distance from ignition vs time (burst and stall)", fontsize=9)
    for ext in ("pdf", "png"):
        fig.savefig(figs / f"{name}_spread_profile.{ext}", dpi=150, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--tag", default="", help="variant dir under variants/ (default: baseline)")
    ap.add_argument("--report", type=Path, default=Path("docs/report/rekindle"))
    a = ap.parse_args()
    run_dir = dm.DATA / a.fire / ("variants/" + a.tag if a.tag else "")
    name = f"{a.fire}_{a.tag}" if a.tag else a.fire
    p = profile(a.fire, run_dir)
    a.report.mkdir(parents=True, exist_ok=True)
    (a.report / f"{name}_spread_profile.json").write_text(json.dumps(p, indent=1))
    figure(p, a.report / "figures", name)
    last = p["observed"][-1] if p["observed"] else None
    print(f"{name}: observed max {max(o['max_km'] for o in p['observed']):.1f} km "
          f"(last pass {last and last['t_h']:.0f} h); model {p['model_km_by_hour'][-1]:.1f} km "
          f"at {p['hours']} h")


if __name__ == "__main__":
    main()
