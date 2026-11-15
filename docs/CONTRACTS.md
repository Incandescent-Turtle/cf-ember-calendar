# CONTRACTS.md — file formats shared between tracks

The pipeline writes these files, the web app reads them, Rekindle exports its own. **If you change a format, change this doc in the same commit and tell the other tracks.** Generate golden fixtures from the Python side.

## Hosting layout

```
<VITE_DATA_BASE_URL>/                    # data host (HF dataset / R2 / GCS bucket / Pages)
  manifest.json
  calibration.json
  validation.json
  cube/l01/<tile>.bin.gz                 # 0.1° cells, one file per 10° tile that has any fire
  cube/l10/global.bin.gz                 # 1° cells, whole world
  points/<tile>/<year>.parquet           # cleaned detections
web/public/                              # ships with the SPA (same origin)
  rekindle/index.json
  rekindle/<fire_id>/…                   # see "Rekindle files"
  countries.geojson                      # simplified Natural Earth admin-0
  recent.json                            # NRT snapshot (provisional)
```

## Time axis: dekads

`t = (year − 2000) × 36 + (month − 1) × 3 + (dekad − 1)`, `dekad ∈ {1: days 1–10, 2: days 11–20, 3: day 21 → month end}`, all UTC. `t` fits in `u16` until 2000 + 1820 years. Month of `t`: `floor(t / 3) mod 12`; year: `2000 + floor(t / 36)`. Python and TS helpers `dekad_index(date)`, `dekad_range(t)` live in `pipeline/grid.py` and `web/src/lib/time.ts`, with a shared golden test.

Dekads, not days: month-to-date comparisons are the challenge's headline use ("current month vs historical median") and need sub-monthly data; dekads give it at 3× the size of monthly rather than 30×.

## Series ids

| id | meaning |
|---|---|
| 0 | MODIS (Terra + Aqua combined), fire-cell-days |
| 1 | VIIRS S-NPP |
| 2 | VIIRS NOAA-20 |
| 3 | VIIRS NOAA-21 (reserved; not used in v1) |

Values are **fire-cell-days (FCD)**: the number of distinct (0.01° cell, UTC day) pairs with ≥ 1 cleaned detection, **summed** over all 0.01° cells inside the coarse cell and all days in the dekad. Summation is exact (no double counting), so any AOI is a sum over coarse cells.

## Grids

- **L01:** 0.1° cells. Tile = 10° × 10°, id `{N|S}{lat:02d}{E|W}{lon:03d}` of the **south-west corner**, e.g. `S30W070` covers lat −30…−20, lon −70…−60. Cell id inside the tile: `c = row × 100 + col`, `row = floor((lat − tile_south) / 0.1)`, `col = floor((lon − tile_west) / 0.1)`, `0 ≤ c < 10000`.
- **L10:** 1° cells, global. `c = row × 360 + col`, `row = floor(lat + 90)`, `col = floor(lon + 180)`, `0 ≤ c < 64800` (fits `u16`).
- Cell centres, not corners, are used for AOI membership. Edge cases (lon = 180, lat = 90) clamp inward.

## Cube file (`.bin.gz`)

gzip of this little-endian binary, **columnar and sparse** (only non-zero cells):

```
offset 0   4 bytes   magic "EMBC"
offset 4   u8        version = 1
offset 5   u8        level   = 1 (L01) | 10 (L10)
offset 6   u16       reserved = 0
offset 8   u32       n  (number of entries)
offset 12  u8  [n]   s   series id
           u16 [n]   t   dekad index
           u16 [n]   c   cell id
           u16 [n]   v   FCD (saturating at 65535)
```
Entries sorted by `(s, t, c)`. Column offsets: `12`, `12+n`, `12+3n`, `12+5n` (each column contiguous; alignment for typed arrays: copy slices to aligned buffers). Total length = `12 + 7n`.
Reader and writer each have a round-trip test; the web decoder is tested against a pipeline-generated fixture cube.

## `manifest.json`

```json
{
  "version": 1,
  "built_at": "2026-11-15T09:00:00Z",
  "dekad_range": [31, 971],
  "series": ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"],
  "tiles": ["S30W070", "S20W060"],
  "l10": "cube/l10/global.bin.gz",
  "overlap": {"start": "2013-01-01", "end": "2021-12-31"},
  "snpp_end": "2026-11-02",
  "min_modis_fcd": 200,
  "points": {"years": [2000, 2026], "tiles": ["S30W070"]},
  "row_counts": {"MODIS": 0, "VIIRS_SNPP": 0, "VIIRS_NOAA20": 0},
  "sizes_mb": {"cubes": 0, "points": 0}
}
```
(`dekad_range[0] = 31`: Nov 11 2000 → `(2000−2000)×36 + 10×3 + 1`.)

## `calibration.json`

```json
{
  "global":  {"k": [12 numbers], "lo": [12], "hi": [12], "n_modis": [12]},
  "tile":    {"S30W070": {"k": [12], "lo": [12], "hi": [12], "n_modis": [12]}},
  "n20":     {"global": {"k": [12], "lo": [12], "hi": [12]}, "tile": {}}
}
```
Arrays are indexed by calendar month 0–11. `k` = VIIRS_SNPP FCD / MODIS FCD over the overlap years (ratio of sums), `lo`/`hi` = bootstrap 5th/95th percentiles. `n20.*` is the NOAA-20→S-NPP cross-calibration (2020-06 … 2026-10), used for dekads after `snpp_end`. Missing tiles: the client falls back to `global`.

## `validation.json`

