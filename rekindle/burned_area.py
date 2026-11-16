"""S6g (post-hoc): independent check of the hotspot answer key with MODIS MCD64A1 burned area.

    uv run python -m rekindle.burned_area            # all fires in data/rekindle with a baseline

MCD64A1 v061 (500 m, monthly, per-pixel burn day from surface reflectance change) is resampled to
each fire's 90 m grid (nearest). Burned = burn day within the run period (first detection day − 1
to the run end + SLACK_AFTER_D days). Reports, per fire:
- Sørensen(hotspot footprint, MCD64A1): how well the hotspots outline the burn (the ceiling);
- Sørensen(model baseline, MCD64A1) vs Sørensen(model, hotspots);
- burn day vs first-detection day for each scored hotspot pixel (day precision);
- model arrival day vs burn day over MCD64A1 pixels.
S6i-b: whole domain, against MCD64A1 patches connected to this fire's hotspots (± 1 km).
Writes docs/report/rekindle/burned_area_check.json.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np
import requests

from rekindle import domain as dm
from rekindle import earthdata, metrics
from rekindle.export import web_safe
from rekindle.prep import CMR, _modis_tile, _read_modis

REPORT = Path("docs/report/rekindle")
SLACK_AFTER_D = 7  # MCD64A1 burn dates lag under cloud; count burns up to a week after the run
FIRES = ["chilecito-2026", "cordoba-2024", "sask-2023", "bc-2024", "larioja-2025", "chaco-2024"]


def granule_urls(h: int, v: int, months: list[dt.date]) -> list[str]:
    out = []
    for m in months:
        end = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        r = requests.get(f"{CMR}/granules.json", timeout=60, params={
            "short_name": "MCD64A1", "version": "061", "page_size": 10,
            "readable_granule_name": f"*.h{h:02d}v{v:02d}.*",
            "options[readable_granule_name][pattern]": "true",
            "temporal": f"{m.isoformat()}T00:00:00Z,{end.isoformat()}T23:59:59Z"})
        r.raise_for_status()
        for g in r.json()["feed"]["entry"]:
            if g["time_start"][:7] != m.isoformat()[:7]:
                continue
            hdf = [lk["href"] for lk in g["links"]
                   if lk["href"].endswith(".hdf") and lk["href"].startswith("https")]
            if hdf:
                out.append(hdf[0])
                break
        else:
            raise RuntimeError(f"no MCD64A1 granule h{h:02d}v{v:02d} {m:%Y-%m}")
    return out


def burn_dates(fire: str, meta: dict, t0: dt.datetime, t1: dt.datetime) -> tuple[np.ndarray, list]:
    """Burn date (days since 1970, float; nan = not burned in [t0−1 d, t1+1 d]) on the fire grid."""
    from affine import Affine

    ny, nx = meta["shape"]
    transform = Affine(*meta["transform"])
    lo, la = np.array(meta["bbox"][0::2]), np.array(meta["bbox"][1::2])
    tiles = {_modis_tile(x, y) for x in lo for y in la}
    t1s = t1 + dt.timedelta(days=SLACK_AFTER_D)
    months = sorted({dt.date(d.year, d.month, 1) for d in (t0.date(), t1.date(), t1s.date())})
    raw = dm.DATA / fire / "raw"
    out = np.full((ny, nx), np.nan)
    used = []
    for h, v in tiles:
        for url in granule_urls(h, v, months):
            path = earthdata.download(url, raw / Path(url).name)
            used.append(Path(url).name)
            year = int(Path(url).name.split(".")[1][1:5])
            doy = _read_modis(path, "Burn Date", h, v, transform, ny, nx, meta["crs"]).astype(float)
            days = np.where(doy > 0, (dt.date(year, 1, 1) - dt.date(1970, 1, 1)).days + doy - 1,
                            np.nan)
            ok = (days >= (t0.date() - dt.date(1970, 1, 1)).days - 1) & (
                days <= (t1s.date() - dt.date(1970, 1, 1)).days)
            out = np.where(np.isnan(out) & ok, days, out)
    return out, used


def in_bbox(meta: dict) -> np.ndarray:
    """Grid cells whose centre lies in the fire bbox (where hotspots were collected)."""
    from pyproj import Transformer

    ny, nx = meta["shape"]
    t = meta["transform"]
    xs = t[2] + (np.arange(nx) + 0.5) * t[0]
    ys = t[5] + (np.arange(ny) + 0.5) * t[4]
    gx, gy = np.meshgrid(xs, ys)
    lon, lat = Transformer.from_crs(meta["crs"], "EPSG:4326", always_xy=True).transform(gx, gy)
    w, s, e, n = meta["bbox"]
    return (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)


def export_outline(fire: str, meta: dict, bd: np.ndarray, t0: dt.datetime) -> None:
    """MCD64A1 burn day as a uint16 raster on the web grid (rekindle.export encoding): minutes
    from the run start to 00:00 UTC of the burn day (clipped at 0; day precision), 65535 = not
    burned. The SPA outlines cells burned by the clock time with the isochrone code."""
    from rekindle.export import WEB, encode, target_grid, to_3857

    ny, nx = meta["shape"]
    dst_t, h, w, _, _ = target_grid(meta, ny, nx)
    epoch0 = (t0 - dt.datetime(1970, 1, 1, tzinfo=t0.tzinfo)).total_seconds() / 86400
    sec = np.where(np.isfinite(bd), np.maximum(bd - epoch0, 0.0) * 86400, np.inf).astype(np.float32)
    span_h = float(np.nanmax(sec[np.isfinite(sec)]) / 3600 + 1) if np.isfinite(sec).any() else 1.0
    (WEB / fire).mkdir(parents=True, exist_ok=True)
    (WEB / fire / "mcd64.u16.gz").write_bytes(encode(to_3857(sec, meta, dst_t, h, w), span_h))


def fire_connected(burned: np.ndarray, hot: np.ndarray, dx: float, buffer_m: float = 1000.0) -> np.ndarray:
    """MCD64A1 burned patches (8-connected) touching the hotspot footprint dilated by buffer_m."""
    from scipy.ndimage import binary_dilation, label

    lab, _ = label(burned, structure=np.ones((3, 3), bool))
    near = binary_dilation(hot, iterations=max(1, round(buffer_m / dx)))
    keep = np.unique(lab[near & burned])
    return np.isin(lab, keep[keep > 0])


def sor(a: np.ndarray, b: np.ndarray) -> float:
    return float(2 * (a & b).sum() / max(int(a.sum()) + int(b.sum()), 1))


def check(fire: str) -> dict:
    cal = json.loads((dm.DATA / fire / "calibration.json").read_text())
    dom, meta = dm.load(fire, nonveg_max_pct=(cal.get("model_settings") or {}).get("nonveg_max_pct"))
    t0 = dm.parse_t(meta["t0"])
    t1 = t0 + dt.timedelta(hours=cal["hours"])
    bd, used = burn_dates(fire, meta, t0, t1)
    prep = metrics.prepare(meta, dom.shape, dom.dx, cal["hours"] * 3600)
    hot = prep["union"]
    # S6i-b: whole domain, MCD64A1 patches connected to this fire's hotspots (± 1 km)
    bd = np.where(fire_connected(np.isfinite(bd), hot, dom.dx), bd, np.nan)
    export_outline(fire, meta, bd, t0)
    np.save(dm.DATA / fire / "mcd64_burnday.npy", bd.astype(np.float32))  # for calibrate_shape
    mcd = np.isfinite(bd)
    arr = np.load(dm.DATA / fire / "baseline.npy")
    model = np.isfinite(arr) & (arr <= cal["hours"] * 3600)
    epoch0 = (t0 - dt.datetime(1970, 1, 1, tzinfo=t0.tzinfo)).total_seconds() / 86400
    # burn day vs first-detection day, per scored hotspot footprint (median burn day inside it)
    det_d = []
    for key, t in prep["first"].items():
        b = bd[key[0]:key[1], key[2]:key[3]]
        b = b[np.isfinite(b)]
        if b.size:
            det_d.append(np.floor(epoch0 + t / 86400) - np.median(b))
    det_d = np.array(det_d)
    # model arrival day vs burn day over MCD64A1 pixels the model reaches
    both = mcd & model
    mod_d = np.floor(epoch0 + arr[both] / 86400) - bd[both]
    # timing vs hotspots: raw |Δ| and interval-censored (credit for any arrival between the last
    # overpass before the detection and the detection)
    passes = prep["passes"]
    raw_d, cen_d = [], []
    for key, t in prep["first"].items():
        if t <= 0:
            continue
        a = arr[key[0]:key[1], key[2]:key[3]]
        ts = float(a.min()) if a.size else np.inf
        prev = passes[passes < t]
        tp = prev[-1] if prev.size else -np.inf
        raw_d.append(abs(ts - t) / 3600)
        cen_d.append(0.0 if tp < ts <= t else (tp - ts if ts <= tp else ts - t) / 3600)
    raw_d, cen_d = np.array(raw_d), np.array(cen_d)
    cell = dom.dx ** 2 / 1e6
    res = {
        "timing_vs_hotspots": {
            "median_abs_h": round(float(np.median(raw_d)), 2),
            "censored_median_h": round(float(np.median(cen_d)), 2),
            "inside_interval": round(float(np.mean(cen_d == 0)), 3),
            "gate_h": round(float(cal["gate"]["threshold_h"]), 2)},
        "fire": fire, "granules": used,
        "mcd64_km2": round(float(mcd.sum() * cell), 1),
        "hotspot_footprint_km2": round(float(hot.sum() * cell), 1),
        "model_km2": round(float(model.sum() * cell), 1),
        "sorensen_hotspots_vs_mcd64": round(sor(hot, mcd), 3),
        "sorensen_model_vs_mcd64": round(sor(model, mcd), 3),
        "sorensen_model_vs_hotspots": round(sor(model, hot), 3),
        "mcd64_covered_by_hotspots": round(float((hot & mcd).sum() / max(mcd.sum(), 1)), 3),
        "hotspots_on_mcd64": round(float((hot & mcd).sum() / max(hot.sum(), 1)), 3),
        "detection_minus_burn_day": {
            "n": int(det_d.size), "median": float(np.median(det_d)) if det_d.size else None,
            "within_1_day": round(float(np.mean(np.abs(det_d) <= 1)), 3) if det_d.size else None},
        "model_minus_burn_day": {
            "n": int(mod_d.size), "median": float(np.median(mod_d)) if mod_d.size else None,
            "median_abs": float(np.median(np.abs(mod_d))) if mod_d.size else None,
            "within_1_day": round(float(np.mean(np.abs(mod_d) <= 1)), 3) if mod_d.size else None},
    }
    return res


def main() -> None:
    out = []
    for f in FIRES:
        if not (dm.DATA / f / "baseline.npy").exists():
            continue
        try:
            r = check(f)
        except Exception as exc:  # noqa: BLE001 - report and continue with the next fire
            print(f"{f}: failed ({exc})")
            continue
        out.append(r)
        from rekindle.export import WEB
        (WEB / f / "reference.json").write_text(json.dumps(web_safe(r), separators=(",", ":")))
        d, m = r["detection_minus_burn_day"], r["model_minus_burn_day"]
        print(f"{f:15s} MCD64 {r['mcd64_km2']:7.1f} km² | hot {r['hotspot_footprint_km2']:6.1f} "
              f"model {r['model_km2']:7.1f} | Sør hot~MCD {r['sorensen_hotspots_vs_mcd64']:.2f} "
              f"model~MCD {r['sorensen_model_vs_mcd64']:.2f} model~hot "
              f"{r['sorensen_model_vs_hotspots']:.2f} | det−burn day med {d['median']} "
              f"(±1 d {d['within_1_day']}) | model−burn day med {m['median']} |·| "
              f"{m['median_abs']} (±1 d {m['within_1_day']})", flush=True)
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / "burned_area_check.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
