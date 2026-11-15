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
  exports/global_harmonized_monthly_1deg.{parquet,csv.gz} + README.md   # optional, see "Global harmonized table"
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
- **Implementation rule (pipeline):** every id is derived from the integer 0.01° indices `r01 = floor((lat + 90) × 100 + 1e-9)`, `q01 = floor((lon + 180) × 100 + 1e-9)` (clamped to 0…17999 / 0…35999): `cell01 = r01 × 36000 + q01`; tile = `(r01 ÷ 1000, q01 ÷ 1000)`; L01 `c = (r01 ÷ 10 mod 100) × 100 + (q01 ÷ 10 mod 100)`; L10 `c = (r01 ÷ 100) × 360 + q01 ÷ 100` (integer division). The `1e-9` stops coordinates on a grid line (e.g. −29.51) falling into the cell below through float error. A TS port that bins points must use the same rule (`pipeline/grid.py`).

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
  "dekad_range": [30, 965],
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
(`dekad_range` is computed from the data: the FIRMS MODIS record starts 2000-11-01, so `dekad_range[0] = 30` = `(2000−2000)×36 + 10×3 + 0`. Clients must read it, never hard-code it.)

## `calibration.json`

```json
{
  "global":  {"k": [12 numbers], "lo": [12], "hi": [12], "n_modis": [12]},
  "tile":    {"S30W070": {"k": [12], "lo": [12], "hi": [12], "n_modis": [12]}},
  "n20":     {"global": {"k": [12], "lo": [12], "hi": [12]}, "tile": {}}
}
```
Arrays are indexed by calendar month 0–11. `k` = VIIRS_SNPP FCD / MODIS FCD over the overlap years (ratio of sums), `lo`/`hi` = bootstrap 5th/95th percentiles. `n20.*` is the NOAA-20→S-NPP cross-calibration (2020-06 … 2026-10, or the record end if earlier), used from the dekad containing `snpp_end`. Missing tiles: the client falls back to `global`.

- **`null`** = undefined (the denominator is 0 for that month). JSON has no NaN; clients treat `null` like NaN (`Number.isFinite(null) === false`).
- **`n_modis`** = the denominator count over the fit window: MODIS FCD in `global`/`tile`, **NOAA-20 FCD** in `n20.*` (same key, so one client code path applies `min_modis_fcd` to both). `n20.global` carries it too.
- A tile is listed only if it has a non-zero denominator in some month.
- Bootstrap: resample the fit years with replacement 200×, per month, with **mulberry32(1000 + month)**, drawing `floor(rnd() × nYears)` year indices in year order; skip resamples with a zero denominator; 5th/95th by linear interpolation at `(n − 1) q`. A year counts for a month only if at least one of that month's dekads is inside the fit window. This is exactly `fitRatio` in `web/src/lib/harmonize.ts`, so both sides give identical bands.
- An extra `params` object (overlap, n20 fit dates, `min_modis_fcd`, bootstrap settings) is informational.

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
Definitions and additions (all extra fields are optional for readers):
- **LOYO** pools (series, month) points over the held-out years. `r_log` = Pearson r of log1p(pred) vs log1p(obs) where either is > 0; `mdape` = median |pred − obs| / obs in %, over points with obs ≥ 10; `bias_log` = mean(log1p(pred) − log1p(obs)) over the same points. `calibrated` at tile level uses the tile's k, or global k when the tile's other-year MODIS FCD for that month < `min_modis_fcd`. `raw_counts` = the naive method: a detection-count ratio fitted the same way, predicting VIIRS detection counts. Extra: `raw_counts_uncalibrated` (counts, k = 1), `n_points`, `n_mdape` per method, `loyo.years`.
- **Seam scopes:** `global`, the hero AOI (`Chilecito, Argentina (25 km)`, 0.1° cells whose centre is within 25 km of −67.7, −29.15) and its 10° tile. `viirs_raw` is S-NPP FCD, `null` before 2012-01. Extra per scope: `harmonized_lo`, `harmonized_hi`, `spliced_raw`, `k_strata`, `k_modis`, and `test` = `step_*` (mean log1p of the 24 months from 2012-02 minus the 24 before) for MODIS-only, raw spliced and harmonized; `mean_log_diff_before` = spliced − MODIS, `mean_log_diff_after` = harmonized − MODIS (≈ 0 means no seam); `sparse` = true when the windows average < 10 MODIS FCD a month (then the test measures zeros, not the seam). Top-level `seam.test` copies the global scope.
- **Seasonality:** per tile, Pearson r of the 12 median months, 2001–2011 harmonized MODIS vs 2013–2025 S-NPP; tiles with < 12 FCD/yr in either cycle or a flat cycle are skipped. Extra: `p25_r`, `p75_r`, year ranges.

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

## Browser exports (generated client-side, F5)

