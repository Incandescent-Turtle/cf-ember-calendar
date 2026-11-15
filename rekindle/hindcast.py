"""Baseline hindcast, ROS-multiplier calibration and quality gate (REKINDLE.md §5).

    uv run python -m rekindle.hindcast --fire chilecito-2026 --workers 3

Writes data/rekindle/<fire>/calibration.json and baseline arrival field (baseline.npy), and
the sweep table/figure to docs/report/rekindle/.
"""

from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle import metrics
from rekindle.levelset import SolverConfig, run_levelset

CFG = SolverConfig(stop_at_edge=False)  # a fire leaving the domain keeps burning inside it
from rekindle.scenario import Moisture, MoistureSample, Scenario

MULTIPLIERS = [0.25, 0.35, 0.5, 0.71, 1.0, 1.41, 2.0, 2.83, 4.0]
MOISTURE_AXIS = [3, 4, 6, 8, 10, 14]  # dead 1-h %, also the scenario-grid axis


def moisture(d1_pct: float) -> Moisture:
    """1-h value; 10-h = +1, 100-h = +2 points; live fixed (CONTRACTS.md notes)."""
    return Moisture(d1=d1_pct / 100, d10=(d1_pct + 1) / 100, d100=(d1_pct + 2) / 100)


def simard_emc(rh_pct: float, t_c: float) -> float:
    """Equilibrium moisture content (%) of fine dead fuel, Simard (1968) as in NFDRS."""
    t_f = t_c * 9 / 5 + 32
    h = rh_pct
    if h < 10:
        return 0.03229 + 0.281073 * h - 0.000578 * h * t_f
    if h < 50:
        return 2.22749 + 0.160107 * h - 0.01478 * t_f
    return 21.0606 + 0.005565 * h**2 - 0.00035 * h * t_f - 0.483199 * h


def emc_series(meta: dict, elev_m: float) -> list[tuple[float, float, float]]:
    """(t_s after t0, RH %, EMC %) for every MERRA-2 hour, pressure at elev_m."""
    t0 = dm.parse_t(meta["t0"])
    p_hpa = 1013.25 * (1 - 2.25577e-5 * elev_m) ** 5.25588
    out = []
    for w in meta["wind"]:
        q = w["qv2m_gkg"] / 1000
        e = q * p_hpa / (0.622 + 0.378 * q)
        es = 6.112 * math.exp(17.67 * w["t2m_c"] / (w["t2m_c"] + 243.5))
        rh = min(100.0, 100 * e / es)
        out.append(((dm.parse_t(w["t"]) - t0).total_seconds(), rh, simard_emc(rh, w["t2m_c"])))
    return out


TIMELAG_H = (1.0, 10.0, 100.0)  # 1-h, 10-h, 100-h dead fuel classes


def diurnal_moisture(meta: dict, elev_m: float, hours: float) -> tuple[MoistureSample, ...]:
    """Hourly dead moisture: each class relaxes toward EMC with its time lag (S6b change B).

    m <- EMC + (m - EMC)·exp(-Δt/τ), EMC averaged over the step. Start: 1-h = EMC at the
    first hour (<= 1 h before t0); 10-h and 100-h = median EMC over the run.
    """
    ser = [x for x in emc_series(meta, elev_m) if -3600 <= x[0] <= hours * 3600 + 3600]
    run = [e for t, _, e in ser if 0 <= t <= hours * 3600]
    m = [ser[0][2], float(np.median(run)), float(np.median(run))]
    out = [MoistureSample(ser[0][0], *(round(v / 100, 5) for v in m))]
    for (ta, _, ea), (tb, _, eb) in itertools.pairwise(ser):
        emc = (ea + eb) / 2
        dt_h = (tb - ta) / 3600
        m = [emc + (v - emc) * math.exp(-dt_h / tau) for v, tau in zip(m, TIMELAG_H, strict=True)]
        out.append(MoistureSample(tb, *(round(v / 100, 5) for v in m)))
    return tuple(out)


