"""Export Rekindle runs to web/public/rekindle/ (CONTRACTS.md → "Rekindle files").

    uv run python -m rekindle.export --fire chilecito-2026

Arrival fields (UTM, seconds) → EPSG:3857-aligned uint16 minutes, north-up, gzip; 65535 = not
reached. burned_km2_by_hour uses the UTM field (true area). Also writes meta.json,
observed.geojson, runs/index.json and the top-level index.json.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path

import numpy as np

from rekindle import domain as dm
from rekindle.credits import CREDITS
from rekindle.hindcast import MOISTURE_AXIS
from rekindle.scenario_grid import WIND_FROM, WIND_MS, grid_runs, run_key

WEB = Path("web/public/rekindle")
LIMITS = (
    "Surface fire only: no crowning, spotting, suppression or fire–atmosphere feedback. "
    "Fuels from 500 m MODIS land cover through a coarse IGBP→Anderson crosswalk (the largest "
    "error source). Single-point MERRA-2 wind (~50 km grid) over steep terrain. Dead fuel "
    "moisture is a scenario value, constant in time (no day/night cycle). Hotspot times are "
    "upper bounds limited by the overpass frequency. Counterfactuals and absolute timings are "
    "illustrative; differences between runs are more reliable than absolute arrival times."
)


def target_grid(meta: dict, ny: int, nx: int):
    from pyproj import Transformer
    from rasterio.transform import from_bounds

    t = meta["transform"]
    xs = np.linspace(t[2], t[2] + nx * t[0], 41)
    ys = np.linspace(t[5], t[5] + ny * t[4], 41)
    gx, gy = np.meshgrid(xs, ys)
    edge = np.zeros_like(gx, dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    to3857 = Transformer.from_crs(meta["crs"], "EPSG:3857", always_xy=True)
    mx, my = to3857.transform(gx[edge], gy[edge])
    # outer box of the (slightly rotated) UTM square; corners outside the domain export as 65535
    xmin, xmax, ymin, ymax = float(mx.min()), float(mx.max()), float(my.min()), float(my.max())
    w = nx
    h = round(w * (ymax - ymin) / (xmax - xmin))
    to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    lo0, la0 = to_ll.transform(xmin, ymin)
    lo1, la1 = to_ll.transform(xmax, ymax)
    return from_bounds(xmin, ymin, xmax, ymax, w, h), h, w, [xmin, ymin, xmax, ymax], [
        lo0, la0, lo1, la1]


def to_3857(arr_s: np.ndarray, meta: dict, dst_t, h: int, w: int) -> np.ndarray:
    from affine import Affine
    from rasterio.warp import Resampling, reproject

    src = np.where(np.isfinite(arr_s), arr_s, np.nan).astype(np.float32)
    out = np.full((h, w), np.nan, dtype=np.float32)
    reproject(src, out, src_transform=Affine(*meta["transform"]), src_crs=meta["crs"],
              dst_transform=dst_t, dst_crs="EPSG:3857", src_nodata=np.nan, dst_nodata=np.nan,
              resampling=Resampling.nearest)
    return out


def encode(a3857: np.ndarray, hours: float) -> bytes:
    minutes = np.round(a3857 / 60.0)
    u16 = np.where(np.isfinite(minutes) & (minutes <= hours * 60), minutes, 65535)
    u16 = np.clip(u16, 0, 65535).astype("<u2")
    return gzip.compress(u16.tobytes(), compresslevel=9, mtime=0)


def burned_by_hour(arr_s: np.ndarray, dx: float, hours: int) -> list[float]:
    fin = np.sort(arr_s[np.isfinite(arr_s)].ravel())
    edges = np.arange(hours + 1) * 3600.0
    return [round(float(c) * dx * dx / 1e6, 3) for c in np.searchsorted(fin, edges, "right")]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--out", type=Path, default=WEB)
    a = ap.parse_args()
    base = dm.DATA / a.fire
    meta = json.loads((base / "meta.json").read_text())
    cal = json.loads((base / "calibration.json").read_text())
    ny, nx = meta["shape"]
    dx = meta["dx_m"]
    hours = int(cal["hours"])
    dst_t, h, w, b3857, bll = target_grid(meta, ny, nx)
    out = a.out / a.fire
    (out / "runs").mkdir(parents=True, exist_ok=True)

    runs = []
    total = 0
    n_files = 0
    status = cal["status"]
    base_wind = _mean_wind(meta, hours)
    entries = [("baseline", None)]
    if status == "validated":
        entries += [(run_key(*r), r) for r in grid_runs()]
    for key, r in entries:
        src = base / "runs" / f"{key}.npy"
        if not src.exists():
            print(f"missing {key}, skipped")
            continue
        arr = np.load(src)
        blob = encode(to_3857(arr, meta, dst_t, h, w), hours)
        (out / "runs" / f"{key}.u16.gz").write_bytes(blob)
        total += len(blob)
        n_files += 1
        byh = burned_by_hour(arr, dx, hours)
        e = {"key": key, "file": f"runs/{key}.u16.gz", "burned_km2_by_hour": byh}
        if r is None:
            e.update(wind_ms=base_wind[0], wind_from_deg=base_wind[1],
                     dead_moisture_pct=cal["dead_moisture_pct"], observed_weather=True,
                     metrics=_rounded(cal["baseline_metrics"]))
            runs.append(e)
        else:
            ws, wd, m = r
            e.update(wind_ms=ws, wind_from_deg=wd, dead_moisture_pct=m,
                     metrics={"area_km2": byh[-1]})
            runs.append(e)
            if ws == 0:  # calm: one file for every direction
                for d in WIND_FROM[1:]:
                    runs.append(dict(e, key=run_key(0, d, m)))
    (out / "runs" / "index.json").write_text(json.dumps({"runs": runs}, separators=(",", ":")))

    obs = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [o["lon"], o["lat"]]},
         "properties": {"t": o["t"], "sensor": o["sensor"], "frp": o["frp"], "scan": o["scan"],
                        "track": o["track"]}} for o in meta["observed"]]}
    (out / "observed.geojson").write_text(json.dumps(obs, separators=(",", ":")))

    t0 = dm.parse_t(meta["t0"])
    from datetime import timedelta
    web_meta = {
        "id": a.fire, "name": meta["name"], "bbox": meta["bbox"],
        "raster": {"crs": "EPSG:3857", "width": w, "height": h, "bounds_3857": b3857,
                   "bounds_lonlat": bll, "dx_m": dx},
        "status": status,
        "start": meta["t0"], "end": (t0 + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ignitions": [{"lon": g["lon"], "lat": g["lat"], "t": g["t"]} for g in meta["ignitions"]],
        "baseline": {"wind_ms": base_wind[0], "wind_from_deg": base_wind[1],
                     "dead_moisture_pct": cal["dead_moisture_pct"],
                     "ros_multiplier": cal["ros_multiplier"], "wind_source": meta["wind_source"],
                     "wind_hourly": [{"t": x["t"], "speed_ms": x["speed_ms"],
                                      "from_deg": x["from_deg"]} for x in meta["wind"]]},
        "axes": {"wind_ms": WIND_MS, "wind_from_deg": WIND_FROM,
                 "dead_moisture_pct": MOISTURE_AXIS} if status == "validated" else None,
        "validation": {"gate": cal["gate"], "metrics": _rounded(cal["baseline_metrics"]),
                       "sweep": [{k: s.get(k) for k in ("ros_multiplier",
                                                        "median_abs_timing_error_h",
                                                        "hit_rate", "sorensen")}
                                 for s in cal["sweep"]],
                       "calibrated_not_blind": cal["calibrated_not_blind"],
                       "moisture_estimate": cal["moisture_estimate"]},
        "notes": "dead_moisture_pct is the 1-h value; 10-h = +1, 100-h = +2 points; live moisture "
                 "fixed at baseline. Grid runs use a constant wind; the baseline uses the hourly "
                 "MERRA-2 wind. " + LIMITS,
        "prep_notes": meta["notes"],
        "credits": CREDITS,
    }
    (out / "meta.json").write_text(json.dumps(web_meta, indent=1))
    idx_path = a.out / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"fires": []}
    idx["fires"] = [f for f in idx["fires"] if f["id"] != a.fire] + [
        {"id": a.fire, "name": meta["name"], "bbox": meta["bbox"], "status": status}]
    idx_path.write_text(json.dumps(idx, indent=1))
    print(f"exported {n_files} run files ({len(runs)} index entries), {total / 1e6:.1f} MB "
          f"rasters, {w}×{h} px → {out}")


def _mean_wind(meta: dict, hours: float) -> tuple[float, float]:
    """Vector-mean observed wind over the run (shown as the baseline's slider position)."""
    t0 = dm.parse_t(meta["t0"])
    us, vs = [], []
    for x in meta["wind"]:
        dt_h = (dm.parse_t(x["t"]) - t0).total_seconds() / 3600
        if 0 <= dt_h <= hours:
            us.append(x["u10"])
            vs.append(x["v10"])
    u, v = float(np.mean(us)), float(np.mean(vs))
    return round(math.hypot(u, v), 2), round((math.degrees(math.atan2(-u, -v)) + 360) % 360, 1)


def _rounded(m: dict) -> dict:
    out = {}
    for k, v in m.items():
        if isinstance(v, float):
            out[k] = round(v, 3)
        elif isinstance(v, list):
            out[k] = [round(x, 3) if isinstance(x, float) else x for x in v]
        else:
            out[k] = v
    return out


if __name__ == "__main__":
    main()
