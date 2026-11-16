"""S6i shape calibration against MCD64A1 burned area (DECISIONS.md pre-registration S6i).

    uv run python -m rekindle.calibrate_shape --fire bc-2024 --workers 13

Frozen A+B model (the fire's calibration.json settings, hours, moisture). Sweeps the ROS
multiplier over MULTIPLIERS and scores each run inside the fire bbox:
- shape: Sørensen(model, MCD64A1 burned area) — the objective; ceiling = Sørensen(hotspots, MCD64A1);
- Sørensen(model, hotspots); raw and fair-interval timing vs hotspots; burn day within ±1 d.
Needs data/rekindle/<fire>/mcd64_burnday.npy (rekindle.burned_area). Writes
data/rekindle/<fire>/variants/shape_mcd64/{calibration.json, baseline.npy} and
docs/report/rekindle/<fire>_shape_calibration.json.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle import metrics
from rekindle.hindcast import CFG, baseline_scenario, load_model
from rekindle.levelset import run_levelset

MULTIPLIERS = [0.125, 0.18, 0.25, 0.35, 0.5, 0.71, 1.0, 1.41, 2.0, 2.83, 4.0, 5.66, 8.0]
RATIO_MIN, CEILING_MIN = 0.7, 0.3
REPORT = Path("docs/report/rekindle")
TAG = "shape_mcd64"


def in_bbox(meta: dict) -> np.ndarray:
    from pyproj import Transformer

    ny, nx = meta["shape"]
    t = meta["transform"]
    gx, gy = np.meshgrid(t[2] + (np.arange(nx) + 0.5) * t[0], t[5] + (np.arange(ny) + 0.5) * t[4])
    lon, lat = Transformer.from_crs(meta["crs"], "EPSG:4326", always_xy=True).transform(gx, gy)
    w, s, e, n = meta["bbox"]
    return (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)


def sor(a: np.ndarray, b: np.ndarray) -> float:
    return float(2 * (a & b).sum() / max(int(a.sum()) + int(b.sum()), 1))


def score(arr: np.ndarray, ref: dict) -> dict:
    box, mcd, hot, bd, prep, hours, epoch0 = (ref[k] for k in (
        "box", "mcd", "hot", "bd", "prep", "hours", "epoch0"))
    model = np.isfinite(arr) & (arr <= hours * 3600) & box
    passes = prep["passes"]
    raw, cen = [], []
    for key, t in prep["first"].items():
        if t <= 0:
            continue
        a = arr[key[0]:key[1], key[2]:key[3]]
        ts = float(a.min()) if a.size else np.inf
        prev = passes[passes < t]
        tp = prev[-1] if prev.size else -np.inf
        raw.append(abs(ts - t) / 3600)
        cen.append(0.0 if tp < ts <= t else (tp - ts if ts <= tp else ts - t) / 3600)
    raw, cen = np.array(raw), np.array(cen)
    both = mcd & model
    dd = np.floor(epoch0 + arr[both] / 86400) - bd[both]
    cell = ref["dx"] ** 2 / 1e6
    whole = np.isfinite(arr) & (arr <= hours * 3600)
    return {"sorensen_mcd64": sor(model, mcd), "sorensen_hotspots": sor(model, hot),
            "model_km2_bbox": float(model.sum() * cell), "model_km2_domain": float(whole.sum() * cell),
            "median_abs_h": float(np.median(raw)), "censored_median_h": float(np.median(cen)),
            "inside_interval": float(np.mean(cen == 0)),
            "burn_day_within_1d": float(np.mean(np.abs(dd) <= 1)) if dd.size else None}


_G: dict = {}


def _init(fire: str, cal: dict) -> None:
    dom, meta, series = load_model(fire, cal["model_settings"], cal["hours"])
    _G.update(dom=dom, meta=meta, series=series, cal=cal)


def _run(mult: float):
    g = _G
    sc = baseline_scenario(g["meta"], g["cal"]["hours"], g["cal"]["dead_moisture_pct"], mult,
                           g["series"])
    res = run_levelset(g["dom"], sc, CFG)
    return mult, res.arrival_time_s.astype(np.float32), res.metrics["wall_s"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", required=True)
    ap.add_argument("--workers", type=int, default=13)
    a = ap.parse_args()
    t_wall = time.time()
    base = dm.DATA / a.fire
    cal = json.loads((base / "calibration.json").read_text())
    dom, meta = dm.load(a.fire, nonveg_max_pct=cal["model_settings"].get("nonveg_max_pct"))
    t0 = dm.parse_t(meta["t0"])
    box = in_bbox(meta)
    bd = np.where(box, np.load(base / "mcd64_burnday.npy"), np.nan)
    prep = metrics.prepare(meta, dom.shape, dom.dx, cal["hours"] * 3600)
    ref = {"box": box, "mcd": np.isfinite(bd), "hot": prep["union"], "bd": bd, "prep": prep,
           "hours": cal["hours"], "dx": dom.dx,
           "epoch0": (t0 - dt.datetime(1970, 1, 1, tzinfo=t0.tzinfo)).total_seconds() / 86400}
    ceiling = sor(ref["hot"], ref["mcd"])
    with Pool(a.workers, initializer=_init, initargs=(a.fire, cal)) as pool:
        out = pool.map(_run, MULTIPLIERS)
    sweep = []
    for mult, arr, wall in out:
        s = score(arr, ref) | {"ros_multiplier": mult, "wall_s": wall}
        sweep.append(s)
        print(f"  ×{mult:<5} Sør MCD {s['sorensen_mcd64']:.3f}  hot {s['sorensen_hotspots']:.3f}  "
              f"km² box {s['model_km2_bbox']:7.1f} dom {s['model_km2_domain']:7.1f}  "
              f"|Δ| {s['median_abs_h']:6.1f} fair {s['censored_median_h']:6.1f} h  {wall:.0f} s",
              flush=True)
    bi = max(range(len(sweep)), key=lambda i: (sweep[i]["sorensen_mcd64"],
                                               -sweep[i]["censored_median_h"]))
    best = sweep[bi]
    ratio = best["sorensen_mcd64"] / ceiling if ceiling > 0 else 0.0
    status = "shape_validated" if (ratio >= RATIO_MIN and ceiling >= CEILING_MIN) else "shape_poor"
    out_dir = base / "variants" / TAG
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / "baseline.npy", out[bi][1])
    res = dict(cal, variant=TAG, ros_multiplier=best["ros_multiplier"], status=status,
               calibration_objective="Sørensen(model, MCD64A1) inside the fire bbox (S6i)",
               shape={"ceiling_hotspots_vs_mcd64": ceiling, "ratio": ratio,
                      "ratio_min": RATIO_MIN, "ceiling_min": CEILING_MIN, "best": best,
                      "sweep": sweep},
               timing_gate_note="the timing gate (calibration_timing.json) is reported separately",
               wall_s=time.time() - t_wall)
    (out_dir / "calibration.json").write_text(json.dumps(res, indent=1, default=float))
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / f"{a.fire}_shape_calibration.json").write_text(
        json.dumps({k: v for k, v in res.items() if k not in ("sweep", "moisture_estimate")},
                   indent=1, default=float))
    print(f"SHAPE {a.fire}: best ×{best['ros_multiplier']} Sør MCD {best['sorensen_mcd64']:.3f} "
          f"/ ceiling {ceiling:.3f} = {ratio:.2f} → {status}")


if __name__ == "__main__":
    main()
