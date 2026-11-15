"""S6c EXPLORATORY burst-window what-ifs (DECISIONS.md "Pre-registration — S6c").

    uv run python -m rekindle.burst --fire chilecito-2026 --workers 6

Reads the fire's 24 h re-initialised windows result (docs/report/rekindle/<fire>_x_win24_AB_
windows.json, from `rekindle.hindcast --windows 24`). A window qualifies if, at its own best
multiplier, median |Δ| ≤ the fire's gate, Sørensen ≥ 0.4 and ≥ 50 pixels are scored. For each
qualifying window the window baseline (restart from the observed extent, observed hourly wind and
diurnal moisture) is rerun and perturbed: wind speed × WIND_SCALE (direction unchanged) and dead
moisture + MOIST_DELTA points (floor 2 %). Writes web/public/rekindle/<fire>/burst/index.json and
one uint16-minute raster per run (same grid and encoding as rekindle.export), plus the Rothermel
head-rate ratio for the same perturbations. Post-hoc and exploratory: not a validation.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import replace
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle import metrics
from rekindle.export import WEB, burned_by_hour, encode, target_grid, to_3857
from rekindle.fuels import fuel_bed
from rekindle.hindcast import (
    CFG,
    baseline_scenario,
    diurnal_moisture,
    ignition_elevation,
    window_case,
)
from rekindle.levelset import run_levelset
from rekindle.rothermel import FTMIN_TO_MS, MS_TO_FTMIN, head_fire, spread_params
from rekindle.scenario import MoistureSample, WindSample

REPORT = Path("docs/report/rekindle")
WIND_SCALE = [0.0, 0.5, 1.0, 1.5, 2.0]
MOIST_DELTA = [-2, 0, 2, 4]  # dead fuel moisture, percentage points
MOIST_FLOOR = 0.02
SORENSEN_MIN = 0.4
N_MIN = 50
RULE = (f"at the window's own best multiplier: median |Δ| ≤ the fire's gate, Sørensen ≥ "
        f"{SORENSEN_MIN}, ≥ {N_MIN} scored pixels (DECISIONS.md, S6c pre-registration)")


def run_key(i: int, scale: float, dpp: int) -> str:
    return f"w{i}_u{round(scale * 100):03d}_d{'m' if dpp < 0 else 'p'}{abs(dpp)}"


def _err(x) -> float:
    return float("inf") if x is None else float(x)


def evaluate(win: dict) -> list[dict]:
    """Every window at its own best multiplier, with the qualification verdict."""
    gate = win["gate"]["threshold_h"]
    out = []
    for i in range(len(win["sweep"][0]["windows"])):
        rows = [dict(s["windows"][i], ros_multiplier=s["ros_multiplier"]) for s in win["sweep"]]
        b = min(rows, key=lambda r: (_err(r["median_abs_timing_error_h"]), -(r["hit_rate"] or 0)))
        e, sor, n = _err(b["median_abs_timing_error_h"]), b["sorensen"] or 0.0, b["n_pixels"]
        reasons = []
        if not e <= gate:
            reasons.append(f"median |Δ| {e:.1f} h > gate {gate:.1f} h")
        if sor < SORENSEN_MIN:
            reasons.append(f"Sørensen {sor:.2f} < {SORENSEN_MIN}")
        if n < N_MIN:
            reasons.append(f"{n} scored pixels < {N_MIN}")
        dur = min(b["t_k_h"] + win["window_h"], win["hours"]) - b["t_k_h"]
        if dur < win["window_h"]:
            # Deviation (DECISIONS.md S6c): the rule is for 24 h windows; a tail window clipped by
            # the end of the detections is excluded (found when sask-2023's 2 h tail passed).
            reasons.append(f"only {dur:.0f} h long (the detections end there); the rule is for "
                           f"{win['window_h']:.0f} h windows")
        out.append({"index": i, "t_k_h": b["t_k_h"], "ros_multiplier": b["ros_multiplier"],
                    "median_abs_timing_error_h": None if e == float("inf") else round(e, 2),
                    "median_timing_error_h": b["median_timing_error_h"] and round(
                        b["median_timing_error_h"], 2),
                    "sorensen": round(sor, 3), "n_pixels": n,
                    "hit_rate": b["hit_rate"] and round(b["hit_rate"], 3),
                    "area_km2": round(b["area_km2"], 2),
                    "observed_footprint_km2": round(b["observed_footprint_km2"], 2),
                    "qualifies": not reasons, "reasons": reasons})
    return out


def perturb(sc, scale: float, dpp: int):
    """Scenario with the wind speed scaled and the dead moisture shifted by dpp points."""
    wind = tuple(WindSample(w.t_s, w.speed_ms * scale, w.from_deg) for w in sc.wind)
    d = dpp / 100.0

    def sh(x: float) -> float:
        return max(MOIST_FLOOR, x + d)

    series = tuple(MoistureSample(s.t_s, sh(s.d1), sh(s.d10), sh(s.d100))
                   for s in sc.moisture_series)
    m = replace(sc.moisture, d1=sh(sc.moisture.d1), d10=sh(sc.moisture.d10),
                d100=sh(sc.moisture.d100))
    return replace(sc, wind=wind, moisture=m, moisture_series=series,
                   label=f"u×{scale:g} dead{dpp:+d}")


_G: dict = {}


def _init(fire: str, settings: dict) -> None:
    dom, meta = dm.load(fire, nonveg_max_pct=settings.get("nonveg_max_pct"))
    _G.update(dom=dom, meta=meta, settings=settings, elev=ignition_elevation(fire, meta, dom))


def window_scenario(t_k_h: float, win_h: float, hours: float, d1: float, mult: float):
    m, dur_s, _ = window_case(_G["meta"], t_k_h, win_h, hours, "restart")
    series = ()
    if _G["settings"].get("diurnal_moisture"):
        series = diurnal_moisture(m, _G["elev"], dur_s / 3600)
    return m, dur_s, baseline_scenario(m, dur_s / 3600, d1, mult, series)


def _run(job: tuple) -> tuple[str, np.ndarray, float]:
    key, t_k_h, win_h, hours, d1, mult, scale, dpp = job
    _, _, sc = window_scenario(t_k_h, win_h, hours, d1, mult)
    res = run_levelset(_G["dom"], perturb(sc, scale, dpp), CFG)
    return key, res.arrival_time_s.astype(np.float32), res.metrics["wall_s"]


def rate_table(meta_w: dict, sc, dom, prep: dict, scales=None, dpps=None) -> dict:
    """Rothermel head rate (flat ground) for the dominant fuel model under the window's scored
    detections, at the window's median 10 m wind and median dead moisture, per perturbation."""
    ny = dom.shape[0]
    fms = []
    for t, _, o in prep["obs"]:
        if t > 0:
            fm = int(dom.fuel[int((ny * dom.dx - o["y_m"]) // dom.dx), int(o["x_m"] // dom.dx)])
            if fm:
                fms.append(fm)
    fm = int(np.bincount(fms).argmax()) if fms else 1
    u10 = float(np.median([w.speed_ms for w in sc.wind if 0 <= w.t_s <= sc.duration_s]
                          or [w.speed_ms for w in sc.wind]))
    ser = sc.moisture_series
    base = sc.moisture
    if ser:
        base = replace(base, d1=float(np.median([s.d1 for s in ser])),
                       d10=float(np.median([s.d10 for s in ser])),
                       d100=float(np.median([s.d100 for s in ser])))
    rows = {}
    for scale in scales or WIND_SCALE:
        for dpp in dpps or MOIST_DELTA:
            m = perturb(replace(sc, moisture=base, moisture_series=()), 1.0, dpp).moisture
            p = spread_params(fuel_bed(fm), m.as_tuple())
            hf = head_fire(p, u10 * scale / 1.15 * sc.waf * MS_TO_FTMIN, 0.0, 0.0, 0.0)
            rows[(scale, dpp)] = float(hf.r_head) * FTMIN_TO_MS * 3.6
    r0 = rows[(1.0, 0)]
    return {"fuel_model": fm, "wind_10m_ms_median": round(u10, 2),
            "dead_1h_pct_median": round(base.d1 * 100, 2),
            "ros_multiplier_not_applied": True,
            "rows": [{"wind_scale": s, "dead_delta_pct": d, "head_kmh": round(v, 3),
                      "ratio": round(v / r0, 3) if r0 > 0 else None}
                     for (s, d), v in rows.items()]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", required=True)
    ap.add_argument("--windows-json", type=Path, default=None)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--out", type=Path, default=WEB)
    a = ap.parse_args()
    t_wall = time.time()
    wpath = a.windows_json or REPORT / f"{a.fire}_x_win24_AB_windows.json"
    win = json.loads(wpath.read_text())
    assert win["window_ignite"] == "restart", "burst what-ifs restart from the observed extent"
    settings, hours, win_h, d1 = (win["model_settings"], win["hours"], win["window_h"],
                                  win["dead_moisture_pct"])
    ev = evaluate(win)
    qual = [w for w in ev if w["qualifies"]]
    for w in ev:
        print(f"  window {w['index']} (t={w['t_k_h']:.0f} h) ×{w['ros_multiplier']}: "
              f"|Δ| {w['median_abs_timing_error_h']} h, Sør {w['sorensen']}, n {w['n_pixels']}"
              f" → {'QUALIFIES' if w['qualifies'] else '; '.join(w['reasons'])}")

    _init(a.fire, settings)
    dom, meta = _G["dom"], _G["meta"]
    ny, nx = meta["shape"]
    dst_t, h, w_px, _, _ = target_grid(meta, ny, nx)
    out = a.out / a.fire / "burst"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.u16.gz"):
        old.unlink()

    t0 = dm.parse_t(meta["t0"])
    windows = []
    jobs = []
    for q in qual:
        m_w, dur_s, sc = window_scenario(q["t_k_h"], win_h, hours, d1, q["ros_multiplier"])
        prep = metrics.prepare(m_w, dom.shape, dom.dx, dur_s, 0.0)
        start = dm.parse_t(m_w["t0"])
        obs = [{"lon": o["lon"], "lat": o["lat"], "t_h": round(t / 3600, 3), "sensor": o["sensor"]}
               for t, _, o in prep["obs"] if t > 0]
        windows.append({**q, "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "start_h_after_t0": round((start - t0).total_seconds() / 3600, 2),
                        "hours": round(dur_s / 3600, 2), "n_ignitions": len(m_w["ignitions"]),
                        "rothermel": rate_table(m_w, sc, dom, prep), "observed": obs,
                        "_prep": prep})
        for scale in WIND_SCALE:
            for dpp in MOIST_DELTA:
                jobs.append((run_key(q["index"], scale, dpp), q["t_k_h"], win_h, hours, d1,
                             q["ros_multiplier"], scale, dpp))
    print(f"{len(qual)} qualifying window(s), {len(jobs)} runs, {a.workers} workers")
    results: dict[str, np.ndarray] = {}
    if jobs:
        with Pool(a.workers, initializer=_init, initargs=(a.fire, settings)) as pool:
            for i, (key, arr, wall) in enumerate(pool.imap_unordered(_run, jobs), 1):
                results[key] = arr
                print(f"[{i}/{len(jobs)}] {key} {wall:.0f} s", flush=True)

    total = 0
    for wd in windows:
        prep = wd.pop("_prep")
        dur_h = wd["hours"]
        hrs = int(np.ceil(dur_h))
        runs = []
        for scale in WIND_SCALE:
            for dpp in MOIST_DELTA:
                key = run_key(wd["index"], scale, dpp)
                arr = results[key]
                blob = encode(to_3857(arr, meta, dst_t, h, w_px), dur_h)
                (out / f"{key}.u16.gz").write_bytes(blob)
                total += len(blob)
                byh = burned_by_hour(arr, dom.dx, hrs)
                runs.append({"key": key, "file": f"burst/{key}.u16.gz", "wind_scale": scale,
                             "dead_delta_pct": dpp, "burned_km2_by_hour": byh,
                             "start_km2": byh[0], "end_km2": byh[-1],
                             "new_km2": round(byh[-1] - byh[0], 3)})
        base = next(r for r in runs if r["wind_scale"] == 1.0 and r["dead_delta_pct"] == 0)
        check = metrics.score(results[base["key"]], prep)
        wd["baseline_rerun_check"] = {
            "median_abs_timing_error_h": round(check["median_abs_timing_error_h"], 2),
            "sorensen": round(check["sorensen"], 3)}
        print(f"window {wd['index']}: rerun |Δ| {check['median_abs_timing_error_h']:.2f} h "
              f"(windows file {wd['median_abs_timing_error_h']}), Sør {check['sorensen']:.3f}")
        for r in runs:
            r["new_km2_vs_baseline"] = round(r["new_km2"] - base["new_km2"], 3)
            r["new_ratio_vs_baseline"] = (round(r["new_km2"] / base["new_km2"], 3)
                                          if base["new_km2"] > 0 else None)
        wd["runs"] = runs
    idx = {"fire": a.fire, "EXPLORATORY": True, "post_hoc": True,
           "what": "What-ifs only for 24 h windows where the hindcast, restarted from the "
                   "observed extent, matched the detections. Chosen with hindsight; the "
                   "whole-fire pre-registered gate still fails.",
           "rule": RULE, "gate_h": round(win["gate"]["threshold_h"], 3),
           "model_settings": settings, "source": str(wpath).replace("\\", "/"),
           "axes": {"wind_scale": WIND_SCALE, "dead_delta_pct": MOIST_DELTA,
                    "dead_floor_pct": MOIST_FLOOR * 100},
           "all_windows": ev, "windows": windows}
    old_idx = out / "index.json"
    if old_idx.exists() and "shape" in (prev := json.loads(old_idx.read_text())):
        idx["shape"] = prev["shape"]  # rekindle.shape_whatif output (burst/shape/), kept
    old_idx.write_text(json.dumps(idx, separators=(",", ":")))
    REPORT.mkdir(parents=True, exist_ok=True)
    slim = {**idx, "windows": [{k: v for k, v in wd.items() if k != "observed"}
                               for wd in windows]}
    (REPORT / f"{a.fire}_burst.json").write_text(json.dumps(slim, indent=1))
    print(f"wrote {len(results)} rasters ({total / 1e6:.2f} MB) → {out} in "
          f"{time.time() - t_wall:.0f} s")


if __name__ == "__main__":
    main()
