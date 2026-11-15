"""Domain prep for a curated fire (REKINDLE.md §4): terrain, fuels, wind, ignitions, detections.

    uv run python -m rekindle.prep --fire chilecito-2026

Sources (choices logged in docs/DECISIONS.md, S6):
- DEM: Copernicus GLO-30 (AWS Open Data COGs, no login), windowed reads only.
- Fuels: MCD12Q1 v061 LC_Type1 (IGBP), year before the fire or latest; fractional cover from
  MOD44B v061 (nonveg_pct, rekindle.fuel_cover); water from MOD44W v061
  and IGBP class 17. LP DAAC, Earthdata token.
- Wind: MERRA-2 M2T1NXSLV hourly U10M/V10M (+T2M, QV2M) at the domain centre, bilinear from
  the 4 surrounding grid points, via the Earthdata cloud OPeNDAP (DAP4 CSV subset).
- Hotspots: data/processed/points (FIRMS, read-only), rekindle.hotspots.detections.

Writes data/rekindle/<fire>/domain.npz and meta.json. Downloads go to data/rekindle/<fire>/raw.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import requests

from rekindle import earthdata
from rekindle.fuels import IGBP_TO_FM, NON_BURNABLE
from rekindle.hotspots import detections, load_fire

UTC = dt.UTC
CMR = "https://cmr.earthdata.nasa.gov/search"
COP_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/"
    "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif"
)
SINU = "+proj=sinu +R=6371007.181 +nadgrids=@null +wktext +units=m +no_defs"
MODIS_T = 1111950.5197665  # sinusoidal tile size, m
MODIS_X0, MODIS_Y0 = -20015109.355798, 10007554.677899
MERRA_COLLECTION = "M2T1NXSLV"


def log(notes: list[str], msg: str) -> None:
    print(msg)
    notes.append(msg)


# ---- grid --------------------------------------------------------------------------------


def make_grid(fire: dict, dx: float, size_m: float, crs: str):
    from pyproj import Transformer
    from rasterio.transform import from_origin

    w, s, e, n = fire["bbox"]
    to_utm = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    cx, cy = to_utm.transform((w + e) / 2, (s + n) / 2)
    nx = ny = round(size_m / dx)
    west = math.floor((cx - nx * dx / 2) / dx) * dx
    north = math.floor((cy + ny * dx / 2) / dx) * dx
    return from_origin(west, north, dx, dx), ny, nx


def grid_lonlat_bounds(transform, ny: int, nx: int, crs: str, buffer_deg: float = 0.02):
    from pyproj import Transformer

    to_ll = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    xs = np.linspace(transform.c, transform.c + nx * transform.a, 21)
    ys = np.linspace(transform.f, transform.f + ny * transform.e, 21)
    gx, gy = np.meshgrid(xs, ys)
    lon, lat = to_ll.transform(gx.ravel(), gy.ravel())
    return (min(lon) - buffer_deg, min(lat) - buffer_deg, max(lon) + buffer_deg,
            max(lat) + buffer_deg)


# ---- DEM ---------------------------------------------------------------------------------


def _cop_name(lat0: int, lon0: int) -> tuple[str, str]:
    return (f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}", f"{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}")


def fetch_dem(transform, ny, nx, crs, ll_bounds, raw: Path, notes: list[str]) -> np.ndarray:
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import from_bounds

    cache = raw / "dem_utm.npy"
    if cache.exists():
        return np.load(cache)
    w, s, e, n = ll_bounds
    out = np.full((ny, nx), np.nan, dtype=np.float32)
    used = []
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MAX_RETRY": "3"}
    with rasterio.Env(**env):
        for lat0 in range(math.floor(s), math.floor(n) + 1):
            for lon0 in range(math.floor(w), math.floor(e) + 1):
                la, lo = _cop_name(lat0, lon0)
                url = COP_URL.format(lat=la, lon=lo)
                try:
                    src = rasterio.open(url)
                except rasterio.errors.RasterioIOError:
                    log(notes, f"DEM tile {la}{lo}: not available (ocean or missing)")
                    continue
                with src:
                    win = from_bounds(max(w, src.bounds.left), max(s, src.bounds.bottom),
                                      min(e, src.bounds.right), min(n, src.bounds.top),
                                      src.transform).round_offsets().round_lengths()
                    if win.width <= 0 or win.height <= 0:
                        continue
                    a = src.read(1, window=win).astype(np.float32)
                    tmp = np.full((ny, nx), np.nan, dtype=np.float32)
                    reproject(a, tmp, src_transform=src.window_transform(win), src_crs=src.crs,
                              dst_transform=transform, dst_crs=crs, src_nodata=src.nodata,
                              dst_nodata=np.nan, resampling=Resampling.bilinear)
                    out = np.where(np.isnan(out), tmp, out)
                    used.append(f"{la}{lo}")
    log(notes, f"DEM: Copernicus GLO-30 tiles {used}, bilinear to the UTM grid")
    if np.isnan(out).any():
        log(notes, f"DEM: {int(np.isnan(out).sum())} cells without data, filled with nearest")
        from scipy import ndimage

        idx = ndimage.distance_transform_edt(np.isnan(out), return_distances=False,
                                             return_indices=True)
        out = out[tuple(idx)]
    raw.mkdir(parents=True, exist_ok=True)
    np.save(cache, out)
    return out


def slope_aspect(z: np.ndarray, dx: float) -> tuple[np.ndarray, np.ndarray]:
    """Slope (deg) and downslope azimuth (deg, 0 = north, clockwise). Row 0 = north."""
    dz_drow, dz_dcol = np.gradient(z.astype(float), dx)
    dzdx, dzdy = dz_dcol, -dz_drow  # x east, y north
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) + 360.0) % 360.0
    return slope.astype(np.float32), aspect.astype(np.float32)


# ---- MODIS land cover / water ------------------------------------------------------------


def _modis_tile(lon: float, lat: float) -> tuple[int, int]:
    from pyproj import Transformer

    x, y = Transformer.from_crs("EPSG:4326", SINU, always_xy=True).transform(lon, lat)
    return int((x - MODIS_X0) // MODIS_T), int((MODIS_Y0 - y) // MODIS_T)


def _cmr_granule(short_name: str, version: str, h: int, v: int, year: int) -> tuple[str, int]:
    """URL and year of the tile's granule for `year`, else the latest one before it."""
    r = requests.get(f"{CMR}/granules.json", timeout=60, params={
        "short_name": short_name, "version": version, "page_size": 50,
        "readable_granule_name": f"*.h{h:02d}v{v:02d}.*", "sort_key": "-start_date",
        "options[readable_granule_name][pattern]": "true",
        "temporal": f"2001-01-01T00:00:00Z,{year}-12-31T23:59:59Z"})
    r.raise_for_status()
    for g in r.json()["feed"]["entry"]:
        hdf = [lk["href"] for lk in g["links"] if lk["href"].endswith(".hdf")
               and lk["href"].startswith("https")]
        if hdf:
            return hdf[0], int(g["time_start"][:4])
    raise RuntimeError(f"no {short_name} granule for h{h:02d}v{v:02d} <= {year}")


