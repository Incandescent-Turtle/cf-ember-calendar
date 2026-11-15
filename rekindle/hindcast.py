"""Baseline hindcast, ROS-multiplier calibration and quality gate (REKINDLE.md §5).

    uv run python -m rekindle.hindcast --fire chilecito-2026 --workers 3

Writes data/rekindle/<fire>/calibration.json and baseline arrival field (baseline.npy), and
the sweep table/figure to docs/report/rekindle/.
"""

from __future__ import annotations

import argparse
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
from rekindle.scenario import Moisture, Scenario

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


def estimate_dead_moisture(meta: dict, elev_m: float, hours: float) -> dict:
    """1-h moisture estimate from MERRA-2 T2M/QV2M (EMC, no lag), over the run window."""
    t0 = dm.parse_t(meta["t0"])
    p_hpa = 1013.25 * (1 - 2.25577e-5 * elev_m) ** 5.25588
    vals, rhs = [], []
    for w in meta["wind"]:
        dt_h = (dm.parse_t(w["t"]) - t0).total_seconds() / 3600
        if not 0 <= dt_h <= hours:
            continue
        q = w["qv2m_gkg"] / 1000
        e = q * p_hpa / (0.622 + 0.378 * q)
        es = 6.112 * math.exp(17.67 * w["t2m_c"] / (w["t2m_c"] + 243.5))
        rh = min(100.0, 100 * e / es)
        rhs.append(rh)
        vals.append(simard_emc(rh, w["t2m_c"]))
    v = np.array(vals)
    return {"method": "Simard (1968) EMC from MERRA-2 T2M/QV2M (2 m, grid-cell mean), "
                      f"pressure at the ignition elevation {elev_m:.0f} m; no time lag",
            "rh_pct_median": float(np.median(rhs)), "emc_pct_median": float(np.median(v)),
            "emc_pct_p10": float(np.percentile(v, 10)), "emc_pct_p90": float(np.percentile(v, 90))}


def baseline_scenario(meta: dict, hours: float, d1_pct: float, mult: float) -> Scenario:
    return Scenario(ignitions=dm.ignitions(meta), duration_s=hours * 3600,
                    wind=dm.observed_wind(meta), moisture=moisture(d1_pct),
                    ros_multiplier=mult, label="baseline")


_G: dict = {}


def _init(fire: str, hours: float, d1: float) -> None:
    dom, meta = dm.load(fire)
    _G.update(dom=dom, meta=meta, hours=hours, d1=d1,
              prep=metrics.prepare(meta, dom.shape, dom.dx, hours * 3600))


def _run(mult: float):
    res = run_levelset(_G["dom"], baseline_scenario(_G["meta"], _G["hours"], _G["d1"], mult), CFG)
    m = metrics.score(res.arrival_time_s, _G["prep"])
    m.update(ros_multiplier=mult, wall_s=res.metrics["wall_s"],
             edge_reached=res.metrics["edge_reached"])
    return mult, m, res.arrival_time_s.astype(np.float32), res.params_hash


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--hours", type=float, default=None, help="default: to the last detection")
    ap.add_argument("--d1", type=float, default=None, help="baseline dead 1-h %% (default: EMC)")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--report", type=Path, default=Path("docs/report/rekindle"))
    ap.add_argument("--figures-only", action="store_true", help="map figure from baseline.npy")
    a = ap.parse_args()
    if a.figures_only:
        map_figure(a.fire, a.report / "figures")
        return
    dom, meta = dm.load(a.fire)
    t0 = dm.parse_t(meta["t0"])
    last = max(dm.parse_t(o["t"]) for o in meta["observed"])
    hours = a.hours or math.ceil((last - t0).total_seconds() / 3600)
    elev = np.load(dm.DATA / a.fire / "domain.npz")["elevation"]
    ig = meta["ignitions"]
    ny = dom.shape[0]
    ig_elev = float(np.median([elev[int((ny * dom.dx - g["y_m"]) // dom.dx),
                                    int(g["x_m"] // dom.dx)] for g in ig]))
    emc = estimate_dead_moisture(meta, ig_elev, hours)
    d1 = a.d1 if a.d1 is not None else min(MOISTURE_AXIS, key=lambda m: abs(m - emc["emc_pct_median"]))
    print(f"run {hours} h; EMC median {emc['emc_pct_median']:.1f} % (RH {emc['rh_pct_median']:.0f} %)"
          f" → baseline dead 1-h {d1} %")
    t_wall = time.time()
    with Pool(a.workers, initializer=_init, initargs=(a.fire, hours, d1)) as pool:
        out = pool.map(_run, MULTIPLIERS)
    sweep = [m for _, m, _, _ in out]
    prep = metrics.prepare(meta, dom.shape, dom.dx, hours * 3600)

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
    out_dir = dm.DATA / a.fire
    np.save(out_dir / "baseline.npy", out[best_i][2])
    cal = {
        "fire": a.fire, "hours": hours, "t0": meta["t0"], "dead_moisture_pct": d1,
        "moisture_estimate": emc, "ros_multiplier": best["ros_multiplier"],
        "params_hash": out[best_i][3],
        "gate": {"rule": "median |Δ| ≤ mean interval between overpasses (REKINDLE.md §5)",
                 "threshold_h": gate_h, "overpass_median_gap_h": prep["overpass_median_h"],
                 "passed": passed},
        "status": status, "baseline_metrics": metrics.json_safe(best),
        "sweep": [metrics.json_safe(m) for m in sweep],
        "calibrated_not_blind": "the multiplier is fitted on this fire's own detections",
        "wall_s": time.time() - t_wall,
    }
    (out_dir / "calibration.json").write_text(json.dumps(cal, indent=1))
    a.report.mkdir(parents=True, exist_ok=True)
    (a.report / f"{a.fire}_calibration.json").write_text(json.dumps(cal, indent=1))
    _figure(sweep, best["ros_multiplier"], gate_h, a.report / "figures", a.fire)
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


def map_figure(fire: str, figs: Path) -> None:
    """Baseline arrival time vs detections, with terrain and fuels (report figure)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    dom, meta = dm.load(fire)
    d = np.load(dm.DATA / fire / "domain.npz")
    cal = json.loads((dm.DATA / fire / "calibration.json").read_text())
    arr = np.load(dm.DATA / fire / "baseline.npy")
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
    ax[0].set_title(f"Baseline ×{cal['ros_multiplier']}: simulated arrival; dots = FIRMS", fontsize=8)
    im = ax[1].imshow(d["elevation"], extent=ext, cmap="terrain")
    fig.colorbar(im, ax=ax[1], label="m")
    ax[1].set_title("Copernicus GLO-30 elevation", fontsize=8)
    im = ax[2].imshow(np.where(d["nonburnable"], np.nan, d["fuel"]), extent=ext, cmap="Set2",
                      interpolation="nearest")
    fig.colorbar(im, ax=ax[2], label="Anderson fuel model")
    ax[2].set_title("Fuels (MCD12Q1 IGBP crosswalk; blank = non-burnable)", fontsize=8)
    for a_ in ax[1:]:
        a_.scatter(ox, oy, s=2, c="k")
    for a_ in ax:
        a_.set(xlabel="km (UTM 19S, domain origin)", ylabel="km")
    figs.mkdir(parents=True, exist_ok=True)
    for ext_ in ("pdf", "png"):
        fig.savefig(figs / f"{fire}_baseline_map.{ext_}", dpi=150, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    main()
