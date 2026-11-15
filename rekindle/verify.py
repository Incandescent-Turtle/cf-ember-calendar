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