- **Calendar CSV** (`ember-calendar_<area>_<last-dekad-end>_calendar.csv`): one row per month in the record, ASCII (no BOM), header row, `
`. Columns: the PRODUCT F5 set first, in order — `year,month,harmonized,harmonized_lo,harmonized_hi,modis_fcd,viirs_fcd,k,k_stratum,percentile` — then `k_lo,k_hi,snpp_fcd,n20_fcd,era,partial,n_dekads,k_source`. `month` is 1–12. Numbers rounded to 4 decimals; empty = not defined (VIIRS before 2012, no k). In the S-NPP era `k = 1`, `k_stratum = reference`. `percentile` = mid-rank vs the same calendar month in full months of other years than the current one; empty for partial months. `viirs_fcd` = S-NPP before the NOAA-20 switch, NOAA-20 after.
- **Summary JSON** (`…_summary.json`): area (label, kind, bbox, km², resolution, cells, tiles, geometry), data build (host, built_at, dekad_range, scope), k per month with stratum and source, baseline years, climatology, current-year months, month-to-date **with its inputs** (current and baseline dekad values), critical period, trend, annual totals, top years/months, busiest month. NaN → `null`. Informational; not read by any code.
- **Calendar PNG**: the ECharts canvas at 2× with title, legend and source line.
- **Hotspot CSV**: the columns above (Points file → CSV export columns), time-ordered; `daynight` written `D`/`N`, `confidence_class` `low`/`nominal`/`high`, `type` empty when 255; lat/lon to 5 decimals. Capped at 200 MiB of row groups to read (estimated from Parquet footers before any data is fetched) or 3 M rows; above either, no file and a link to FIRMS Archive Download.

## Global harmonized table (`exports/`, optional)

Written by `pipeline.export_global` from the L10 cube + `calibration.json` + `manifest.json` (read-only on the build); uploaded by `scripts/sync_data.sh --exports DIR`.

- `global_harmonized_monthly_1deg.parquet` (zstd) and `.csv.gz` (ASCII, header row, `\n`, floats rounded to 4 decimals, empty = undefined), same rows and columns; `README.md` = data dictionary, units, FIRMS acknowledgement, licence; `.stats.json` = row counts and totals.
- **One row per 1° cell and month with any raw activity** (MODIS, S-NPP or NOAA-20 FCD > 0), sorted by `cell, year, month`. A missing cell-month = 0 in every column.
- Columns: `cell` (L10 id = row × 360 + col), `lon_center`, `lat_center`, `tile` (10° tile id), then the **calendar CSV columns** (Browser exports) without `percentile`: `year,month,harmonized,harmonized_lo,harmonized_hi,modis_fcd,viirs_fcd,k,k_stratum,k_lo,k_hi,snpp_fcd,n20_fcd,era,partial,n_dekads,k_source`. Same meanings; `k_source` says "this cell" where the app says "this area".
- **Each row equals the app's calendar row for an area covering exactly that cell**: same eras, k choice (cell's own overlap fit if its denominator ≥ `min_modis_fcd`, else the tile's k, else global, else aoi-sparse/none), year bootstrap. Checked against the golden harmonize cases and against `web/src/lib/harmonize.ts` on real cells (`tests/pipeline/test_export_global.py`; DECISIONS.md S7). Summing harmonized values over several cells is *not* the app's value for their union when their k differ.
- `manifest.exports.global_table` (added by `sync_data.sh --exports`): `{"parquet": "exports/….parquet", "csv_gz": "exports/….csv.gz", "readme": "exports/README.md", "rows": n, "cells": n, "bytes": {"parquet": n, "csv_gz": n}}`. The methodology page shows the download links only when this exists (or when `VITE_GLOBAL_TABLE=1`).

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
  "notes": "dead_moisture_pct is the 1-h value; 10-h = +1, 100-h = +2 points; live moisture fixed at baseline",
  // S6b additions (rekindle.export):
  "model_settings": {"nonveg_max_pct": 50, "diurnal_moisture": true, "wind": "bilinear", "seed_h": 0},
  "moisture": {"baseline": "hourly",   // "constant": the baseline used dead_moisture_pct; "hourly": time-lag series
               "dead_1h_pct_min": 3.1, "dead_1h_pct_median": 5.4, "dead_1h_pct_max": 14.0,
               "hourly": {"columns": ["t_h", "d1_pct", "d10_pct", "d100_pct"], "rows": [[0, 5.2, 6.0, 6.1]]}},
  "spread_profile": {"observed": [{"t_h": 1.4, "max_km": 5.8, "median_km": 2.1, "n": 12}],
                     "model_km_by_hour": [0, 3.2, "..."], "definition": "…"}
}
```
With `moisture.baseline == "hourly"` the baseline's `dead_moisture_pct` is only the what-if starting value; what-if runs always use a constant moisture. `spread_profile` = burst-and-stall diagnostic (`rekindle.spread_profile`): farthest detection per overpass vs the calibrated model's head-run distance from the nearest ignition.

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

`<fire_id>/burst/index.json` (S6c, **EXPLORATORY / post-hoc**; `rekindle.burst`; optional, the SPA treats a 404 as "none"):
```json
{"fire": "chilecito-2026", "EXPLORATORY": true, "post_hoc": true, "what": "…", "rule": "…", "gate_h": 3.21,
 "axes": {"wind_scale": [0, 0.5, 1, 1.5, 2], "dead_delta_pct": [-2, 0, 2, 4], "dead_floor_pct": 2},
 "all_windows": [{"index": 0, "t_k_h": 0, "ros_multiplier": 2.0, "median_abs_timing_error_h": 6.5, "median_timing_error_h": -6.1,
                  "sorensen": 0.14, "n_pixels": 215, "hit_rate": 0.74, "area_km2": 737, "observed_footprint_km2": 57,
                  "qualifies": false, "reasons": ["…"]}],
 "windows": [{"…every all_windows field…": "", "start": "ISO", "start_h_after_t0": 24.0, "hours": 24, "n_ignitions": 224,
              "rothermel": {"fuel_model": 1, "wind_10m_ms_median": 1.6, "dead_1h_pct_median": 5.6,
                            "rows": [{"wind_scale": 1, "dead_delta_pct": 0, "head_kmh": 1.2, "ratio": 1.0}]},
              "baseline_rerun_check": {"median_abs_timing_error_h": 2.27, "sorensen": 0.456},
              "observed": [{"lon": 0, "lat": 0, "t_h": 1.5, "sensor": "VIIRS_NOAA20"}],
              "runs": [{"key": "w1_u100_dp0", "file": "burst/w1_u100_dp0.u16.gz", "wind_scale": 1, "dead_delta_pct": 0,
                        "burned_km2_by_hour": [0, "…"], "start_km2": 0, "end_km2": 0, "new_km2": 0,
                        "new_km2_vs_baseline": 0, "new_ratio_vs_baseline": 1.0}]}]}