def _read_modis(path: Path, sds: str, h: int, v: int, transform, ny, nx, crs) -> np.ndarray:
    from pyhdf.SD import SD, SDC
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject

    f = SD(str(path), SDC.READ)
    a = f.select(sds).get()
    f.end()
    px = MODIS_T / a.shape[0]
    src_t = from_origin(MODIS_X0 + h * MODIS_T, MODIS_Y0 - v * MODIS_T, px, px)
    out = np.zeros((ny, nx), dtype=a.dtype)
    reproject(a, out, src_transform=src_t, src_crs=SINU, dst_transform=transform, dst_crs=crs,
              resampling=Resampling.nearest)
    return out


def fetch_landcover(fire, transform, ny, nx, crs, ll_bounds, raw: Path, notes: list[str]):
    w, s, e, n = ll_bounds
    tiles = {_modis_tile(lo, la) for lo in (w, e) for la in (s, n)}
    if len(tiles) != 1:
        raise RuntimeError(f"domain spans several MODIS tiles {tiles}; not supported yet")
    h, v = tiles.pop()
    fire_year = int(str(fire["start"])[:4])
    src: dict = {}
    url, year = _cmr_granule("MCD12Q1", "061", h, v, fire_year - 1)
    path = earthdata.download(url, raw / Path(url).name)
    igbp = _read_modis(path, "LC_Type1", h, v, transform, ny, nx, crs)
    src["landcover"] = {"product": "MCD12Q1 v061 LC_Type1 (IGBP)", "year": year,
                        "granule": Path(url).name}
    log(notes, f"Fuels: MCD12Q1 v061 IGBP {year} (h{h:02d}v{v:02d}), nearest to 90 m")
    if year != fire_year - 1:
        log(notes, f"Land cover: {fire_year - 1} not available; used {year}")
    water = igbp == 17
    try:
        url, wyear = _cmr_granule("MOD44W", "061", h, v, fire_year - 1)
        wp = earthdata.download(url, raw / Path(url).name)
        wm = _read_modis(wp, "water_mask", h, v, transform, ny, nx, crs)
        water |= wm == 1
        src["water"] = {"product": "MOD44W v061 water_mask", "year": wyear,
                        "granule": Path(url).name}
        log(notes, f"Water: MOD44W v061 {wyear} ∪ IGBP 17 ({int(water.sum())} cells)")
    except Exception as exc:  # noqa: BLE001 - fall back to IGBP water only
        log(notes, f"Water: MOD44W failed ({exc}); IGBP class 17 only")
    return igbp, water, src