```json
{
  "loyo": {
    "levels": [{
      "level": "global" | "tile",
      "n_series": 0,
      "calibrated":       {"r_log": 0, "mdape": 0, "bias_log": 0},
      "fcd_uncalibrated": {"r_log": 0, "mdape": 0, "bias_log": 0},
      "raw_counts":       {"r_log": 0, "mdape": 0, "bias_log": 0}
    }]
  },
  "seam": {
    "scopes": [{"name": "global", "months": ["2008-01", "..."],
                "modis_raw": [], "viirs_raw": [], "harmonized": []}],
    "test": {"window_months": 24, "mean_log_diff_before": 0, "mean_log_diff_after": 0}
  },
  "seasonality": {"median_r": 0, "n_tiles": 0},
  "params": {"overlap": ["2013-01-01", "2021-12-31"], "min_modis_fcd": 200}
}
```

## Points file (`points/<tile>/<year>.parquet`)

Tile = the same 10° tile ids. Sorted by `lat` ascending; row group size 100,000; zstd compression. Columns:

| column | type | notes |
|---|---|---|
| `lat`, `lon` | float32 | ≈ 1.5 m precision; note it in the export README |
| `t_utc` | int32 | minutes since 2000-01-01T00:00Z |
| `sensor` | uint8 | 1 MODIS_TERRA, 2 MODIS_AQUA, 3 VIIRS_SNPP, 4 VIIRS_NOAA20, 5 VIIRS_NOAA21 |
| `frp` | float32 | MW |
| `daynight` | uint8 | 0 = day, 1 = night |
| `conf` | uint8 | 0 low, 1 nominal, 2 high |
| `scan`, `track` | float32 | pixel size, km |
| `bt_mir`, `bt_tir` | float32 | brightness temperatures, K (MODIS: brightness, bright_t31; VIIRS: bright_ti4, bright_ti5) |
| `type` | uint8 | FIRMS `type` code, 255 if absent |

**CSV export columns (in this order):** `latitude,longitude,acq_datetime_utc,sensor,instrument,frp_mw,daynight,confidence_class,scan_km,track_km,bt_mir_k,bt_tir_k,type`. UTF-8, header row, `\n` line endings, ISO-8601 datetimes with `Z`.

## Rekindle files (`web/public/rekindle/`)

`index.json`:
```json
{"fires": [{"id": "chilecito-2026", "name": "Chilecito, La Rioja, Argentina — Jul 2026", "bbox": [w, s, e, n]}]}
```

`<fire_id>/meta.json`:
```json
{
  "id": "chilecito-2026", "name": "…", "bbox": [w, s, e, n],
  "raster": {"crs": "EPSG:3857", "width": 400, "height": 400,
             "bounds_3857": [xmin, ymin, xmax, ymax], "bounds_lonlat": [w, s, e, n], "dx_m": 90},
  "status": "validated",   // "validated" (baseline passed the gate) | "poor_agreement" (baseline only) | "uncalibrated" (no hotspots to check)
  "start": "2026-07-..T..:..Z", "end": "2026-07-..T..:..Z",
  "ignitions": [{"lon": 0, "lat": 0, "t": "ISO"}],
  "baseline": {"wind_ms": 0, "wind_from_deg": 0, "dead_moisture_pct": 6, "ros_multiplier": 1.0},
  "axes": {"wind_ms": [0, 3, 6, 9, 12, 15],
           "wind_from_deg": [0, 45, 90, 135, 180, 225, 270, 315],
           "dead_moisture_pct": [4, 6, 10, 14]},
  "notes": "dead_moisture_pct is the 1-h value; 10-h = +1, 100-h = +2 points; live moisture fixed at baseline"
}
```

`<fire_id>/observed.geojson`: FeatureCollection of Points, properties `{t: ISO, sensor: "VIIRS_SNPP", frp: number, scan: km, track: km}`.

`<fire_id>/runs/index.json`:
```json
{"runs": [{"key": "baseline", "wind_ms": 0, "wind_from_deg": 0, "dead_moisture_pct": 6,
           "file": "runs/baseline.u16.gz",
           "burned_km2_by_hour": [0, 0.3, "..."],
           "metrics": {"median_timing_error_h": 0, "iqr_h": 0, "hit_rate": 0, "sorensen": 0, "area_km2": 0}},
          {"key": "ws09_wd270_m06", "…": "…"}]}
```
Grid-run keys: `ws{wind_ms:02d}_wd{deg:03d}_m{moist:02d}`, e.g. `ws09_wd270_m06`. `metrics` is filled only for `baseline` (it's the only run with observations to compare to); other runs carry `area_km2` only.

`<fire_id>/runs/<key>.u16.gz`: gzip of little-endian `uint16`, row-major, **north-up (row 0 = north edge)**, `width × height` from `meta.raster`. Value = arrival time in **minutes after the first ignition**; `65535` = not reached within the run duration. Raster is on the **EPSG:3857-aligned** grid in `bounds_3857`, so MapLibre's image source (which stretches linearly in Web Mercator) lines up exactly.

Size budget: ≈ 80 KB per run gzipped × (192 grid + baseline) ≈ 15–20 MB per fire → fits Pages (≤ 25 MiB/file, ≤ 20k files). If a second fire doubles it, still fine.

## Golden files (`tests/golden/`)

- `time_cases.json` — date ↔ dekad index.
- `harmonize_cases.json` — monthly (or dekadal) MODIS / S-NPP / NOAA-20 series + k tables → expected harmonized series with bands and provenance.
- `analytics_cases.json` — percentile/label, z-scores, critical period, Theil–Sen + Mann–Kendall, month-to-date.
Generated by `uv run python -m pipeline.make_golden`; consumed by `web` tests (`npm test`). **Never hand-edit.**
