"""Elliptical fire shape: length-to-breadth, eccentricity, R(θ) with ignition at the rear focus.

LB form: 0.936 e^(0.2566 U) + 0.461 e^(−0.1548 U) − 0.397 with U in **m/s**. These are Anderson's
(1983, INT-305 eq 17) mi/h coefficients 0.1147 / 0.0692 converted to m/s (× 2.237), with the
−0.397 offset that makes LB(0) = 1: FARSITE, Finney 1998 (RMRS-RP-4) eq 13 p. 7, U = effective
midflame wind in m/s, LB > 8 truncated, origin at the rear focus. REKINDLE.md said U in mi/h,
which would overstate LB about 2×; see docs/DECISIONS.md (S5). Clamped to 1 ≤ LB ≤ 8.
"""

from __future__ import annotations

import numpy as np

LB_MAX = 8.0


def length_to_breadth(u_eff_ms: np.ndarray | float) -> np.ndarray | float:
    """LB from effective wind speed U_E (m/s), clamped to [1, 8]."""
    u = np.maximum(np.asarray(u_eff_ms, dtype=float), 0.0)
    lb = 0.936 * np.exp(0.2566 * u) + 0.461 * np.exp(-0.1548 * u) - 0.397
    return np.clip(lb, 1.0, LB_MAX)


def eccentricity(lb: np.ndarray | float) -> np.ndarray | float:
    lb = np.asarray(lb, dtype=float)
    return np.sqrt(np.maximum(lb * lb - 1.0, 0.0)) / lb


def ros_polar(r_head: np.ndarray | float, e: np.ndarray | float, cos_theta) -> np.ndarray:
    """R(θ) = R_head (1 − e) / (1 − e cos θ): distance rate from the rear focus at angle θ."""
    return np.asarray(r_head) * (1.0 - e) / (1.0 - np.asarray(e) * cos_theta)


def backing_rate(r_head: np.ndarray | float, e: np.ndarray | float) -> np.ndarray:
    return np.asarray(r_head) * (1.0 - e) / (1.0 + e)


def ros_normal(r_head, e, lb, cos_theta, sin_theta) -> np.ndarray:
    """Normal speed of a front whose wavelet is that ellipse (Huygens; Richards 1990).

    Support function of the ellipse with the ignition at its rear focus, for a unit normal at
    angle θ from the head: S = c cos θ + sqrt(a² cos² θ + b² sin² θ), with a = (R_h + R_b)/2,
    c = (R_h − R_b)/2, b = a / LB. S(0) = R_head, S(π) = R_back, S(±π/2) = b.
    A level set moved with this normal speed from a point grows exactly that ellipse.
    """
    r_back = backing_rate(r_head, e)
    a = 0.5 * (np.asarray(r_head) + r_back)
    c = 0.5 * (np.asarray(r_head) - r_back)
    b = a / lb
    return c * cos_theta + np.sqrt((a * cos_theta) ** 2 + (b * sin_theta) ** 2)