```
Optional `shape` (S6d, `rekindle.shape_whatif`, whole-fire footprint what-ifs, **shape only**): the same fields as a window plus `kind: "whole_fire_shape"`, `what`, `gate_h`, `dead_1h_pct_baseline` and its own `axes`. Rasters are in `burst/shape/f_u{scale}_d{m|p}{delta}.u16.gz`, with minutes after the first ignition. `rekindle.burst` keeps an existing `shape` entry when it rewrites the index.

`windows` holds only qualifying 24 h windows (rule in `rule`; DECISIONS.md "Pre-registration — S6c"). The window baseline is `wind_scale` 1, `dead_delta_pct` 0. Burst-run keys: `w{index}_u{round(scale·100):03d}_d{m|p}{|delta|}`, e.g. `w1_u150_dm2`. Rasters use the same grid and encoding as `runs/<key>.u16.gz`, but minutes count from the **window start**; cells at 0 are the detected extent that the run restarts from.

Size budget: ≈ 80 KB per run gzipped × (192 grid + baseline) ≈ 15–20 MB per fire → fits Pages (≤ 25 MiB/file, ≤ 20k files). If a second fire doubles it, still fine.

## Golden files (`tests/golden/`)

- `time_cases.json` — date ↔ dekad index.
- `harmonize_cases.json` — monthly (or dekadal) MODIS / S-NPP / NOAA-20 series + k tables → expected harmonized series with bands and provenance.
- `analytics_cases.json` — percentile/label, z-scores, critical period, Theil–Sen + Mann–Kendall, month-to-date.
Generated by `uv run python -m pipeline.make_golden`; consumed by `web` tests (`npm test`). **Never hand-edit.**

Format (field names follow the TS types):
- `time_cases.json`: `dekad_index: [{date, t}]`, `dekad_range: [{t, range: [first, last], month, year}]`.
- `harmonize_cases.json`: `tolerance {rel, abs}` (1e-9), `cases: [{name, input: {t0, nT, tiles, perTile, manifest, calibration}, expected: {years, tSwitch, tN20, kModis[12], kN20[12], rows, percentile}}]`. `perTile[i][s·nT + (t − t0)]` as in `AoiSeries`; `kModis[m] = {k, lo, hi, stratum}`; `rows` indexed `(year − years[0])·12 + month` with `stratum` (null in the S-NPP era) and `nDekads`; `percentile: [{month, value, excludeYear, expected}]` for `monthPercentile`. `null` = NaN. One case (`fixture-chilecito`) is real fixture data.
- `analytics_cases.json`: `rules` (the spec text from `pipeline/analytics.py`), `quantile`, `assess` (`{value, base} → {percentile, label, z, clim}`), `monthToDate`, `criticalPeriod`, `trend` (`trend_p_abs` tolerance 1e-6 for the erfc), and `fromSeries` (climatology, current-year months, critical period and trend computed from each harmonize case's rows; baseline = complete years except the last).
