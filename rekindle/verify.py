"""Measurements on arrival-time fields, shared by the solver tests and the report script."""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from rekindle.scenario import Domain


def sample(arrival: np.ndarray, domain: Domain, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Bilinear arrival time at points (x east, y north, metres); inf if any corner unburned."""
    ny, _ = domain.shape
    col = np.asarray(x) / domain.dx - 0.5
    row = ny - np.asarray(y) / domain.dx - 0.5
    finite = np.isfinite(arrival)
    a = np.where(finite, arrival, 0.0)
    v = ndimage.map_coordinates(a, [row, col], order=1, mode="nearest")
    ok = ndimage.map_coordinates(finite.astype(float), [row, col], order=1, mode="nearest")
    return np.where(ok > 0.999, v, np.inf)


def ray_rate(arrival, domain, x0, y0, az_deg, r_min, r_max, n=200) -> float:
    """Spread rate along a ray (m/s): inverse slope of a linear fit of T against distance."""
    r = np.linspace(r_min, r_max, n)
    az = np.radians(az_deg)
    t = sample(arrival, domain, x0 + r * np.sin(az), y0 + r * np.cos(az))
    ok = np.isfinite(t)
    if ok.sum() < 10:
        return float("nan")
    slope = np.polyfit(r[ok], t[ok], 1)[0]
    return float(1.0 / slope)


def ray_front(arrival, domain, x0, y0, az_deg, t, r_max, n=2000) -> float:
    """Distance from (x0, y0) along a ray where the arrival time first reaches t."""
    r = np.linspace(0, r_max, n)
    az = np.radians(az_deg)
    tt = sample(arrival, domain, x0 + r * np.sin(az), y0 + r * np.cos(az))
    above = np.flatnonzero(~(tt <= t))
    if above.size == 0:
        return float(r_max)
    k = int(above[0])
    if k == 0:
        return 0.0
    t0, t1 = tt[k - 1], tt[k]
    if not np.isfinite(t1):
        return float(r[k - 1])
    return float(r[k - 1] + (t - t0) / (t1 - t0) * (r[k] - r[k - 1]))


def column_width(arrival: np.ndarray, domain: Domain, t: float) -> float:
    """Largest north–south extent (m) of the region burned by time t, sub-cell by interpolation."""
    dx = domain.dx
    best = 0.0
    burned = arrival <= t
    for j in np.flatnonzero(burned.any(axis=0)):
        col = arrival[:, j]
        rows = np.flatnonzero(col <= t)
        lo, hi = rows[0], rows[-1]

        def frac(i_in: int, i_out: int, col: np.ndarray = col) -> float:
            if i_out < 0 or i_out >= col.size or not np.isfinite(col[i_out]):
                return 0.5
            return float((t - col[i_in]) / (col[i_out] - col[i_in]))

        w = (hi - lo) * dx + (frac(lo, lo - 1) + frac(hi, hi + 1)) * dx
        best = max(best, w)
    return best


def n_components(mask: np.ndarray) -> int:
    return int(ndimage.label(mask)[1])


# ---- S6 solver checks (shared by tests/rekindle/test_levelset.py and the report) ------------


def _head(fm: int, u10: float, from_deg: float, slope_deg: float, aspect_deg: float):
    """Expected (R_head m/s, R_back m/s, LB) from Rothermel + the ellipse for uniform conditions."""
    from rekindle import ellipse
    from rekindle.fuels import fuel_bed
    from rekindle.rothermel import (
        FTMIN_TO_MS, MS_TO_FTMIN, head_fire, spread_params, wind_from_to_toward_az,
    )
    from rekindle.scenario import Moisture

    p = spread_params(fuel_bed(fm), Moisture().as_tuple())
    u_mid = u10 / 1.15 * 0.4 * MS_TO_FTMIN
    hf = head_fire(p, u_mid, wind_from_to_toward_az(from_deg),
                   np.tan(np.radians(slope_deg)), np.radians(aspect_deg + 180.0))
    r_head = float(hf.r_head) * FTMIN_TO_MS
    lb = float(ellipse.length_to_breadth(float(hf.u_eff) * FTMIN_TO_MS))
    r_back = float(ellipse.backing_rate(r_head, ellipse.eccentricity(lb)))
    return r_head, r_back, lb


def slope_case(slope_deg: float = 20.0, fm: int = 1, dx: float = 10.0, head_m: float = 1500.0):
    """Uniform incline rising to the east (aspect 270 = downslope west), no wind."""
    from rekindle.levelset import run_levelset
    from rekindle.scenario import Ignition, Scenario

    r_head, r_back, lb = _head(fm, 0.0, 0.0, slope_deg, 270.0)
    t_end = head_m / r_head
    half_w = (head_m + r_back * t_end) / (2 * lb) * 1.3 + 300.0
    nx = int((head_m + r_back * t_end) / dx) + 80
    ny = int(2 * half_w / dx) + 20
    x0, y0 = r_back * t_end + 400.0, ny * dx / 2
    dom = Domain.uniform(ny, nx, dx, fuel=fm, slope_deg=np.full((ny, nx), slope_deg),
                         aspect_deg=np.full((ny, nx), 270.0))
    res = run_levelset(dom, Scenario((Ignition(x0, y0),), duration_s=t_end))
    arr = res.arrival_time_s
    head = ray_rate(arr, dom, x0, y0, 90.0, 0.15 * head_m, 0.85 * head_m)
    rb = r_back * t_end
    back = ray_rate(arr, dom, x0, y0, 270.0, 0.15 * rb, 0.85 * rb) if rb > 6 * dx else float("nan")
    return {"slope_deg": slope_deg, "fm": fm, "dx_m": dx, "expected_head_ms": r_head,
            "expected_back_ms": r_back, "lb": lb, "head_ms": head, "back_ms": back,
            "head_err": head / r_head - 1.0, "edge_reached": res.metrics["edge_reached"],
            "_arrival": arr, "_domain": dom, "_xy0": (x0, y0)}


def _extent_rate(arr, domain: Domain, t0: float, t1: float, side: str) -> float:
    """Rate (m/s) at which the burned region's extent on one side (N/E/S/W) grows over [t0, t1]."""
    x, y = domain.xy()

    def ext(t: float) -> float:
        b = arr <= t
        v = {"E": x, "W": -x, "N": y, "S": -y}[side]
        return float(v[b].max())

    return (ext(t1) - ext(t0)) / (t1 - t0)


def wind_shift_case(u10: float = 6.0, fm: int = 1, dx: float = 20.0, leg_m: float = 1500.0):
    """Wind from 270 (fire runs east) for the first leg, then from 180 (runs north)."""
    from rekindle.levelset import run_levelset
    from rekindle.scenario import Ignition, Scenario, WindSample

    r_head, r_back, lb = _head(fm, u10, 270.0, 0.0, 0.0)
    t1 = leg_m / r_head
    t_end = 2 * t1
    flank = (r_head + r_back) / (2 * lb) * t_end  # flank growth over the whole run
    m = 600.0
    nx = int((r_back * t1 + leg_m + 2 * flank + 2 * m) / dx)
    ny = int((r_back * t1 + leg_m + 2 * flank + 2 * m) / dx)
    x0, y0 = r_back * t1 + flank + m, r_back * t1 + flank + m
    dom = Domain.uniform(ny, nx, dx, fuel=fm)
    wind = (WindSample(0.0, u10, 270.0), WindSample(t1, u10, 270.0),
            WindSample(t1 + 60.0, u10, 180.0))
    res = run_levelset(dom, Scenario((Ignition(x0, y0),), duration_s=t_end, wind=wind))
    arr = res.arrival_time_s
    lag = 0.25 * t1  # let the new head form before measuring
    out = {"u10_ms": u10, "fm": fm, "dx_m": dx, "t_shift_s": t1, "expected_head_ms": r_head,
           "early_E_ms": _extent_rate(arr, dom, 0.25 * t1, t1, "E"),
           "early_N_ms": _extent_rate(arr, dom, 0.25 * t1, t1, "N"),
           "late_N_ms": _extent_rate(arr, dom, t1 + lag, t_end, "N"),
           "late_E_ms": _extent_rate(arr, dom, t1 + lag, t_end, "E"),
           "edge_reached": res.metrics["edge_reached"],
           "_arrival": arr, "_domain": dom, "_xy0": (x0, y0)}
    return out


def multiplier_case(mult: float = 2.0, u10: float = 6.0, fm: int = 1, dx: float = 20.0):
    """Arrival times with ros_multiplier = mult must be those at 1.0 divided by mult."""
    from rekindle.levelset import run_levelset
    from rekindle.scenario import Ignition, Scenario, WindSample

    r_head, r_back, lb = _head(fm, u10, 270.0, 0.0, 0.0)
    t_end = 2000.0 / r_head
    nx = int((2000.0 + r_back * t_end + 800) / dx)
    ny = int((2 * 2000.0 / lb + 800) / dx)
    dom = Domain.uniform(ny, nx, dx, fuel=fm)
    ig = (Ignition(r_back * t_end + 400.0, ny * dx / 2),)
    w = (WindSample(0.0, u10, 270.0),)
    a1 = run_levelset(dom, Scenario(ig, duration_s=t_end, wind=w)).arrival_time_s
    a2 = run_levelset(dom, Scenario(ig, duration_s=t_end / mult, wind=w,
                                    ros_multiplier=mult)).arrival_time_s
    both = np.isfinite(a1) & np.isfinite(a2) & (a1 > 0)
    diff = mult * a2[both] - a1[both]
    cell_s = dx / r_head
    return {"mult": mult, "u10_ms": u10, "dx_m": dx, "cells": int(both.sum()),
            "median_rel": float(np.median(np.abs(diff) / a1[both])),
            "max_abs_s": float(np.abs(diff).max()), "cell_time_s": cell_s,
            "frac_within_cell": float(np.mean(np.abs(diff) <= cell_s)),
            "burned_cells_1": int(np.isfinite(a1).sum()), "burned_cells_2": int(np.isfinite(a2).sum())}


def fuel_interface_case(fm_a: int = 1, fm_b: int = 12, dx: float = 10.0):
    """No wind; FM a around the ignition, FM b beyond x0 + d_a. The east ray's rate changes at the boundary."""
    from rekindle.fuels import fuel_bed
    from rekindle.levelset import run_levelset
    from rekindle.rothermel import FTMIN_TO_MS, spread_params
    from rekindle.scenario import Ignition, Moisture, Scenario

    ra, rb = (spread_params(fuel_bed(f), Moisture().as_tuple()).r0 * FTMIN_TO_MS for f in (fm_a, fm_b))
    d_a, d_b = 400.0, 200.0
    t_end = d_a / ra + d_b / rb
    n = int(2 * max(d_a + 200, ra * t_end + 200) / dx)
    fuel = np.full((n, n), fm_a, dtype=np.int16)
    c = n * dx / 2
    jb = int((c + d_a) / dx)
    fuel[:, jb:] = fm_b
    dom = Domain(fuel=fuel, dx=dx)
    arr = run_levelset(dom, Scenario((Ignition(c, c),), duration_s=t_end)).arrival_time_s
    xb = jb * dx - c
    rate_a = ray_rate(arr, dom, c, c, 90.0, 100.0, xb - 100.0)
    rate_b = ray_rate(arr, dom, c, c, 90.0, xb + 60.0, xb + 0.8 * d_b)
    r = np.linspace(50.0, xb + 0.8 * d_b, 400)
    tt = sample(arr, dom, c + r, np.full_like(r, c))
    mono = bool(np.all(np.diff(tt[np.isfinite(tt)]) >= -1e-6))
    return {"fm_a": fm_a, "fm_b": fm_b, "expected_a_ms": ra, "expected_b_ms": rb,
            "rate_a_ms": rate_a, "rate_b_ms": rate_b, "monotone": mono}
