"""S6d whole-fire FOOTPRINT what-ifs (user decision 2026-11-15; EXPLORATORY, shape only).

    uv run python -m rekindle.shape_whatif --fire sask-2023 --workers 4

For a fire whose whole-fire baseline failed the timing gate but whose final footprint matches the
detections (Sørensen ≥ 0.6): rerun the frozen baseline (calibration.json: settings, multiplier,
hours, hourly weather) with wind speed × WIND_SCALE and dead moisture + MOIST_DELTA points, and
compare final footprints. No gate passed, so the UI says: read the footprint, not the times.
Adds a "shape" entry to web/public/rekindle/<fire>/burst/index.json (rasters in burst/shape/),
in the same format as a burst window (CONTRACTS.md).
"""

from __future__ import annotations

import argparse
import json
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle import metrics
from rekindle.burst import REPORT, perturb, rate_table
from rekindle.export import WEB, burned_by_hour, encode, target_grid, to_3857, web_safe
from rekindle.hindcast import CFG, baseline_scenario, load_model
from rekindle.levelset import run_levelset

WIND_SCALE = [0.0, 0.5, 1.0, 1.5, 2.0]
MOIST_DELTA = [-6, -4, -2, 0, 2]
SORENSEN_MIN = 0.6

_G: dict = {}


def run_key(scale: float, dpp: int) -> str:
    return f"f_u{round(scale * 100):03d}_d{'m' if dpp < 0 else 'p'}{abs(dpp)}"


def _init(fire: str, cal: dict) -> None:
    dom, meta, series = load_model(fire, cal["model_settings"], cal["hours"])
    sc = baseline_scenario(meta, cal["hours"], cal["dead_moisture_pct"], cal["ros_multiplier"],
                           series)
    _G.update(dom=dom, meta=meta, sc=sc)


def _run(job: tuple[str, float, int]) -> tuple[str, np.ndarray, float]:
    key, scale, dpp = job
    res = run_levelset(_G["dom"], perturb(_G["sc"], scale, dpp), CFG)
    return key, res.arrival_time_s.astype(np.float32), res.metrics["wall_s"]


