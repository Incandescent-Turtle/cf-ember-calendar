"""Anderson (1982) 13 fuel models and the IGBP land-cover crosswalk (REKINDLE.md §1)."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from rekindle.rothermel import TONS_AC_TO_LB_FT2, FuelBed

DATA = Path(__file__).parent / "data" / "anderson13.csv"
NON_BURNABLE = 0
SAV_10H = 109.0
SAV_100H = 30.0


@dataclass(frozen=True)
class FuelModel:
    number: int
    name: str
    bed: FuelBed


def _f(x: str) -> float:
    return float(x) if x.strip() else 0.0


@cache
def anderson13() -> dict[int, FuelModel]:
    """Fuel models 1–13 keyed by number, loads converted to lb/ft²."""
    with DATA.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(line for line in fh if not line.startswith("#")))
    out: dict[int, FuelModel] = {}
    for r in rows:
        loads = [_f(r[k]) * TONS_AC_TO_LB_FT2 for k in ("w1h", "w10h", "w100h", "wherb", "wwoody")]
        sav = [_f(r["sav1h"]), SAV_10H, SAV_100H, _f(r["savherb"]), _f(r["savwoody"])]
        sav = [s if w > 0 else 0.0 for s, w in zip(sav, loads, strict=True)]
        heat = _f(r["heat_btu_lb"])
        bed = FuelBed(
            w0=tuple(loads),
            sav=tuple(sav),
            depth=_f(r["depth_ft"]),
            mx_dead=_f(r["mx_pct"]) / 100.0,
            heat=(heat,) * 5,
        )
        n = int(r["model"])
        out[n] = FuelModel(number=n, name=r["name"], bed=bed)
    return out


def fuel_bed(number: int) -> FuelBed | None:
    """FuelBed for a model number; None for non-burnable (0)."""
    if number == NON_BURNABLE:
        return None
    return anderson13()[number].bed


# IGBP (MCD12Q1 LC_Type1) → Anderson fuel model. An assumption: user-overridable.
IGBP_TO_FM: dict[int, int] = {
    1: 10,  # evergreen needleleaf forest
    2: 9,  # evergreen broadleaf forest
    3: 9,  # deciduous needleleaf forest
    4: 9,  # deciduous broadleaf forest
    5: 9,  # mixed forest
    6: 4,  # closed shrubland
    7: 6,  # open shrubland
    8: 2,  # woody savanna
    9: 2,  # savanna
    10: 1,  # grassland (FM 3 "tall grass" via override)
    11: NON_BURNABLE,  # permanent wetland
    12: 1,  # cropland
    13: NON_BURNABLE,  # urban
    14: 2,  # cropland / natural mosaic
    15: NON_BURNABLE,  # snow and ice
    16: NON_BURNABLE,  # barren
    17: NON_BURNABLE,  # water
}


def igbp_to_fuel(igbp: int, overrides: dict[int, int] | None = None) -> int:
    """Fuel model for an IGBP class; unknown classes are non-burnable."""
    table = IGBP_TO_FM | (overrides or {})
    return table.get(int(igbp), NON_BURNABLE)