# ---- MERRA-2 wind --------------------------------------------------------------------------


def _merra_collection_id() -> str:
    r = requests.get(f"{CMR}/collections.json", timeout=60,
                     params={"short_name": MERRA_COLLECTION, "version": "5.12.4"})
    r.raise_for_status()
    return r.json()["feed"]["entry"][0]["id"]


def _parse_dap_csv(text: str) -> dict[str, np.ndarray]:
    """DAP4 CSV: '/var[i][j], v0, v1, …' rows (last dim along the row)."""
    rows: dict[str, list] = {}
    for line in text.splitlines():
        if not line.startswith("/"):
            continue
        key, *vals = (p.strip() for p in line.split(","))
        name = key[1:].split("[")[0]
        rows.setdefault(name, []).append([float(x) for x in vals])
    return {k: np.array(v) for k, v in rows.items()}


def fetch_wind(lon: float, lat: float, t0: dt.datetime, t1: dt.datetime, raw: Path,
               notes: list[str]) -> list[dict]:
    cache = raw / "merra2_point.json"
    if cache.exists():
        return json.loads(cache.read_text())
    cid = _merra_collection_id()
    j0 = math.floor((lat + 90.0) / 0.5)  # lat = -90 + 0.5 j
    i0 = math.floor((lon + 180.0) / 0.625)  # lon = -180 + 0.625 i
    fy, fx = (lat + 90.0) / 0.5 - j0, (lon + 180.0) / 0.625 - i0
    wts = np.array([[(1 - fy) * (1 - fx), (1 - fy) * fx], [fy * (1 - fx), fy * fx]])
    series = []
    day = t0.date()
    while day <= t1.date():
        d = day.strftime("%Y%m%d")
        stream = "400"  # MERRA2_400 = 2011 onwards
        gran = f"M2T1NXSLV.5.12.4:MERRA2_{stream}.tavg1_2d_slv_Nx.{d}.nc4"
        ce = ";".join(f"/{v}[0:1:23][{j0}:1:{j0 + 1}][{i0}:1:{i0 + 1}]"
                      for v in ("U10M", "V10M", "T2M", "QV2M"))
        ce += f";/lat[{j0}:1:{j0 + 1}];/lon[{i0}:1:{i0 + 1}]"
        url = (f"https://opendap.earthdata.nasa.gov/collections/{cid}/granules/{gran}.dap.csv"
               f"?dap4.ce={requests.utils.quote(ce, safe='/:;=')}")
        r = earthdata.get(url)
        if r.status_code != 200:
            raise RuntimeError(f"MERRA-2 {d}: HTTP {r.status_code}")
        a = _parse_dap_csv(r.text)
        lats, lons = a["lat"].ravel(), a["lon"].ravel()
        assert abs(lats[0] - (-90 + 0.5 * j0)) < 1e-6 and abs(lons[0] - (-180 + 0.625 * i0)) < 1e-6
        val = {k: (a[k].reshape(24, 2, 2) * wts).sum(axis=(1, 2)) for k in ("U10M", "V10M", "T2M",
                                                                             "QV2M")}
        for hr in range(24):
            t = dt.datetime.combine(day, dt.time(hr, 30), tzinfo=UTC)  # tavg1: centred on :30
            u, v = float(val["U10M"][hr]), float(val["V10M"][hr])
            series.append({"t": t.isoformat().replace("+00:00", "Z"), "u10": round(u, 3),
                           "v10": round(v, 3), "speed_ms": round(math.hypot(u, v), 3),
                           "from_deg": round((math.degrees(math.atan2(-u, -v)) + 360) % 360, 1),
                           "t2m_c": round(float(val["T2M"][hr]) - 273.15, 2),
                           "qv2m_gkg": round(float(val["QV2M"][hr]) * 1000, 3)})
        day += dt.timedelta(days=1)
    log(notes, f"Wind: MERRA-2 M2T1NXSLV hourly at ({lon:.3f}, {lat:.3f}), bilinear from grid "
               f"points lat {-90 + 0.5 * j0}/{-90 + 0.5 * (j0 + 1)}, lon "
               f"{-180 + 0.625 * i0}/{-180 + 0.625 * (i0 + 1)}; {len(series)} hours")
    raw.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(series))
    return series