def estimate_dead_moisture(meta: dict, elev_m: float, hours: float) -> dict:
    """1-h moisture estimate from MERRA-2 T2M/QV2M (EMC, no lag), over the run window."""
    ser = [x for x in emc_series(meta, elev_m) if 0 <= x[0] / 3600 <= hours]
    rhs = [rh for _, rh, _ in ser]
    v = np.array([e for _, _, e in ser])
    return {"method": "Simard (1968) EMC from MERRA-2 T2M/QV2M (2 m, grid-cell mean), "
                      f"pressure at the ignition elevation {elev_m:.0f} m; no time lag",
            "rh_pct_median": float(np.median(rhs)), "emc_pct_median": float(np.median(v)),
            "emc_pct_p10": float(np.percentile(v, 10)), "emc_pct_p90": float(np.percentile(v, 90))}


def baseline_scenario(meta: dict, hours: float, d1_pct: float, mult: float,
                      series: tuple[MoistureSample, ...] = ()) -> Scenario:
    return Scenario(ignitions=dm.ignitions(meta), duration_s=hours * 3600,
                    wind=dm.observed_wind(meta), moisture=moisture(d1_pct),
                    moisture_series=series, ros_multiplier=mult, label="baseline")


def ignition_elevation(fire: str, meta: dict, dom) -> float:
    elev = np.load(dm.DATA / fire / "domain.npz")["elevation"]
    ny = dom.shape[0]
    return float(np.median([elev[int((ny * dom.dx - g["y_m"]) // dom.dx), int(g["x_m"] // dom.dx)]
                            for g in meta["ignitions"]]))


def model_settings(nonveg_max_pct: float | None = None, diurnal: bool = False,
                   wind: str = "bilinear", seed_h: float = 0.0) -> dict:
    """The S6b model options (docs/DECISIONS.md); defaults = the S6 model. seed_h > 0 is the
    EXPLORATORY seeded start (not pre-registered)."""
    return {"nonveg_max_pct": nonveg_max_pct, "diurnal_moisture": diurnal, "wind": wind,
            "seed_h": seed_h}


def apply_seed(meta: dict, settings: dict) -> dict:
    """seed_h > 0: every detection within seed_h hours of the first one is an ignition at its
    own detection time (exploratory; those pixels are then not scored)."""
    seed_h = settings.get("seed_h") or 0.0
    if seed_h <= 0:
        return meta
    t0 = dm.parse_t(meta["t0"])
    ign = []
    for o in meta["observed"]:
        t_s = (dm.parse_t(o["t"]) - t0).total_seconds()
        if t_s <= seed_h * 3600:
            ign.append(dict(o, t_s=t_s))
    return dict(meta, ignitions=ign)


def apply_wind(fire: str, meta: dict, settings: dict) -> dict:
    """wind = "nearest": MERRA-2 nearest grid point (raw/merra2_point_nearest.json, from
    `rekindle.prep.fetch_wind(..., nearest=True)`) replaces the bilinear series (change C)."""
    if settings.get("wind", "bilinear") == "bilinear":
        return meta
    path = dm.DATA / fire / "raw" / "merra2_point_nearest.json"
    return dict(meta, wind=json.loads(path.read_text()))


def load_model(fire: str, settings: dict, hours: float):
    """Domain, meta and moisture series for these settings."""
    dom, meta = dm.load(fire, nonveg_max_pct=settings.get("nonveg_max_pct"))
    meta = apply_seed(apply_wind(fire, meta, settings), settings)
    series: tuple[MoistureSample, ...] = ()
    if settings.get("diurnal_moisture"):
        series = diurnal_moisture(meta, ignition_elevation(fire, meta, dom), hours)
    return dom, meta, series


def window_starts(meta: dict, hours: float, win_h: float) -> list[float]:
    """Window start times t_k = k·win_h (h after t0) while t_k < the last detection and < hours."""
    t0 = dm.parse_t(meta["t0"])
    last_h = max((dm.parse_t(o["t"]) - t0).total_seconds() / 3600 for o in meta["observed"])
    out, k = [], 0
    while k * win_h < min(last_h, hours):
        out.append(k * win_h)
        k += 1
    return out


def window_case(meta: dict, t_k_h: float, win_h: float, hours: float,
                mode: str = "restart") -> tuple[dict, float, float]:
    """EXPLORATORY re-initialised window (REKINDLE.md §5b; pre-registered in DECISIONS.md).

    Every detection with t <= t_k is an ignition; the window runs to min(t_k + win_h, hours) and
    only pixels first detected in (t_k, t_end] are scored. mode "restart": ignitions at t_k (the
    observed extent at restart) and the clock is shifted so t0 = t_k; mode "own": ignitions at
    their own detection times, clock unchanged. Returns (meta for the run, duration_s, seed_s);
    score with metrics.prepare(meta, ..., duration_s, seed_s).
    """
    t0 = dm.parse_t(meta["t0"])
    t_k = t_k_h * 3600
    t_end = min(t_k_h + win_h, hours) * 3600
    ign = []
    for o in meta["observed"]:
        t_s = (dm.parse_t(o["t"]) - t0).total_seconds()
        if t_s <= t_k:
            ign.append(dict(o, t_s=0.0 if mode == "restart" else t_s))
    if mode == "restart":
        new_t0 = (t0 + dt.timedelta(seconds=t_k)).isoformat()
        return dict(meta, t0=new_t0, ignitions=ign), t_end - t_k, 0.0
    return dict(meta, ignitions=ign), t_end, t_k


def run_windows(dom, meta: dict, settings: dict, elev_m: float, hours: float, win_h: float,
                mult: float, d1: float, mode: str = "restart") -> dict:
    """All windows at one ROS multiplier: pooled Δ (the gated median |Δ|) and per-window metrics."""
    pooled: list[float] = []
    per = []
    hits = n_obs = 0
    for t_k in window_starts(meta, hours, win_h):
        m, dur_s, seed_s = window_case(meta, t_k, win_h, hours, mode)
        series: tuple[MoistureSample, ...] = ()
        if settings.get("diurnal_moisture"):
            series = diurnal_moisture(m, elev_m, dur_s / 3600)
        sc = baseline_scenario(m, dur_s / 3600, d1, mult, series)
        res = run_levelset(dom, sc, CFG)
        prep = metrics.prepare(m, dom.shape, dom.dx, dur_s, seed_s)
        sm = metrics.score(res.arrival_time_s, prep, return_deltas=True)
        dl = sm.pop("deltas_h")
        pooled += dl
        hits += sm.pop("n_hits")
        n_obs += sm.pop("n_obs")
        per.append(metrics.json_safe(dict(sm, t_k_h=t_k, n_ignitions=len(m["ignitions"]),
                                          wall_s=res.metrics["wall_s"])))
    d = np.array(pooled)
    return {"ros_multiplier": mult, "n_pixels": int(d.size),
            "n_reached": int(np.isfinite(d).sum()),
            "median_abs_timing_error_h": float(np.median(np.abs(d))) if d.size else None,
            "median_timing_error_h": float(np.median(d)) if d.size else None,
            "hit_rate": hits / n_obs if n_obs else None, "windows": per}


_G: dict = {}


def _init(fire: str, hours: float, d1: float, settings: dict) -> None:
    dom, meta, series = load_model(fire, settings, hours)
    _G.update(dom=dom, meta=meta, hours=hours, d1=d1, series=series,
              prep=metrics.prepare(meta, dom.shape, dom.dx, hours * 3600,
                                   (settings.get("seed_h") or 0.0) * 3600))


def _run(mult: float):
    sc = baseline_scenario(_G["meta"], _G["hours"], _G["d1"], mult, _G["series"])
    res = run_levelset(_G["dom"], sc, CFG)
    m = metrics.score(res.arrival_time_s, _G["prep"])
    m.update(ros_multiplier=mult, wall_s=res.metrics["wall_s"],
             edge_reached=res.metrics["edge_reached"])
    return mult, m, res.arrival_time_s.astype(np.float32), res.params_hash


def _init_win(fire: str, settings: dict, hours: float, win_h: float, d1: float,
              mode: str) -> None:
    dom, meta = dm.load(fire, nonveg_max_pct=settings.get("nonveg_max_pct"))
    meta = apply_wind(fire, meta, settings)
    _G.update(dom=dom, meta=meta, settings=settings, hours=hours, win_h=win_h, d1=d1, mode=mode,
              elev=ignition_elevation(fire, meta, dom))


def _run_win(mult: float) -> dict:
    return run_windows(_G["dom"], _G["meta"], _G["settings"], _G["elev"], _G["hours"],
                       _G["win_h"], mult, _G["d1"], _G["mode"])


def windows_main(a, settings: dict, hours: float, d1: float, gate_h: float, out_dir: Path,
                 name: str) -> None:
    t_wall = time.time()
    with Pool(a.workers, initializer=_init_win,
              initargs=(a.fire, settings, hours, a.windows, d1, a.window_ignite)) as pool:
        sweep = pool.map(_run_win, MULTIPLIERS)
    best = min(sweep, key=lambda m: (m["median_abs_timing_error_h"], -(m["hit_rate"] or 0)))
    passed = bool(best["median_abs_timing_error_h"] <= gate_h)
    for m in sweep:
        per = ", ".join(f"{w['median_abs_timing_error_h']:.1f}" if w["median_abs_timing_error_h"]
                        is not None else "—" for w in m["windows"])
        print(f"  ×{m['ros_multiplier']:<5} pooled med|Δ| {m['median_abs_timing_error_h']:7.2f} h"
              f"  medΔ {m['median_timing_error_h']:7.2f}  hit {m['hit_rate']:.2f}  "
              f"n {m['n_pixels']}  per-window med|Δ| [{per}]")
    res = {"fire": a.fire, "variant": a.tag, "EXPLORATORY": True,
           "exploratory": "24 h re-initialised windows, proposed after the S6b failures "
                          "(DECISIONS.md pre-registration 15:14); not a validation",
           "model_settings": settings, "window_h": a.windows, "window_ignite": a.window_ignite,
           "hours": hours, "dead_moisture_pct": d1,
           "gate": {"rule": "pooled median |Δ| ≤ mean interval between overpasses",
                    "threshold_h": gate_h, "passed": passed},
           "ros_multiplier": best["ros_multiplier"], "best": metrics.json_safe(best),
           "sweep": [metrics.json_safe(m) for m in sweep], "wall_s": time.time() - t_wall}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "windows.json").write_text(json.dumps(res, indent=1))
    a.report.mkdir(parents=True, exist_ok=True)
    (a.report / f"{name}_windows.json").write_text(json.dumps(res, indent=1))
    print(f"EXPLORATORY windows: best ×{best['ros_multiplier']} pooled med|Δ| "
          f"{best['median_abs_timing_error_h']:.2f} h, gate {gate_h:.2f} h → "
          f"{'PASS' if passed else 'fail'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--hours", type=float, default=None, help="default: to the last detection")
    ap.add_argument("--d1", type=float, default=None, help="baseline dead 1-h %% (default: EMC)")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--report", type=Path, default=Path("docs/report/rekindle"))
    ap.add_argument("--figures-only", action="store_true", help="map figure from baseline.npy")
    ap.add_argument("--nonveg-max", type=float, default=None,
                    help="S6b A: non-burnable where MOD44B non-vegetated %% > this")
    ap.add_argument("--diurnal", action="store_true", help="S6b B: hourly time-lag moisture")
    ap.add_argument("--wind", choices=["bilinear", "nearest"], default="bilinear",
                    help="S6b C: MERRA-2 nearest grid point")
    ap.add_argument("--seed-h", type=float, default=0.0,
                    help="EXPLORATORY: ignite every detection within this many hours")
    ap.add_argument("--windows", type=float, default=0.0,
                    help="EXPLORATORY: re-initialised windows of this many hours (REKINDLE §5b)")
    ap.add_argument("--window-ignite", choices=["restart", "own"], default="restart",
                    help="windows: ignite earlier detections at t_k (restart) or at their times")
    ap.add_argument("--tag", default="", help="variant name: writes to variants/<tag>/ and "
                    "<fire>_<tag>_* report files instead of the fire's baseline")
    a = ap.parse_args()
    settings = model_settings(a.nonveg_max, a.diurnal, a.wind, a.seed_h)
    out_dir = dm.DATA / a.fire / ("variants/" + a.tag if a.tag else "")
    name = f"{a.fire}_{a.tag}" if a.tag else a.fire
    if a.figures_only:
        map_figure(a.fire, a.report / "figures", out_dir, name)
        return
    dom, meta = dm.load(a.fire)
    meta = apply_wind(a.fire, meta, settings)
    t0 = dm.parse_t(meta["t0"])
    last = max(dm.parse_t(o["t"]) for o in meta["observed"])
    hours = a.hours or math.ceil((last - t0).total_seconds() / 3600)
    ig_elev = ignition_elevation(a.fire, meta, dom)
    emc = estimate_dead_moisture(meta, ig_elev, hours)
    d1 = a.d1 if a.d1 is not None else min(MOISTURE_AXIS, key=lambda m: abs(m - emc["emc_pct_median"]))
    print(f"run {hours} h; EMC median {emc['emc_pct_median']:.1f} % (RH {emc['rh_pct_median']:.0f} %)"
          f" → baseline dead 1-h {d1} %")
    if a.windows:
        gate_h = metrics.prepare(meta, dom.shape, dom.dx, hours * 3600)["overpass_mean_h"]
        print(f"settings {settings}, windows {a.windows:g} h ({a.window_ignite}) -> {out_dir}")
        windows_main(a, settings, hours, d1, gate_h, out_dir, name)
        return
    t_wall = time.time()
    print(f"settings {settings} -> {out_dir}")
    with Pool(a.workers, initializer=_init, initargs=(a.fire, hours, d1, settings)) as pool:
        out = pool.map(_run, MULTIPLIERS)
    sweep = [m for _, m, _, _ in out]
    prep = metrics.prepare(meta, dom.shape, dom.dx, hours * 3600, a.seed_h * 3600)

    def key(m: dict):
        return (m["median_abs_timing_error_h"], -(m["hit_rate"] or 0))

    best_i = min(range(len(sweep)), key=lambda i: key(sweep[i]))
    best = sweep[best_i]
    gate_h = prep["overpass_mean_h"]
    passed = bool(best["median_abs_timing_error_h"] is not None
                  and best["median_abs_timing_error_h"] <= gate_h)
    status = "validated" if passed else "poor_agreement"
    for m in sweep:
        print(f"  ×{m['ros_multiplier']:<5} med|Δ| {m['median_abs_timing_error_h']:7.2f} h  "
              f"medΔ {m['median_timing_error_h']:7.2f}  hit {m['hit_rate']:.2f}  "
              f"Sør {m['sorensen']:.2f}  area {m['area_km2']:7.1f} km²  {m['wall_s']:.0f} s"
              f"{'  EDGE' if m['edge_reached'] else ''}")
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / "baseline.npy", out[best_i][2])
    cal = {
        "fire": a.fire, "variant": a.tag or None, "model_settings": settings,
        "hours": hours, "t0": meta["t0"], "dead_moisture_pct": d1,
        "moisture_estimate": emc, "ros_multiplier": best["ros_multiplier"],
        "params_hash": out[best_i][3],
        "gate": {"rule": "median |Δ| ≤ mean interval between overpasses (REKINDLE.md §5)",
                 "threshold_h": gate_h, "overpass_median_gap_h": prep["overpass_median_h"],
                 "passed": passed},
        "status": status, "baseline_metrics": metrics.json_safe(best),
        "sweep": [metrics.json_safe(m) for m in sweep],
        "calibrated_not_blind": "the multiplier is fitted on this fire's own detections",
        "exploratory": ("seeded start (not pre-registered): detections within "
                        f"{a.seed_h:g} h are ignitions and are not scored") if a.seed_h else None,
        "n_ignitions": len(apply_seed(meta, settings)["ignitions"]),
        "wall_s": time.time() - t_wall,
    }
    (out_dir / "calibration.json").write_text(json.dumps(cal, indent=1))
    a.report.mkdir(parents=True, exist_ok=True)
    (a.report / f"{name}_calibration.json").write_text(json.dumps(cal, indent=1))
    _figure(sweep, best["ros_multiplier"], gate_h, a.report / "figures", name)
    map_figure(a.fire, a.report / "figures", out_dir, name)
    print(f"best ×{best['ros_multiplier']}  gate {gate_h:.2f} h → {status}")


