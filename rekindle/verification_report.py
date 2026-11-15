"""Rekindle engine verification: numbers + figures for the handoff and the LaTeX report.

    uv run python -m rekindle.verification_report --out docs/report/rekindle

Writes results.json (every number quoted in docs/DECISIONS.md S5) and figures/*.pdf|png.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import platform
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from rekindle import ellipse
from rekindle.fuels import anderson13, fuel_bed
from rekindle.levelset import SolverConfig, run_levelset
from rekindle.rothermel import (
    FTMIN_TO_MS,
    MS_TO_FTMIN,
    TONS_AC_TO_LB_FT2,
    FuelBed,
    head_fire,
    spread_params,
)
from rekindle.scenario import Domain, Ignition, Moisture, Scenario, WindSample
from rekindle.verify import column_width, n_components, ray_front, ray_rate

M = Moisture()
R0_FM1 = spread_params(fuel_bed(1), M.as_tuple()).r0 * FTMIN_TO_MS


def save(fig, out: Path, name: str) -> None:
    for ext in ("pdf", "png"):
        fig.savefig(out / f"{name}.{ext}", dpi=150, bbox_inches="tight")
    plt.close(fig)


def head_and_lb(u10: float, fm: int = 1) -> tuple[float, float, float]:
    p = spread_params(fuel_bed(fm), M.as_tuple())
    hf = head_fire(p, u10 / 1.15 * 0.4 * MS_TO_FTMIN, 0.0, 0.0, 0.0)
    ue = float(hf.u_eff) * FTMIN_TO_MS
    return float(hf.r_head) * FTMIN_TO_MS, float(ellipse.length_to_breadth(ue)), ue


# ---- 1. Rothermel ------------------------------------------------------------------------


def rothermel_section(out: Path) -> dict:
    t = TONS_AC_TO_LB_FT2
    published = [  # Andrews 2018 RMRS-GTR-371 Table 17, rows 1-3
        (2.0, 0.0, 81.6, 17.8), (1.0, 1.0, 40.2, 17.9), (0.1, 1.9, 32.0, 20.8)]
    rows = []
    for w1, w10, ros, phw in published:
        bed = FuelBed(w0=(w1 * t, w10 * t, 0, 0, 0), sav=(2500, 109 if w10 else 0, 0, 0, 0),
                      depth=1.0, mx_dead=0.20)
        p = spread_params(bed, (0.05, 0.05, 0.05, 0, 0))
        r = float(head_fire(p, 440.0, 0, 0, 0).r_head)
        rows.append({"w1h_t_ac": w1, "w10h_t_ac": w10, "ros_published_ft_min": ros,
                     "ros_ours_ft_min": round(r, 3), "rel_err": round(r / ros - 1, 5),
                     "phi_w_published": phw, "phi_w_ours": round(float(p.phi_wind(440.0)), 3)})

    fig, ax = plt.subplots(1, 2, figsize=(9, 3.4))
    u = np.linspace(0, 10, 101)  # midflame mi/h
    for fm in (1, 2, 4, 8, 10):
        p = spread_params(fuel_bed(fm), M.as_tuple())
        r = head_fire(p, u * 88.0, 0, 0, 0).r_head * FTMIN_TO_MS * 60
        ax[0].plot(u, r, label=f"FM {fm}")
    ax[0].set(xlabel="midflame wind (mi/h)", ylabel="head ROS (m/min)", yscale="log")
    ax[0].legend(fontsize=8)
    m1 = np.linspace(0.02, 0.30, 141)
    for fm in (1, 2, 4, 8, 10):
        bed = fuel_bed(fm)
        r = [spread_params(bed, (m, m + 0.01, m + 0.02, 0.6, 0.9)).r0 * FTMIN_TO_MS * 60
             for m in m1]
        ax[1].plot(m1 * 100, r, label=f"FM {fm}")
    ax[1].set(xlabel="1-h dead fuel moisture (%)", ylabel="no-wind ROS R0 (m/min)")
    fig.suptitle("Rothermel (1972) with Albini (1976) weighting, Anderson (1982) fuel models",
                 fontsize=9)
    save(fig, out, "rothermel_curves")

    fm_table = []
    for n, fm in anderson13().items():
        p = spread_params(fm.bed, M.as_tuple())
        rh, lb, _ = head_and_lb(6.0, n)
        fm_table.append({"fm": n, "r0_m_min": round(p.r0 * FTMIN_TO_MS * 60, 3),
                         "r_head_u10_6ms_m_min": round(rh * 60, 2), "lb": round(lb, 3),
                         "ir_btu_ft2_min": round(p.ir, 1), "mx_live": round(p.mx_live, 3)})
    return {"andrews2018_table17": rows, "fuel_models_at_default_moisture": fm_table,
            "moisture": M.as_tuple()}


def lb_figure(out: Path) -> None:
    u_ms = np.linspace(0, 15, 151)
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    ax.plot(u_ms, ellipse.length_to_breadth(u_ms), label="Finney 1998 eq 13, U in m/s (used)")
    u_mph = u_ms * 2.23694
    anderson = 0.936 * np.exp(0.1147 * u_mph) + 0.461 * np.exp(-0.0692 * u_mph)
    ax.plot(u_ms, anderson, "--", label="Anderson 1983 eq 17, U in mi/h")
    wrong = np.clip(0.936 * np.exp(0.2566 * u_mph) + 0.461 * np.exp(-0.1548 * u_mph) - 0.397, 1, 8)
    ax.plot(u_ms, wrong, ":", label="m/s coefficients fed mi/h (doc error)")
    ax.set(xlabel="effective midflame wind (m/s)", ylabel="length-to-breadth", ylim=(0.9, 8.5))
    ax.legend(fontsize=7)
    save(fig, out, "length_to_breadth")


# ---- 2. Solver --------------------------------------------------------------------------


def circle_section(out: Path) -> dict:
    dx, n = 10.0, 201
    dom = Domain.uniform(n, n, dx, fuel=1)
    c = n * dx / 2
    res = run_levelset(dom, Scenario((Ignition(c, c),), duration_s=850 / R0_FM1))
    arr = res.arrival_time_s
    t = 700.0 / R0_FM1
    az = np.arange(0, 360, 5)
    radii = np.array([ray_front(arr, dom, c, c, a, t, 990.0) for a in az])
    axis = np.mean([ray_rate(arr, dom, c, c, a, 100, 650) for a in (0, 90, 180, 270)])
    diag = np.mean([ray_rate(arr, dom, c, c, a, 100, 650) for a in (45, 135, 225, 315)])
    fig, ax = plt.subplots(figsize=(4, 4))
    x, y = dom.xy()
    levels = np.arange(1, 9) * 100 / R0_FM1
    ax.contour(x - c, y - c, arr, levels=levels, colors="k", linewidths=0.8)
    for lv in levels:
        ax.add_patch(plt.Circle((0, 0), R0_FM1 * lv + 1.5 * dx, fill=False, ls="--", color="C1",
                                lw=0.8))
    ax.set(aspect="equal", xlabel="x (m)", ylabel="y (m)",
           title="Test 1: no wind, FM 1 (black: solver, dashed: exact)")
    ax.title.set_fontsize(8)
    save(fig, out, "test1_circle")
    return {
        "dx_m": dx, "grid": [n, n], "R0_m_s": R0_FM1, "t_s": t,
        "radius_expected_m": R0_FM1 * t,
        "radius_min_m": float(radii.min()), "radius_max_m": float(radii.max()),
        "max_abs_radius_error_m": float(np.max(np.abs(radii - R0_FM1 * t))),
        "max_abs_radius_error_dx": float(np.max(np.abs(radii - R0_FM1 * t)) / dx),
        "rate_axis_m_s": axis, "rate_diag_m_s": diag,
        "axis_diag_bias": abs(axis - diag) / axis,
        "wall_s": res.metrics["wall_s"], "steps": res.metrics["steps"],
    }


def ellipse_run(u10: float, normal: str, dx: float = 20.0):
    r_head, lb, ue = head_and_lb(u10)
    r_back = float(ellipse.backing_rate(r_head, ellipse.eccentricity(lb)))
    t_end = 4000.0 / r_head
    ny = int(2 * (4000.0 / min(lb, 8.0)) / dx * 0.6) + 40
    nx = int((4000.0 + r_back * t_end) / dx) + 40
    dom = Domain.uniform(ny, nx, dx, fuel=1)
    x0, y0 = r_back * t_end + 300.0, ny * dx / 2
    sc = Scenario((Ignition(x0, y0),), duration_s=t_end, wind=(WindSample(0, u10, 270.0),))
    res = run_levelset(dom, sc, SolverConfig(normal_speed=normal, stop_at_edge=False))
    arr = res.arrival_time_s
    head = ray_rate(arr, dom, x0, y0, 90.0, 500, 3500)
    back = ray_rate(arr, dom, x0, y0, 270.0, 30, max(60.0, r_back * t_end * 0.9))
    t1, t2 = 0.4 * t_end, 0.95 * t_end
    length = [ray_front(arr, dom, x0, y0, 90, t, 4200) + ray_front(arr, dom, x0, y0, 270, t, 1500)
              for t in (t1, t2)]
    width = [column_width(arr, dom, t) for t in (t1, t2)]
    lb_sim = (length[1] - length[0]) / (width[1] - width[0])
    return {"u10_m_s": u10, "u_eff_m_s": ue, "lb_expected": lb, "lb_sim": lb_sim,
            "lb_rel_err": lb_sim / lb - 1, "r_head_expected": r_head, "r_head_sim": head,
            "r_head_rel_err": head / r_head - 1, "r_back_expected": r_back, "r_back_sim": back,
            "wall_s": res.metrics["wall_s"]}, (dom, arr, x0, y0, r_head, r_back, lb, t_end)


def ellipse_section(out: Path) -> dict:
    rows = {"huygens": [], "polar": []}
    keep = None
    for normal, lst in rows.items():
        for u10 in (3.0, 6.0, 9.0, 12.0, 15.0):
            r, extra = ellipse_run(u10, normal)
            lst.append(r)
            if normal == "huygens" and u10 == 9.0:
                keep = extra
    dom, arr, x0, y0, rh, rb, lb, t_end = keep
    x, y = dom.xy()
    fig, ax = plt.subplots(figsize=(6, 3))
    ts = np.array([0.25, 0.5, 0.75, 1.0]) * t_end * 0.95
    ax.contour(x - x0, y - y0, arr, levels=ts, colors="k", linewidths=0.8)
    a_ = (rh + rb) / 2
    b_ = a_ / lb
    th = np.linspace(0, 2 * np.pi, 400)
    for tt in ts:  # exact: ellipse (focus at ignition) grown by the ignition radius
        cx = (a_ - rb) * tt
        ax.plot(cx + (a_ * tt + 30) * np.cos(th), (b_ * tt + 30) * np.sin(th), "--", color="C1",
                lw=0.8)
    ax.set(aspect="equal", xlabel="x (m), wind from the west", ylabel="y (m)",
           title=f"Test 2: U10 = 9 m/s, FM 1, LB = {lb:.2f} (black: solver, dashed: exact)")
    ax.title.set_fontsize(8)
    save(fig, out, "test2_ellipse")
    return rows


def merge_barrier_figures(out: Path) -> dict:
    dx, n = 10.0, 161
    dom = Domain.uniform(n, n, dx, fuel=1)
    c = n * dx / 2
    res = run_levelset(dom, Scenario((Ignition(c - 300, c), Ignition(c + 300, c)),
                                     duration_s=450 / R0_FM1))
    arr = res.arrival_time_s
    fuel = np.ones((81, 121), dtype=np.int16)
    fuel[:, 60:61] = 0
    dom2 = Domain(fuel=fuel, dx=dx)
    res2 = run_levelset(dom2, Scenario((Ignition(300, 405),), duration_s=1e9,
                                       wind=(WindSample(0, 10.0, 270.0),)),
                        SolverConfig(stop_at_edge=False))
    fig, ax = plt.subplots(1, 2, figsize=(9, 3.2))
    x, y = dom.xy()
    ax[0].contour(x, y, arr, levels=np.arange(1, 9) * 50 / R0_FM1, colors="k", linewidths=0.7)
    ax[0].set(aspect="equal", title="Test 3: two ignitions merge")
    x2, y2 = dom2.xy()
    a2 = res2.arrival_time_s
    ax[1].pcolormesh(x2, y2, np.where(np.isfinite(a2), a2 / 60, np.nan), cmap="viridis", rasterized=True)
    ax[1].axvspan(600, 610, color="r")
    ax[1].set(aspect="equal", title="Test 4: 1-cell non-burnable strip (red)")
    for a in ax:
        a.title.set_fontsize(8)
    save(fig, out, "test3_4_merge_barrier")
    return {"merge_components": n_components(np.isfinite(arr)),
            "barrier_cells_burned_beyond": int(np.isfinite(a2[:, 60:]).sum()),
            "barrier_stop_t_s": res2.metrics["t_end_s"]}


def _exact_wind_arrival(x, y, r_head, r_back, lb, r0):
    """Exact T for an ellipse (rear focus at origin, head +x) grown from a circle of radius r0.

    x ∈ r0-disc ⊕ t·E  ⇔  x·n ≤ r0 + t h_E(n) for all n  ⇒  T = max_n (x·n − r0)/h_E(n).
    """
    th = np.linspace(-np.pi, np.pi, 1441)
    e = float(ellipse.eccentricity(lb))
    h = ellipse.ros_normal(r_head, e, lb, np.cos(th), np.sin(th))
    t = np.full(x.shape, -np.inf)
    for c_, s_, h_ in zip(np.cos(th), np.sin(th), h, strict=True):
        t = np.maximum(t, (x * c_ + y * s_ - r0) / h_)
    return np.maximum(t, 0.0)


def convergence_section(out: Path) -> dict:
    res = {"circle": [], "wind_u10_9": []}
    for dx in (40.0, 20.0, 10.0, 5.0):
        L = 1600.0
        n = int(L / dx)
        dom = Domain.uniform(n, n, dx, fuel=1)
        c = n * dx / 2
        r = run_levelset(dom, Scenario((Ignition(c, c),), duration_s=750 / R0_FM1),
                         SolverConfig(ignition_radius_m=100.0))
        x, y = dom.xy()
        rr = np.hypot(x - c, y - c)
        ring = (rr > 300) & (rr < 700)
        err = r.arrival_time_s[ring] - (rr[ring] - 100.0) / R0_FM1
        res["circle"].append({"dx_m": dx, "l1_s": float(np.mean(np.abs(err))),
                              "linf_s": float(np.max(np.abs(err))),
                              "l1_rel": float(np.mean(np.abs(err)) / (400 / R0_FM1)),
                              "wall_s": r.metrics["wall_s"]})
    r_head, lb, _ = head_and_lb(9.0)
    r_back = float(ellipse.backing_rate(r_head, ellipse.eccentricity(lb)))
    for dx in (40.0, 20.0, 10.0, 5.0):
        nx, ny = int(3200 / dx), int(1600 / dx)
        dom = Domain.uniform(ny, nx, dx, fuel=1)
        x0, y0 = 600.0, ny * dx / 2
        t_end = 2400.0 / r_head
        r = run_levelset(dom, Scenario((Ignition(x0, y0),), duration_s=t_end,
                                       wind=(WindSample(0, 9.0, 270.0),)),
                         SolverConfig(ignition_radius_m=100.0))
        x, y = dom.xy()
        exact = _exact_wind_arrival(x - x0, y - y0, r_head, r_back, lb, 100.0)
        mask = (exact > 0.2 * t_end) & (exact < 0.9 * t_end)
        err = r.arrival_time_s[mask] - exact[mask]
        res["wind_u10_9"].append({"dx_m": dx, "l1_s": float(np.mean(np.abs(err))),
                                  "linf_s": float(np.max(np.abs(err))),
                                  "l1_rel": float(np.mean(np.abs(err) / exact[mask])),
                                  "wall_s": r.metrics["wall_s"]})
    for k, rows in res.items():
        for a, b in itertools.pairwise(rows):
            b["order_l1_vs_prev"] = math.log2(a["l1_s"] / b["l1_s"])
    fig, ax = plt.subplots(figsize=(4.4, 3.4))
    for k, rows in res.items():
        d = [r["dx_m"] for r in rows]
        ax.loglog(d, [r["l1_rel"] for r in rows], "o-", label=k.replace("_", " "))
    d = np.array([5, 40.0])
    ax.loglog(d, res["circle"][0]["l1_rel"] * d / 40, "k:", label="first order")
    ax.set(xlabel="dx (m)", ylabel="mean relative arrival-time error",
           title="Test 5: grid convergence")
    ax.title.set_fontsize(8)
    ax.legend(fontsize=7)
    save(fig, out, "test5_convergence")
    return res


def timing_section(out: Path, case: str = "moderate") -> dict:
    """24 h simulated on 400 × 400 at 90 m: mixed fuels, a hill, wind veering over the day.

    "moderate": 8 % 1-h moisture, 4±2 m/s. "large": default dry moisture, 9±2 m/s, so the
    front sweeps most of the grid (worst case for the narrow band).
    """
    n, dx = 400, 90.0
    rng = np.random.default_rng(0)
    x, y = np.meshgrid((np.arange(n) + 0.5) * dx, (n - np.arange(n) - 0.5) * dx)
    c = n * dx / 2
    z = 600 * np.exp(-((x - c * 1.2) ** 2 + (y - c) ** 2) / (2 * 6000.0**2))
    gy, gx = np.gradient(z, dx)  # gy along rows (southward)
    dzdx, dzdy = gx, -gy
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = np.degrees(np.arctan2(-dzdx, -dzdy)) % 360  # downslope azimuth
    patches = rng.integers(0, 4, size=(n // 20, n // 20))
    fuel = np.array([2, 1, 4, 9], dtype=np.int16)[np.kron(patches, np.ones((20, 20), int))]
    fuel[:, 250:252] = 0  # a river
    dom = Domain(fuel=fuel, dx=dx, slope_deg=slope, aspect_deg=aspect)
    base = 4.0 if case == "moderate" else 9.0
    wind = tuple(WindSample(h * 3600.0, base + 2 * math.sin(h / 24 * 2 * math.pi), 250 + 3 * h)
                 for h in range(25))
    moist = Moisture(d1=0.08, d10=0.09, d100=0.10) if case == "moderate" else Moisture()
    sc = Scenario((Ignition(c * 0.3, c),), duration_s=24 * 3600.0, wind=wind, moisture=moist)
    t0 = time.perf_counter()
    res = run_levelset(dom, sc, SolverConfig(stop_at_edge=False))
    wall = time.perf_counter() - t0
    fig, ax = plt.subplots(figsize=(4.4, 4))
    arr = res.arrival_time_s / 3600
    im = ax.pcolormesh(x / 1000, y / 1000, np.where(np.isfinite(arr), arr, np.nan), cmap="magma",
                       rasterized=True)  # keeps the PDF small
    ax.contour(x / 1000, y / 1000, z, levels=6, colors="w", linewidths=0.4)
    fig.colorbar(im, ax=ax, label="arrival (h)")
    ax.set(aspect="equal", xlabel="km", ylabel="km",
           title=f"Benchmark ({case}): 400 x 400 at 90 m, 24 h (synthetic)")
    ax.title.set_fontsize(8)
    save(fig, out, f"benchmark_400_{case}")
    return {"case": case, "grid": [n, n], "dx_m": dx, "simulated_h": 24, "wall_s": wall,
            "steps": res.metrics["steps"], "reinits": res.metrics["reinits"],
            "burned_area_ha": res.metrics["burned_area_ha"],
            "edge_reached": res.metrics["edge_reached"],
            "machine": f"{platform.processor()} / {platform.python_version()}"}




# ---- 6–10. S6 solver checks (shared with tests/rekindle/test_levelset.py) ---------------


def _public(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


def s6_section(out: Path) -> dict:
    from rekindle import verify

    sl = verify.slope_case()
    ws = verify.wind_shift_case()
    mu = verify.multiplier_case(2.0)
    fi = verify.fuel_interface_case()
    fig, axs = plt.subplots(1, 2, figsize=(8, 4))
    for ax, r, title in ((axs[0], sl, "Test 6: 20° incline rising east, no wind, FM 1"),
                         (axs[1], ws, "Test 7: wind from 270° then 180° (U10 6 m/s, FM 1)")):
        dom, arr = r["_domain"], r["_arrival"]
        x, y = dom.xy()
        x0, y0 = r["_xy0"]
        fin = arr[np.isfinite(arr)]
        lv = np.linspace(0, fin.max(), 11)[1:]
        cs = ax.contour(x - x0, y - y0, arr / 60, levels=lv / 60, cmap="viridis", linewidths=0.8)
        ax.clabel(cs, fmt="%.0f min", fontsize=6)
        ax.plot(0, 0, "r+")
        ax.set(aspect="equal", xlabel="x (m)", ylabel="y (m)", title=title)
        ax.title.set_fontsize(8)
    save(fig, out, "test6_7_slope_windshift")
    return {"test6_slope": _public(sl), "test7_wind_shift": _public(ws),
            "test8_multiplier": mu, "test9_fuel_interface": {k: float(v) if not isinstance(v, bool)
                                                              else v for k, v in fi.items()}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("docs/report/rekindle"))
    ap.add_argument("--skip-timing", action="store_true")
    args = ap.parse_args()
    figs = args.out / "figures"
    figs.mkdir(parents=True, exist_ok=True)
    results: dict = {"generated": time.strftime("%Y-%m-%d %H:%M"), "default_moisture": M.as_tuple()}
    results["rothermel"] = rothermel_section(figs)
    lb_figure(figs)
    results["test1_circle"] = circle_section(figs)
    results["test2_ellipse"] = ellipse_section(figs)
    results["test3_4"] = merge_barrier_figures(figs)
    results["test5_convergence"] = convergence_section(figs)
    results.update(s6_section(figs))
    if not args.skip_timing:
        results["benchmark_400"] = [timing_section(figs, c) for c in ("moderate", "large")]
    elif (args.out / "results.json").exists():  # keep the last measured benchmark
        old = json.loads((args.out / "results.json").read_text())
        if "benchmark_400" in old:
            results["benchmark_400"] = old["benchmark_400"]
    (args.out / "results.json").write_text(json.dumps(results, indent=2, default=float))
    print(f"wrote {args.out / 'results.json'}")


if __name__ == "__main__":
    main()
