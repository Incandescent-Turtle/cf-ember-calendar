"""Level-set front propagation with Rothermel + elliptical spread (REKINDLE.md §3).

∂φ/∂t + S(x, n)|∇φ| = 0, φ < 0 burned. Godunov upwind |∇φ|, Heun (RK2), adaptive
Δt = CFL·dx / max S (Δt ≤ 60 s), narrow band |φ| < 6 dx, signed-distance reinitialization
(scikit-fmm), arrival time by sign-change interpolation, zero-gradient boundaries.

Normal speed: "huygens" (default) uses the support function of the elliptical wavelet
(ellipse.ros_normal), so a point ignition in uniform conditions grows the expected ellipse.
"polar" is the REKINDLE.md v1 approximation S = R(θ_n); it over-elongates fronts (the flank
moves at R_head(1 − e) instead of b), kept for comparison.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np
import skfmm

from rekindle import ellipse
from rekindle.fuels import fuel_bed
from rekindle.rothermel import FTMIN_TO_MS, MS_TO_FTMIN, NO_SPREAD, spread_params
from rekindle.scenario import Domain, Scenario, params_hash

_EPS = 1e-12


@dataclass(frozen=True)
class SolverConfig:
    cfl: float = 0.5
    dt_max_s: float = 60.0
    reinit_every: int = 20
    reinit_max_move_dx: float = 3.0  # also reinit once the fastest front cell moved this far
    band_dx: float = 6.0
    ignition_radius_m: float | None = None  # default 1.5 dx
    stop_at_edge: bool = True
    normal_speed: str = "huygens"  # or "polar"


@dataclass
class SimResult:
    arrival_time_s: np.ndarray  # inf = unburned
    ros_head: np.ndarray  # head ROS (m/s) in the cell when it burned; nan if unburned
    metrics: dict
    params_hash: str
    isochrones: list = field(default_factory=list)


class _Fuels:
    """Per fuel-model Rothermel coefficients as arrays indexed by model number."""

    def __init__(self, models: np.ndarray, moisture: tuple[float, ...]) -> None:
        n = int(models.max()) + 1 if models.size else 1
        keys = ("r0", "ir", "beta_ratio", "c", "b", "e", "slope_k")
        vals = {k: np.zeros(n) for k in keys}
        vals["b"][:] = 1.0
        vals["beta_ratio"][:] = 1.0
        for m in np.unique(models):
            bed = fuel_bed(int(m)) if m > 0 else None
            p = spread_params(bed, moisture) if bed is not None else NO_SPREAD
            for k in keys:
                vals[k][m] = getattr(p, k)
        for k, v in vals.items():
            setattr(self, k, v)


def _signed_distance_circles(x, y, ignitions, radius: float) -> np.ndarray:
    d = np.full(x.shape, np.inf)
    for ig in ignitions:
        d = np.minimum(d, np.hypot(x - ig.x_m, y - ig.y_m) - radius)
    return d


def run_levelset(domain: Domain, scenario: Scenario, cfg: SolverConfig | None = None) -> SimResult:
    cfg = cfg or SolverConfig()
    t_wall = time.perf_counter()
    ny, nx = domain.shape
    dx = float(domain.dx)
    big = (cfg.band_dx + 2.0) * dx
    radius = cfg.ignition_radius_m if cfg.ignition_radius_m is not None else 1.5 * dx

    # Static per-cell fields (padded grid, flat indexing).
    W = nx + 2
    burnable = domain.burnable()
    model = np.where(burnable, domain.fuel, 0).astype(np.int64)
    fuels = _Fuels(model, scenario.moisture.as_tuple())
    slope = np.zeros((ny, nx)) if domain.slope_deg is None else np.asarray(domain.slope_deg, float)
    aspect = np.zeros((ny, nx)) if domain.aspect_deg is None else np.asarray(domain.aspect_deg)
    phis = fuels.slope_k[model] * np.tan(np.radians(slope)) ** 2
    up = np.radians(np.nan_to_num(aspect) + 180.0)
    psx, psy = phis * np.sin(up), phis * np.cos(up)

    def pad(a: np.ndarray, fill=0.0) -> np.ndarray:
        p = np.full((ny + 2, W), fill, dtype=float)
        p[1:-1, 1:-1] = a
        return p.ravel()

    model_p = np.zeros((ny + 2, W), dtype=np.int64)
    model_p[1:-1, 1:-1] = model
    model_p = model_p.ravel()
    psx_p, psy_p = pad(psx), pad(psy)

    interior = np.zeros((ny + 2, W), dtype=bool)
    interior[1:-1, 1:-1] = True
    interior_flat = np.flatnonzero(interior)
    edge = np.zeros((ny, nx), dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True

    phi2 = np.full((ny + 2, W), big)
    phi = phi2.ravel()
    arrival = np.full((ny + 2) * W, np.inf)
    ros_at = np.full((ny + 2) * W, np.nan)

    def fill_pad(a: np.ndarray) -> None:
        g = a.reshape(ny + 2, W)
        g[0, :] = g[1, :]
        g[-1, :] = g[-2, :]
        g[:, 0] = g[:, 1]
        g[:, -1] = g[:, -2]

    x, y = domain.xy()
    pending = sorted(scenario.ignitions, key=lambda ig: ig.t_s)

    def ignite(t: float) -> None:
        nonlocal pending
        now = [ig for ig in pending if ig.t_s <= t + 1e-9]
        pending = [ig for ig in pending if ig.t_s > t + 1e-9]
        if not now:
            return
        sd = _signed_distance_circles(x, y, now, radius)
        sd = np.where(burnable, sd, np.maximum(sd, 0.5 * dx))  # never ignite non-burnable
        cur = phi2[1:-1, 1:-1]
        newly = (sd <= 0) & np.isinf(arrival.reshape(ny + 2, W)[1:-1, 1:-1])
        cur[:] = np.minimum(cur, np.minimum(sd, big))
        arr = arrival.reshape(ny + 2, W)[1:-1, 1:-1]
        arr[newly] = t
        fill_pad(phi)

    def reinit() -> None:
        g = phi2[1:-1, 1:-1]
        if not (np.any(g < 0) and np.any(g > 0)):
            return
        d = skfmm.distance(np.ascontiguousarray(g), dx=dx, narrow=big)  # views misread
        if np.ma.isMaskedArray(d):
            d = np.where(np.ma.getmaskarray(d), np.sign(g) * big, d.filled(0.0))
        g[:] = np.clip(d, -big, big)
        fill_pad(phi)

    can_burn = burnable & (fuels.r0[model] > 0)

    def active_front() -> bool:
        """Any unburned, spreadable cell next to a burned one?"""
        b = phi2[1:-1, 1:-1] <= 0
        nb = np.zeros_like(b)
        nb[1:, :] |= b[:-1, :]
        nb[:-1, :] |= b[1:, :]
        nb[:, 1:] |= b[:, :-1]
        nb[:, :-1] |= b[:, 1:]
        return bool(np.any(nb & ~b & can_burn))

    def speed(p: np.ndarray, idx: np.ndarray, wind: tuple[float, float, float]):
        """Normal speed S (m/s) and head ROS (m/s) at flat indices idx of padded field p."""
        u_mid_ftmin, wx, wy = wind
        m = model_p[idx]
        phw = fuels.c[m] * u_mid_ftmin ** fuels.b[m] * fuels.beta_ratio[m] ** (-fuels.e[m])
        vx = phw * wx + psx_p[idx]
        vy = phw * wy + psy_p[idx]
        phie = np.hypot(vx, vy)
        safe_c = np.where(fuels.c[m] > 0, fuels.c[m], 1.0)
        u_eff = (phie * fuels.beta_ratio[m] ** fuels.e[m] / safe_c) ** (1.0 / fuels.b[m])
        if scenario.wind_limit:
            u_max = 0.9 * fuels.ir[m]
            lim = u_eff > u_max
            if np.any(lim):
                u_eff = np.where(lim, u_max, u_eff)
                phie = np.where(
                    lim, fuels.c[m] * u_max ** fuels.b[m] * fuels.beta_ratio[m] ** (-fuels.e[m]),
                    phie,
                )
        r_head = fuels.r0[m] * (1.0 + phie) * FTMIN_TO_MS * scenario.ros_multiplier
        lb = ellipse.length_to_breadth(u_eff * FTMIN_TO_MS)
        ecc = ellipse.eccentricity(lb)
        hn = np.where(phie > _EPS, phie, 1.0)
        hx = np.where(phie > _EPS, vx / hn, 0.0)
        hy = np.where(phie > _EPS, vy / hn, 1.0)
        # Outward normal from central differences (x east = +column, y north = −row).
        gx = (p[idx + 1] - p[idx - 1]) / (2 * dx)
        gy = (p[idx - W] - p[idx + W]) / (2 * dx)
        gn = np.hypot(gx, gy)
        ok = gn > _EPS
        gn = np.where(ok, gn, 1.0)
        nxv, nyv = np.where(ok, gx / gn, 0.0), np.where(ok, gy / gn, 0.0)
        cos_t = nxv * hx + nyv * hy
        sin_t = nxv * hy - nyv * hx
        if cfg.normal_speed == "polar":
            s = ellipse.ros_polar(r_head, ecc, cos_t)
        else:
            s = ellipse.ros_normal(r_head, ecc, lb, cos_t, sin_t)
        s = np.where(ok, s, r_head)
        return np.maximum(s, 0.0), r_head

    def godunov(p: np.ndarray, idx: np.ndarray) -> np.ndarray:
        c = p[idx]
        dxm = (c - p[idx - 1]) / dx
        dxp = (p[idx + 1] - c) / dx
        dym = (c - p[idx - W]) / dx
        dyp = (p[idx + W] - c) / dx
        return np.sqrt(
            np.maximum(dxm, 0) ** 2 + np.minimum(dxp, 0) ** 2
            + np.maximum(dym, 0) ** 2 + np.minimum(dyp, 0) ** 2
        )

    def wind_at(t: float) -> tuple[float, float, float]:
        sp, frm = scenario.wind_at(t)
        u_mid = sp / 1.15 * scenario.waf * MS_TO_FTMIN
        toward = math.radians((frm + 180.0) % 360.0)
        return u_mid, math.sin(toward), math.cos(toward)

    t = 0.0
    steps = reinits = 0
    since_reinit = 0
    moved = 0.0
    edge_reached = False
    t_end = scenario.duration_s
    ignite(t)
    while t < t_end - 1e-9:
        band = interior_flat[np.abs(phi[interior_flat]) < cfg.band_dx * dx]
        wind = wind_at(t)
        if band.size:
            s1, rh = speed(phi, band, wind)
            smax = float(s1.max())
        else:
            s1 = rh = np.zeros(0)
            smax = 0.0
        if smax <= 0 and not pending:
            break  # nothing burning and nothing left to ignite
        dt = cfg.dt_max_s if smax <= 0 else min(cfg.dt_max_s, cfg.cfl * dx / smax)
        if pending:
            dt = min(dt, max(pending[0].t_s - t, 1e-6))
        dt = min(dt, t_end - t)
        if band.size and smax > 0:
            phi0 = phi[band].copy()
            k1 = s1 * godunov(phi, band)
            q = phi.copy()
            q[band] = phi0 - dt * k1
            fill_pad(q)
            s2, _ = speed(q, band, wind)
            k2 = s2 * godunov(q, band)
            phi_new = phi0 - 0.5 * dt * (k1 + k2)
            phi[band] = phi_new
            fill_pad(phi)
            crossed = (phi0 > 0) & (phi_new <= 0)
            if np.any(crossed):
                ci = band[crossed]
                frac = phi0[crossed] / (phi0[crossed] - phi_new[crossed])
                arrival[ci] = t + dt * frac
                ros_at[ci] = rh[crossed]
            moved += dt * smax
        t += dt
        steps += 1
        since_reinit += 1
        ignite(t)
        if since_reinit >= cfg.reinit_every or moved >= cfg.reinit_max_move_dx * dx:
            reinit()
            reinits += 1
            since_reinit = 0
            moved = 0.0
            if not pending and not active_front():
                break  # the front is stopped everywhere (barriers, fuel breaks, extinction)
        if np.any(phi2[1:-1, 1:-1][edge] <= 0):
            edge_reached = True
            if cfg.stop_at_edge:
                break

    arr = arrival.reshape(ny + 2, W)[1:-1, 1:-1].copy()
    ros = ros_at.reshape(ny + 2, W)[1:-1, 1:-1].copy()
    burned = np.isfinite(arr)
    solver = {k: getattr(cfg, k) for k in cfg.__dataclass_fields__}
    metrics = {
        "t_end_s": t,
        "steps": steps,
        "reinits": reinits,
        "edge_reached": edge_reached,
        "burned_cells": int(burned.sum()),
        "burned_area_ha": float(burned.sum() * dx * dx / 1e4),
        "wall_s": time.perf_counter() - t_wall,
    }
    return SimResult(
        arrival_time_s=arr,
        ros_head=ros,
        metrics=metrics,
        params_hash=params_hash(domain, scenario, solver),
    )