def _figure(sweep, best, gate_h, figs: Path, fire: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figs.mkdir(parents=True, exist_ok=True)
    mult = [m["ros_multiplier"] for m in sweep]
    fig, ax = plt.subplots(1, 2, figsize=(8, 3.2))
    med = [m["median_abs_timing_error_h"] if m["median_abs_timing_error_h"] is not None
           else np.nan for m in sweep]
    ax[0].plot(mult, med, "o-", label="median |Δ|")
    ax[0].plot(mult, [m["median_timing_error_h"] if m["median_timing_error_h"] is not None
                      else np.nan for m in sweep], "s--", label="median Δ")
    ax[0].axhline(gate_h, color="C3", lw=0.8, ls=":", label=f"gate {gate_h:.1f} h")
    ax[0].axhline(0, color="k", lw=0.5)
    ax[0].set(xscale="log", xlabel="ROS multiplier", ylabel="hours")
    ax[0].legend(fontsize=7)
    ax[1].plot(mult, [m["hit_rate"] for m in sweep], "o-", label="hit rate")
    ax[1].plot(mult, [m["sorensen"] for m in sweep], "s-", label="Sørensen")
    ax[1].plot(mult, [m["consistent_rate"] for m in sweep], "^-", label="arrives between passes")
    ax[1].set(xscale="log", xlabel="ROS multiplier", ylim=(0, 1))
    ax[1].legend(fontsize=7)
    for x in ax:
        x.axvline(best, color="0.6", lw=0.8)
        x.set_xticks(mult, [f"{m:g}" for m in mult], fontsize=7)
    fig.suptitle(f"{fire}: baseline ROS-multiplier sweep (fitted on its own detections)",
                 fontsize=9)
    for ext in ("pdf", "png"):
        fig.savefig(figs / f"{fire}_calibration.{ext}", dpi=150, bbox_inches="tight")
    plt.close(fig)


def map_figure(fire: str, figs: Path, run_dir: Path | None = None, name: str = "") -> None:
    """Baseline arrival time vs detections, with terrain and fuels (report figure)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    run_dir = run_dir or dm.DATA / fire
    name = name or fire
    cal = json.loads((run_dir / "calibration.json").read_text())
    settings = cal.get("model_settings") or {}
    dom, meta = dm.load(fire, nonveg_max_pct=settings.get("nonveg_max_pct"))
    d = np.load(dm.DATA / fire / "domain.npz")
    arr = np.load(run_dir / "baseline.npy")
    t0 = dm.parse_t(meta["t0"])
    ny, nx = dom.shape
    ext = [0, nx * dom.dx / 1e3, 0, ny * dom.dx / 1e3]
    ox = np.array([o["x_m"] for o in meta["observed"]]) / 1e3
    oy = np.array([o["y_m"] for o in meta["observed"]]) / 1e3
    oh = np.array([(dm.parse_t(o["t"]) - t0).total_seconds() / 3600 for o in meta["observed"]])
    hours = cal["hours"]
    fig, ax = plt.subplots(1, 3, figsize=(13, 4.3))
    im = ax[0].imshow(np.where(np.isfinite(arr), arr / 3600, np.nan), extent=ext, cmap="inferno",
                      vmin=0, vmax=hours)
    ax[0].scatter(ox, oy, c=oh, s=5, cmap="inferno", vmin=0, vmax=hours, edgecolors="w",
                  linewidths=0.3)
    fig.colorbar(im, ax=ax[0], label="hours after first detection")
    ax[0].set_title(f"{cal.get('variant') or 'Baseline'} ×{cal['ros_multiplier']}: simulated "
                    "arrival; dots = FIRMS", fontsize=8)
    im = ax[1].imshow(d["elevation"], extent=ext, cmap="terrain")
    fig.colorbar(im, ax=ax[1], label="m")
    ax[1].set_title("Copernicus GLO-30 elevation", fontsize=8)
    im = ax[2].imshow(np.where(dom.nonburnable, np.nan, d["fuel"]), extent=ext, cmap="Set2",
                      interpolation="nearest")
    fig.colorbar(im, ax=ax[2], label="Anderson fuel model")
    cover = (f"; MOD44B non-veg > {settings['nonveg_max_pct']:g} %"
             if settings.get("nonveg_max_pct") is not None else "")
    ax[2].set_title(f"Fuels (MCD12Q1 IGBP crosswalk{cover}; blank = non-burnable)", fontsize=8)
    for a_ in ax[1:]:
        a_.scatter(ox, oy, s=2, c="k")
    for a_ in ax:
        a_.set(xlabel="km (UTM 19S, domain origin)", ylabel="km")
    figs.mkdir(parents=True, exist_ok=True)
    for ext_ in ("pdf", "png"):
        fig.savefig(figs / f"{name}_baseline_map.{ext_}", dpi=150, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    main()
