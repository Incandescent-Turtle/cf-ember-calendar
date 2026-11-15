"""Rothermel (1972) surface fire spread with Albini (1976) revisions, as in BehavePlus.

Equations follow Andrews 2018 (RMRS-GTR-371) §3, which documents BehavePlus. Pure functions,
imperial units internally (ft, lb, Btu, min); SI wrappers at the boundary (``*_si``).

Particles are ordered [1-h, 10-h, 100-h, live herbaceous, live woody]: indices 0-2 dead, 3-4 live.
Moisture is a fraction (0.06 = 6 %).

Directions are azimuths in radians (0 = north, clockwise); vectors are (east, north).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# Constants (Andrews 2018 Table 2: constant for all standard fuel models).
RHO_P = 32.0  # oven-dry particle density, lb/ft³
S_T = 0.0555  # total mineral content
S_E = 0.010  # effective (silica-free) mineral content
HEAT = 8000.0  # low heat content, Btu/lb

DEAD = slice(0, 3)
LIVE = slice(3, 5)
N_PARTICLES = 5

# Albini (1976) size subclasses for the net-load weights g_ij (Andrews 2018 §3.2.3):
# σ ≥ 1200, 192–1200, 96–192, 48–96, 16–48, < 16 (the last gets weight 0).
_SUBCLASS_EDGES = (1200.0, 192.0, 96.0, 48.0, 16.0)

# Unit conversions.
FT = 0.3048  # m per ft
FTMIN_TO_MS = FT / 60.0  # ft/min -> m/s
MS_TO_FTMIN = 1.0 / FTMIN_TO_MS  # m/s -> ft/min (196.85)
FTMIN_PER_MPH = 88.0
TONS_AC_TO_LB_FT2 = 2000.0 / 43560.0
BTU_FT2_MIN_TO_KW_M2 = 1055.056 / FT**2 / 60.0 / 1000.0


@dataclass(frozen=True)
class FuelBed:
    """Fuel bed in imperial units. Arrays of length 5 in particle order."""

    w0: tuple[float, ...]  # oven-dry load, lb/ft²
    sav: tuple[float, ...]  # surface-area-to-volume ratio, 1/ft
    depth: float  # ft
    mx_dead: float  # dead moisture of extinction, fraction
    heat: tuple[float, ...] = (HEAT,) * N_PARTICLES

    @property
    def burnable(self) -> bool:
        return self.depth > 0 and sum(self.w0) > 0


@dataclass(frozen=True)
class SpreadParams:
    """No-wind, no-slope spread and the coefficients needed to add wind and slope."""

    r0: float  # ft/min
    ir: float  # reaction intensity, Btu/ft²/min
    beta: float  # packing ratio
    beta_ratio: float  # β / β_op
    sigma: float  # characteristic SAV, 1/ft
    c: float
    b: float
    e: float
    slope_k: float  # φ_s = slope_k · tan²(slope)
    rho_b: float  # bulk density, lb/ft³
    xi: float  # propagating flux ratio
    heat_sink: float  # ρ_b ε Q_ig, Btu/ft³
    mx_live: float

    def phi_wind(self, u_ftmin: np.ndarray | float) -> np.ndarray | float:
        """Wind factor φ_w for midflame wind U (ft/min)."""
        u = np.maximum(u_ftmin, 0.0)
        return self.c * u**self.b * self.beta_ratio ** (-self.e)

    def phi_slope(self, tan_slope: np.ndarray | float) -> np.ndarray | float:
        return self.slope_k * np.asarray(tan_slope) ** 2

    def effective_wind(self, phi_e: np.ndarray | float) -> np.ndarray | float:
        """U_E (ft/min) that alone gives φ_E: inverse of φ_w."""
        if self.c <= 0:
            return np.zeros_like(np.asarray(phi_e, dtype=float))
        return (np.maximum(phi_e, 0.0) * self.beta_ratio**self.e / self.c) ** (1.0 / self.b)


NO_SPREAD = SpreadParams(
    r0=0.0, ir=0.0, beta=0.0, beta_ratio=1.0, sigma=0.0, c=0.0, b=1.0, e=0.0, slope_k=0.0,
    rho_b=0.0, xi=0.0, heat_sink=0.0, mx_live=0.0,
)


def _eta_m(m: float, mx: float) -> float:
    if mx <= 0:
        return 0.0
    r = min(m / mx, 1.0)
    return 1.0 - 2.59 * r + 5.11 * r**2 - 3.52 * r**3


def _eta_s(se: float) -> float:
    return min(0.174 * se**-0.19, 1.0)


def _subclass(sav: float) -> int:
    for k, edge in enumerate(_SUBCLASS_EDGES):
        if sav >= edge:
            return k
    return len(_SUBCLASS_EDGES)


def live_mx(bed: FuelBed, moisture: tuple[float, ...]) -> float:
    """Live moisture of extinction (Andrews 2018 §3.2.2), floored at the dead M_x."""
    w = np.asarray(bed.w0, dtype=float)
    s = np.asarray(bed.sav, dtype=float)
    m = np.asarray(moisture, dtype=float)
    live_den = 0.0
    for j in range(3, 5):
        if w[j] > 0 and s[j] > 0:
            live_den += w[j] * math.exp(-500.0 / s[j])
    if live_den <= 0:
        return bed.mx_dead
    dead_w = 0.0
    dead_wm = 0.0
    for j in range(3):
        if w[j] > 0 and s[j] > 0:
            x = w[j] * math.exp(-138.0 / s[j])
            dead_w += x
            dead_wm += x * m[j]
    ratio = dead_w / live_den
    mf_dead = dead_wm / dead_w if dead_w > 0 else 0.0
    mx = 2.9 * ratio * (1.0 - mf_dead / bed.mx_dead) - 0.226
    return max(mx, bed.mx_dead)


def spread_params(bed: FuelBed, moisture: tuple[float, ...]) -> SpreadParams:
    """Rothermel no-wind, no-slope spread R_0 and wind/slope coefficients (imperial)."""
    if not bed.burnable:
        return NO_SPREAD
    w = np.asarray(bed.w0, dtype=float)
    s = np.asarray(bed.sav, dtype=float)
    m = np.asarray(moisture, dtype=float)
    h = np.asarray(bed.heat, dtype=float)
    present = (w > 0) & (s > 0)
    a = np.where(present, s * w / RHO_P, 0.0)

    mx_l = live_mx(bed, moisture)
    mx_cat = (bed.mx_dead, mx_l)
    cats = (DEAD, LIVE)
    a_cat = np.array([a[c].sum() for c in cats])
    a_tot = a_cat.sum()
    f_cat = a_cat / a_tot

    sigma = 0.0
    ir_sum = 0.0
    sink = 0.0
    for i, c in enumerate(cats):
        if a_cat[i] <= 0:
            continue
        f = a[c] / a_cat[i]
        sv = s[c]
        sigma += f_cat[i] * float((f * sv).sum())
        # Net-load weights g_ij: sum of f_ij in the same size subclass (0 below 16 1/ft).
        sub = [(_subclass(x) if p else -1) for x, p in zip(sv, present[c], strict=True)]
        g = np.zeros_like(f)
        for j, sj in enumerate(sub):
            if sj < 0 or sj == len(_SUBCLASS_EDGES):
                continue
            g[j] = sum(f[k] for k, sk in enumerate(sub) if sk == sj)
        wn = float((g * w[c] * (1.0 - S_T)).sum())
        mf = float((f * m[c]).sum())
        hi = float((f * h[c]).sum())
        ir_sum += wn * hi * _eta_m(mf, mx_cat[i]) * _eta_s(S_E)
        with np.errstate(divide="ignore"):
            eps = np.where(present[c], np.exp(-138.0 / np.where(sv > 0, sv, 1.0)), 0.0)
        qig = 250.0 + 1116.0 * m[c]
        sink += f_cat[i] * float((f * eps * qig).sum())

    rho_b = float(w.sum()) / bed.depth
    beta = rho_b / RHO_P
    beta_op = 3.348 * sigma**-0.8189
    ratio = beta / beta_op
    gamma_max = sigma**1.5 / (495.0 + 0.0594 * sigma**1.5)
    a_exp = 133.0 * sigma**-0.7913  # Albini 1976 (A18 Table 6c); R72 eq 39 differs
    gamma = gamma_max * ratio**a_exp * math.exp(a_exp * (1.0 - ratio))
    ir = gamma * ir_sum
    xi = math.exp((0.792 + 0.681 * sigma**0.5) * (beta + 0.1)) / (192.0 + 0.2595 * sigma)
    heat_sink = rho_b * sink
    r0 = ir * xi / heat_sink if heat_sink > 0 else 0.0
    return SpreadParams(
        r0=max(r0, 0.0),
        ir=ir,
        beta=beta,
        beta_ratio=ratio,
        sigma=sigma,
        c=7.47 * math.exp(-0.133 * sigma**0.55),
        b=0.02526 * sigma**0.54,
        e=0.715 * math.exp(-3.59e-4 * sigma),
        slope_k=5.275 * beta**-0.3,
        rho_b=rho_b,
        xi=xi,
        heat_sink=heat_sink,
        mx_live=mx_l,
    )


def az_vec(az: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
    """Unit vector (east, north) of an azimuth in radians."""
    return np.sin(az), np.cos(az)


@dataclass(frozen=True)
class HeadFire:
    r_head: np.ndarray  # ft/min
    head_az: np.ndarray  # radians, direction of maximum spread
    u_eff: np.ndarray  # effective wind speed, ft/min
    phi_e: np.ndarray
    wind_limited: np.ndarray  # bool


def head_fire(
    p: SpreadParams,
    u_mid_ftmin: np.ndarray | float,
    wind_toward_az: np.ndarray | float,
    tan_slope: np.ndarray | float,
    upslope_az: np.ndarray | float,
    wind_limit: bool = False,
) -> HeadFire:
    """Combine wind and slope as vectors (BehavePlus style) → head ROS, direction, U_E.

    φ_w acts along the wind's "toward" direction, φ_s upslope; φ_E = |φ_w ŵ + φ_s ŝ|,
    R_head = R_0 (1 + φ_E). With ``wind_limit`` U_E is capped at 0.9 I_R (Rothermel 1972,
    ft/min with I_R in Btu/ft²/min) and φ_E recomputed from the cap.
    """
    phw = np.asarray(p.phi_wind(u_mid_ftmin), dtype=float)
    phs = np.asarray(p.phi_slope(tan_slope), dtype=float)
    wx, wy = az_vec(np.asarray(wind_toward_az, dtype=float))
    sx, sy = az_vec(np.asarray(upslope_az, dtype=float))
    vx = phw * wx + phs * sx
    vy = phw * wy + phs * sy
    phi_e = np.hypot(vx, vy)
    head = np.arctan2(vx, vy)
    u_eff = np.asarray(p.effective_wind(phi_e), dtype=float)
    limited = np.zeros(np.shape(phi_e), dtype=bool)
    if wind_limit and p.ir > 0:
        u_max = 0.9 * p.ir
        limited = u_eff > u_max
        if np.any(limited):
            u_eff = np.where(limited, u_max, u_eff)
            phi_e = np.where(limited, p.phi_wind(u_max), phi_e)
    r_head = p.r0 * (1.0 + phi_e)
    return HeadFire(r_head=r_head, head_az=head, u_eff=u_eff, phi_e=phi_e, wind_limited=limited)


# ---- SI boundary -------------------------------------------------------------------------


def wind_10m_to_midflame(u10_ms: float | np.ndarray, waf: float = 0.4) -> float | np.ndarray:
    """10 m wind (m/s) → midflame wind (m/s): 20 ft = 10 m / 1.15, then × WAF."""
    return np.asarray(u10_ms) / 1.15 * waf


def wind_from_to_toward_az(from_deg: float | np.ndarray) -> float | np.ndarray:
    """Meteorological wind "from" azimuth (deg) → spread "toward" azimuth (rad)."""
    return np.radians((np.asarray(from_deg) + 180.0) % 360.0)


def ros_si(
    bed: FuelBed,
    moisture: tuple[float, ...],
    u_mid_ms: float = 0.0,
    wind_toward_deg: float = 0.0,
    slope_deg: float = 0.0,
    upslope_deg: float = 0.0,
    wind_limit: bool = False,
) -> dict[str, float]:
    """Point head-fire ROS in SI: inputs m/s and degrees; outputs m/s, kW/m², degrees."""
    p = spread_params(bed, moisture)
    hf = head_fire(
        p,
        u_mid_ms * MS_TO_FTMIN,
        math.radians(wind_toward_deg),
        math.tan(math.radians(slope_deg)),
        math.radians(upslope_deg),
        wind_limit=wind_limit,
    )
    return {
        "r0_ms": p.r0 * FTMIN_TO_MS,
        "r_head_ms": float(hf.r_head) * FTMIN_TO_MS,
        "head_deg": math.degrees(float(hf.head_az)) % 360.0,
        "u_eff_ms": float(hf.u_eff) * FTMIN_TO_MS,
        "ir_kw_m2": p.ir * BTU_FT2_MIN_TO_KW_M2,
        "phi_e": float(hf.phi_e),
        "wind_limited": bool(hf.wind_limited),
    }