def flag_edges(fire: str, out: Path) -> None:
    """Mark runs whose fire reached the edge of the simulation domain (their area is then a lower
    bound), from the exported rasters: a reached cell on the domain's outer ring in the web grid."""
    import gzip

    from scipy.ndimage import binary_erosion

    meta = json.loads((dm.DATA / fire / "meta.json").read_text())
    ny, nx = meta["shape"]
    dst_t, h, w_px, _, _ = target_grid(meta, ny, nx)
    inside = np.isfinite(to_3857(np.zeros((ny, nx), np.float32), meta, dst_t, h, w_px))
    ring = inside & ~binary_erosion(inside, iterations=2, border_value=0)
    idx_path = out / "index.json"
    idx = json.loads(idx_path.read_text())
    shape = idx["shape"]
    s_dom, _ = dm.load(fire, nonveg_max_pct=(shape.get("model_settings") or {}).get(
        "nonveg_max_pct", 50.0))
    shape["domain_burnable_km2"] = round(float(s_dom.burnable().sum()) * s_dom.dx ** 2 / 1e6, 1)
    for r in shape["runs"]:
        raw = gzip.decompress((out.parent / r["file"]).read_bytes())
        u16 = np.frombuffer(raw, "<u2").reshape(h, w_px)
        r["domain_limited"] = bool(((u16 != 65535) & ring).any())
    idx_path.write_text(json.dumps(web_safe(idx), separators=(",", ":")))
    print("domain-limited runs:", [r["key"] for r in shape["runs"] if r["domain_limited"]])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", required=True)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", type=Path, default=WEB)
    ap.add_argument("--flag-only", action="store_true", help="only (re)flag domain-limited runs")
    a = ap.parse_args()
    if a.flag_only:
        flag_edges(a.fire, a.out / a.fire / "burst")
        return
    t_wall = time.time()
    cal = json.loads((dm.DATA / a.fire / "calibration.json").read_text())
    bm = cal["baseline_metrics"]
    # S6i: entry = shape validated against MCD64A1 (promote_shape); before S6i (sask S6d, user
    # decision) it was whole-fire Sørensen vs hotspots ≥ SORENSEN_MIN.
    if cal.get("status") != "shape_validated" and bm["sorensen"] < SORENSEN_MIN:
        raise SystemExit(f"status {cal.get('status')}, Sørensen {bm['sorensen']:.2f}: not shape "
                         "validated, no footprint what-ifs")
    hours = cal["hours"]
    _init(a.fire, cal)
    dom, meta, sc = _G["dom"], _G["meta"], _G["sc"]
    jobs = [(run_key(s, d), s, d) for s in WIND_SCALE for d in MOIST_DELTA]
    print(f"{len(jobs)} runs, ×{cal['ros_multiplier']}, {hours} h, {a.workers} workers")
    results: dict[str, np.ndarray] = {}
    with Pool(a.workers, initializer=_init, initargs=(a.fire, cal)) as pool:
        for i, (key, arr, wall) in enumerate(pool.imap_unordered(_run, jobs), 1):
            results[key] = arr
            print(f"[{i}/{len(jobs)}] {key} {wall:.0f} s", flush=True)

    base_key = run_key(1.0, 0)
    prep = metrics.prepare(meta, dom.shape, dom.dx, hours * 3600)
    check = metrics.score(results[base_key], prep)
    print(f"baseline rerun: |Δ| {check['median_abs_timing_error_h']:.2f} h (calibration "
          f"{bm['median_abs_timing_error_h']:.2f}), Sør {check['sorensen']:.3f} "
          f"({bm['sorensen']:.3f})")

    ny, nx = meta["shape"]
    dst_t, h, w_px, _, _ = target_grid(meta, ny, nx)
    out = a.out / a.fire / "burst"
    (out / "shape").mkdir(parents=True, exist_ok=True)
    for old in (out / "shape").glob("*.u16.gz"):
        old.unlink()
    runs, total = [], 0
    for s in WIND_SCALE:
        for d in MOIST_DELTA:
            key = run_key(s, d)
            arr = results[key]
            blob = encode(to_3857(arr, meta, dst_t, h, w_px), hours)
            (out / "shape" / f"{key}.u16.gz").write_bytes(blob)
            total += len(blob)
            byh = burned_by_hour(arr, dom.dx, int(hours))
            runs.append({"key": key, "file": f"burst/shape/{key}.u16.gz", "wind_scale": s,
                         "dead_delta_pct": d, "burned_km2_by_hour": byh, "start_km2": byh[0],
                         "end_km2": byh[-1], "new_km2": round(byh[-1] - byh[0], 3)})
    base = next(r for r in runs if r["key"] == base_key)
    for r in runs:
        r["new_km2_vs_baseline"] = round(r["new_km2"] - base["new_km2"], 3)
        r["new_ratio_vs_baseline"] = (round(r["new_km2"] / base["new_km2"], 3)
                                      if base["new_km2"] > 0 else None)
    shape = {
        "kind": "whole_fire_shape", "EXPLORATORY": True,
        "what": "Whole-fire footprint what-ifs. The baseline's final footprint matches the "
                "detections, but its timing failed the gate: read the footprint, not the times.",
        "index": 0, "t_k_h": 0.0, "ros_multiplier": cal["ros_multiplier"],
        "median_abs_timing_error_h": round(bm["median_abs_timing_error_h"], 2),
        "median_timing_error_h": round(bm["median_timing_error_h"], 2),
        "sorensen": round(bm["sorensen"], 3), "n_pixels": bm["n_pixels"],
        "hit_rate": round(bm["hit_rate"], 3), "area_km2": round(bm["area_km2"], 2),
        "observed_footprint_km2": round(bm["observed_footprint_km2"], 2),
        "qualifies": False,
        "reasons": [(f"timing gate failed ({bm['median_abs_timing_error_h']:.1f} h vs "
                    f"{cal['gate']['threshold_h']:.2f} h)")],
        "gate_h": round(cal["gate"]["threshold_h"], 3),
        "start": meta["t0"], "start_h_after_t0": 0.0, "hours": float(hours),
        "n_ignitions": len(meta["ignitions"]),
        "dead_1h_pct_baseline": cal["dead_moisture_pct"],
        "axes": {"wind_scale": WIND_SCALE, "dead_delta_pct": MOIST_DELTA, "dead_floor_pct": 2.0},
        "rothermel": rate_table(meta, sc, dom, prep, WIND_SCALE, MOIST_DELTA),
        "baseline_rerun_check": {"median_abs_timing_error_h": round(
            check["median_abs_timing_error_h"], 2), "sorensen": round(check["sorensen"], 3)},
        "runs": runs,
    }
    idx_path = out / "index.json"
    idx = json.loads(idx_path.read_text())
    idx["shape"] = shape | {"model_settings": cal["model_settings"]}
    idx_path.write_text(json.dumps(web_safe(idx), separators=(",", ":")))
    flag_edges(a.fire, out)
    (REPORT / f"{a.fire}_shape_whatif.json").write_text(json.dumps(
        {k: v for k, v in shape.items() if k != "runs"} | {"runs": [
            {k: v for k, v in r.items() if k != "burned_km2_by_hour"} for r in runs]}, indent=1))
    print(f"wrote {len(runs)} rasters ({total / 1e6:.2f} MB) → {out / 'shape'} in "
          f"{time.time() - t_wall:.0f} s")


if __name__ == "__main__":
    main()