# ---- main ----------------------------------------------------------------------------------


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fire", default="chilecito-2026")
    ap.add_argument("--dx", type=float, default=90.0)
    ap.add_argument("--size-km", type=float, default=40.0)
    ap.add_argument("--crs", default=None, help="default: fires.yaml 'crs'")
    ap.add_argument("--points", type=Path, default=Path("data/processed/points"))
    ap.add_argument("--out", type=Path, default=Path("data/rekindle"))
    a = ap.parse_args()
    from pyproj import Transformer

    fire = load_fire(a.fire)
    crs = a.crs or fire.get("crs", "EPSG:32719")
    out = a.out / a.fire
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    notes: list[str] = []
    transform, ny, nx = make_grid(fire, a.dx, a.size_km * 1000, crs)
    llb = grid_lonlat_bounds(transform, ny, nx, crs)
    log(notes, f"Grid: {crs}, {nx}×{ny} at {a.dx:.0f} m, lon/lat bounds {np.round(llb, 4).tolist()}")

    # Hotspots (observed arrival times; ignition = first overpass).
    det = detections(a.points, fire).fetchnumpy()
    t_obs = [dt.datetime.fromisoformat(str(np.datetime_as_string(t, "s"))).replace(tzinfo=UTC)
             for t in det["t_utc"]]
    to_utm = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    ex, ey = to_utm.transform(det["lon"], det["lat"])
    x0, y_south = transform.c, transform.f + ny * transform.e
    t_first = min(t_obs)
    obs = [{"lon": float(lo), "lat": float(la), "x_m": float(x - x0), "y_m": float(y - y_south),
            "t": iso(t), "sensor": str(sn), "frp": float(fr), "scan": float(sc),
            "track": float(tr), "daynight": int(dn) if dn is not None else None}
           for lo, la, x, y, t, sn, fr, sc, tr, dn in zip(
               det["lon"], det["lat"], ex, ey, t_obs, det["sensor"], det["frp"], det["scan"],
               det["track"], det["daynight"], strict=True)]
    ign = [dict(o, t_s=0.0) for o in obs if o["t"] == iso(t_first)]
    log(notes, f"Ignition: {len(ign)} {ign[0]['sensor']} pixels at {iso(t_first)} (first overpass); "
               f"{len(obs)} detections to {max(o['t'] for o in obs)}")

    # Terrain and fuels.
    z = fetch_dem(transform, ny, nx, crs, llb, raw, notes)
    slope, aspect = slope_aspect(z, a.dx)
    igbp, water, lc_src = fetch_landcover(fire, transform, ny, nx, crs, llb, raw, notes)
    lut = np.full(256, NON_BURNABLE, dtype=np.int16)
    for k, fm in (IGBP_TO_FM | {int(k): int(v) for k, v in fire.get("igbp_overrides", {}).items()}).items():
        lut[k] = fm
    fuel = lut[igbp.astype(np.int64)]
    nonburnable = water | (fuel == NON_BURNABLE)
    from rekindle.fuel_cover import fetch_vcf

    nonveg, vcf_src = fetch_vcf(int(str(fire["start"])[:4]), transform, ny, nx, crs, llb, raw)
    lc_src["fuel_cover"] = vcf_src
    log(notes, f"Fuel cover: {vcf_src['product']} {vcf_src['year']}, nearest to the grid "
               f"(non-vegetated median {np.median(nonveg[nonveg <= 100]):.0f} %)")
    classes, counts = np.unique(igbp, return_counts=True)
    log(notes, "IGBP classes (cells): " + ", ".join(f"{int(c)}:{int(n)}" for c, n in
                                                     zip(classes, counts, strict=True)))

    # Wind.
    w, s, e, n = fire["bbox"]
    t_end = dt.datetime.fromisoformat(str(fire["end"])).replace(tzinfo=UTC) + dt.timedelta(days=1)
    wind: list[dict] = []
    wind_source = "MERRA-2"
    try:
        wind = fetch_wind((w + e) / 2, (s + n) / 2, t_first - dt.timedelta(hours=2), t_end, raw,
                          notes)
    except Exception as exc:  # noqa: BLE001 - logged; baseline falls back to fixed wind
        wind_source = "fixed (MERRA-2 unavailable)"
        log(notes, f"Wind: MERRA-2 download failed ({exc}); baseline uses a FIXED wind")

    np.savez_compressed(
        out / "domain.npz", elevation=z.astype(np.float32), slope_deg=slope, aspect_deg=aspect,
        fuel=fuel.astype(np.int16), nonburnable=nonburnable, igbp=igbp.astype(np.uint8),
        nonveg_pct=nonveg,
        transform=np.array(transform)[:6], dx=a.dx)
    meta = {
        "id": a.fire, "name": fire["name"], "bbox": fire["bbox"], "crs": crs, "dx_m": a.dx,
        "shape": [ny, nx], "transform": list(np.array(transform)[:6]),
        "grid_bounds_lonlat": list(llb), "t0": iso(t_first), "window_end": iso(t_end),
        "ignitions": ign, "observed": obs, "wind_source": wind_source, "wind": wind,
        "sources": {"dem": "Copernicus DEM GLO-30 (AWS Open Data, COG)", **lc_src,
                    "wind": "MERRA-2 M2T1NXSLV v5.12.4" if wind else None,
                    "hotspots": "NASA FIRMS (MODIS C6.1, VIIRS 375 m)"},
        "notes": notes,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    burn = ~nonburnable
    print(f"wrote {out}/domain.npz + meta.json; burnable {burn.mean():.0%}, "
          f"elev {np.nanmin(z):.0f}–{np.nanmax(z):.0f} m, slope p50/p95 "
          f"{np.percentile(slope, 50):.1f}/{np.percentile(slope, 95):.1f}°")


if __name__ == "__main__":
    main()
