"""S6i: make the shape-calibrated baseline (variants/shape_mcd64) the fire's shipped hindcast.

    uv run python -m rekindle.promote_shape --fire bc-2024

Keeps the timing-calibrated files as calibration_timing.json / baseline_timing.npy (first run
only), recomputes baseline_metrics (hotspot timing and overlap) at the new multiplier, keeps the
timing-gate verdict for that multiplier, and sets status to shape_validated / shape_poor.
Then run rekindle.export (and rekindle.shape_whatif for shape-validated fires).
"""

from __future__ import annotations

import argparse
import json
import shutil

import numpy as np

from rekindle import domain as dm
from rekindle import metrics


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", required=True)
    a = ap.parse_args()
    base = dm.DATA / a.fire
    var = base / "variants" / "shape_mcd64"
    if not (base / "calibration_timing.json").exists():
        shutil.copyfile(base / "calibration.json", base / "calibration_timing.json")
        shutil.copyfile(base / "baseline.npy", base / "baseline_timing.npy")
    timing = json.loads((base / "calibration_timing.json").read_text())
    shape = json.loads((var / "calibration.json").read_text())
    arr = np.load(var / "baseline.npy")
    dom, meta = dm.load(a.fire, nonveg_max_pct=shape["model_settings"].get("nonveg_max_pct"))
    prep = metrics.prepare(meta, dom.shape, dom.dx, shape["hours"] * 3600)
    bm = metrics.json_safe(metrics.score(arr, prep))
    gate = dict(timing["gate"])
    gate["passed"] = bool(bm["median_abs_timing_error_h"] is not None
                          and bm["median_abs_timing_error_h"] <= gate["threshold_h"])
    sweep = [{"ros_multiplier": s["ros_multiplier"],
              "median_abs_timing_error_h": s["median_abs_h"], "hit_rate": None,
              "sorensen": s["sorensen_hotspots"], "sorensen_mcd64": s["sorensen_mcd64"]}
             for s in shape["shape"]["sweep"]]
    cal = dict(shape, baseline_metrics=bm, gate=gate, sweep=sweep,
               timing_calibration={"ros_multiplier": timing["ros_multiplier"],
                                   "median_abs_timing_error_h":
                                       timing["baseline_metrics"]["median_abs_timing_error_h"],
                                   "sorensen_hotspots": timing["baseline_metrics"]["sorensen"]},
               calibrated_not_blind="the multiplier is fitted to this fire's MCD64A1 burned area "
                                    "(shape), not to its hotspot timing")
    cal["shape"] = {k: v for k, v in shape["shape"].items() if k != "sweep"}
    (base / "calibration.json").write_text(json.dumps(cal, indent=1, default=float))
    shutil.copyfile(var / "baseline.npy", base / "baseline.npy")
    print(f"{a.fire}: ×{timing['ros_multiplier']} (timing) → ×{cal['ros_multiplier']} (shape), "
          f"{cal['status']}; |Δ| {bm['median_abs_timing_error_h']:.1f} h, Sør hot {bm['sorensen']:.2f}")


if __name__ == "__main__":
    main()
