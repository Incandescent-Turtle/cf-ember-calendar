"""Load a prepared fire domain (rekindle.prep output) as a Domain + baseline Scenario pieces."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np

from rekindle.scenario import Domain, Ignition, WindSample

DATA = Path("data/rekindle")


def parse_t(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s)


def load(fire_id: str, root: Path = DATA,
         nonveg_max_pct: float | None = None) -> tuple[Domain, dict]:
    """Prepared domain. nonveg_max_pct: cells whose MOD44B non-vegetated % exceeds it are
    non-burnable (S6b change A; needs `nonveg_pct` from rekindle.fuel_cover)."""
    d = np.load(root / fire_id / "domain.npz")
    meta = json.loads((root / fire_id / "meta.json").read_text())
    nonburnable = d["nonburnable"]
    if nonveg_max_pct is not None:
        if "nonveg_pct" not in d:
            raise KeyError(f"{fire_id}: no nonveg_pct in domain.npz; run rekindle.fuel_cover")
        nv = d["nonveg_pct"]
        nonburnable = nonburnable | ((nv <= 100) & (nv > nonveg_max_pct))
    dom = Domain(
        fuel=d["fuel"], dx=float(d["dx"]), slope_deg=d["slope_deg"], aspect_deg=d["aspect_deg"],
        nonburnable=nonburnable, meta={"id": fire_id},
    )
    return dom, meta


def ignitions(meta: dict) -> tuple[Ignition, ...]:
    return tuple(Ignition(ig["x_m"], ig["y_m"], ig["t_s"]) for ig in meta["ignitions"])


def observed_wind(meta: dict) -> tuple[WindSample, ...]:
    t0 = parse_t(meta["t0"])
    return tuple(
        WindSample((parse_t(w["t"]) - t0).total_seconds(), w["speed_ms"], w["from_deg"])
        for w in meta["wind"]
    )
