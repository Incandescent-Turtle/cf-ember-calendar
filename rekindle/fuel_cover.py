"""Fractional vegetation cover from MODIS MOD44B v061 VCF (S6b change A, docs/DECISIONS.md).

    uv run python -m rekindle.fuel_cover --fire chilecito-2026

Adds `nonveg_pct` (MOD44B Percent_NonVegetated, year before the fire, nearest to the grid;
255 = no data) to data/rekindle/<fire>/domain.npz. `rekindle.prep` calls `fetch_vcf` too.
`rekindle.domain.load(..., nonveg_max_pct=T)` then marks cells with nonveg > T non-burnable:
Rothermel assumes a continuous fuel bed, and fire does not percolate through a landscape
whose burnable fraction is below ~30–70 % (van Nes et al. 2018); T = 50 is pre-registered.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle import earthdata

NODATA = 255


def fetch_vcf(fire_year: int, transform, ny: int, nx: int, crs: str, ll_bounds,
              raw: Path) -> tuple[np.ndarray, dict]:
    from rekindle.prep import _cmr_granule, _modis_tile, _read_modis

    w, s, e, n = ll_bounds
    tiles = {_modis_tile(lo, la) for lo in (w, e) for la in (s, n)}
    if len(tiles) != 1:
        raise RuntimeError(f"domain spans several MODIS tiles {tiles}; not supported yet")
    h, v = tiles.pop()
    url, year = _cmr_granule("MOD44B", "061", h, v, fire_year - 1)
    path = earthdata.download(url, raw / Path(url).name)
    a = _read_modis(path, "Percent_NonVegetated", h, v, transform, ny, nx, crs)
    out = np.where(a <= 100, a, NODATA).astype(np.uint8)  # 200 = fill
    src = {"product": "MOD44B v061 Percent_NonVegetated", "year": year,
           "granule": Path(url).name}
    return out, src


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    a = ap.parse_args()
    from rasterio.transform import Affine

    d = dict(np.load(dm.DATA / a.fire / "domain.npz"))
    meta_p = dm.DATA / a.fire / "meta.json"
    meta = json.loads(meta_p.read_text())
    ny, nx = meta["shape"]
    transform = Affine(*meta["transform"])
    year = int(meta["t0"][:4])
    nv, src = fetch_vcf(year, transform, ny, nx, meta["crs"], meta["grid_bounds_lonlat"],
                        dm.DATA / a.fire / "raw")
    d["nonveg_pct"] = nv
    np.savez_compressed(dm.DATA / a.fire / "domain.npz", **d)
    meta["sources"]["fuel_cover"] = src
    meta_p.write_text(json.dumps(meta, indent=1))
    ok = nv != NODATA
    burn = ~d["nonburnable"]
    print(f"{src['granule']}: nonveg p10/p50/p90 {np.percentile(nv[ok], [10, 50, 90])} %, "
          f"no data {int((~ok).sum())} cells")
    for t in (50, 80):
        print(f"  nonveg > {t} %: {np.mean(burn & ok & (nv > t)):.1%} of the domain becomes "
              f"non-burnable (burnable before: {burn.mean():.1%})")
    ig = meta["ignitions"]
    obs = meta["observed"]
    for label, pts in (("ignitions", ig), ("detections", obs)):
        vals = [nv[int((ny * meta["dx_m"] - o["y_m"]) // meta["dx_m"]),
                   int(o["x_m"] // meta["dx_m"])] for o in pts]
        vals = np.array([v for v in vals if v != NODATA])
        print(f"  at {label}: nonveg p10/p50/p90 {np.percentile(vals, [10, 50, 90])} %")


if __name__ == "__main__":
    main()
