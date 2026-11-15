"""Domain and Scenario dataclasses (no rasters needed: tests build synthetic domains)."""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from dataclasses import asdict, dataclass, field

import numpy as np


@dataclass(frozen=True)
class Domain:
    """Square-cell grid in a local metric CRS. Row 0 is the north edge, column 0 the west.

    fuel: Anderson model number per cell (0 = non-burnable). slope_deg: terrain slope.
    aspect_deg: downslope azimuth (0 = north, clockwise; ignored where slope is 0).
    Cell (i, j) centre: x = (j + 0.5) dx east, y = (ny − i − 0.5) dx north of the SW corner.
    """

    fuel: np.ndarray
    dx: float
    slope_deg: np.ndarray | None = None
    aspect_deg: np.ndarray | None = None
    nonburnable: np.ndarray | None = None
    meta: dict = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return self.fuel.shape  # type: ignore[return-value]

    @classmethod
    def uniform(cls, ny: int, nx: int, dx: float, fuel: int = 1, **kw) -> Domain:
        return cls(fuel=np.full((ny, nx), fuel, dtype=np.int16), dx=dx, **kw)

    def xy(self) -> tuple[np.ndarray, np.ndarray]:
        """Cell-centre coordinates (x east, y north) in metres, each (ny, nx)."""
        ny, nx = self.shape
        x = (np.arange(nx) + 0.5) * self.dx
        y = (ny - np.arange(ny) - 0.5) * self.dx
        return np.meshgrid(x, y)

    def ij(self, x: float, y: float) -> tuple[int, int]:
        ny, _ = self.shape
        return int(ny - 1 - math.floor(y / self.dx)), math.floor(x / self.dx)

    def burnable(self) -> np.ndarray:
        b = self.fuel > 0
        if self.nonburnable is not None:
            b &= ~self.nonburnable
        return b

    def digest(self) -> str:
        h = hashlib.sha256()
        for a in (self.fuel, self.slope_deg, self.aspect_deg, self.nonburnable):
            h.update(b"-" if a is None else np.ascontiguousarray(a).tobytes())
        h.update(repr((self.shape, self.dx)).encode())
        return h.hexdigest()[:16]


@dataclass(frozen=True)
class Moisture:
    """Fuel moisture, fractions. Defaults = the dry-summer scenario in REKINDLE.md §1."""

    d1: float = 0.06
    d10: float = 0.07
    d100: float = 0.08
    herb: float = 0.60
    woody: float = 0.90

    def as_tuple(self) -> tuple[float, float, float, float, float]:
        return (self.d1, self.d10, self.d100, self.herb, self.woody)


@dataclass(frozen=True)
class WindSample:
    t_s: float
    speed_ms: float  # 10 m wind
    from_deg: float  # meteorological "from" azimuth


@dataclass(frozen=True)
class Ignition:
    x_m: float
    y_m: float
    t_s: float = 0.0


@dataclass(frozen=True)
class Scenario:
    ignitions: tuple[Ignition, ...]
    duration_s: float
    wind: tuple[WindSample, ...] = (WindSample(0.0, 0.0, 0.0),)
    moisture: Moisture = Moisture()
    ros_multiplier: float = 1.0
    waf: float = 0.4  # wind adjustment factor: midflame = WAF × U_20ft
    wind_limit: bool = False
    label: str = ""

    def wind_at(self, t: float) -> tuple[float, float]:
        """10 m wind (speed m/s, from-deg) at time t: linear in (u, v), constant outside."""
        ws = sorted(self.wind, key=lambda w: w.t_s)
        if len(ws) == 1 or t <= ws[0].t_s:
            return ws[0].speed_ms, ws[0].from_deg
        if t >= ws[-1].t_s:
            return ws[-1].speed_ms, ws[-1].from_deg
        for a, b in itertools.pairwise(ws):
            if a.t_s <= t <= b.t_s:
                f = (t - a.t_s) / (b.t_s - a.t_s) if b.t_s > a.t_s else 0.0
                ua, va = _uv(a)
                ub, vb = _uv(b)
                u, v = ua + f * (ub - ua), va + f * (vb - va)
                return math.hypot(u, v), math.degrees(math.atan2(u, v)) % 360.0
        raise AssertionError("unreachable")

    def to_json(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)


def _uv(w: WindSample) -> tuple[float, float]:
    """(east, north) components of the "from" vector; only used for interpolation."""
    r = math.radians(w.from_deg)
    return w.speed_ms * math.sin(r), w.speed_ms * math.cos(r)


def params_hash(domain: Domain, scenario: Scenario, solver: dict) -> str:
    h = hashlib.sha256()
    h.update(domain.digest().encode())
    h.update(scenario.to_json().encode())
    h.update(json.dumps(solver, sort_keys=True).encode())
    return h.hexdigest()[:16]
