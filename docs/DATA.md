# DATA.md — sources, schemas, layout

## Sources

### Core (the challenge)

| Dataset | Use | Access |
|---|---|---|
| **FIRMS MODIS C6.1 active fire** (MCD14ML SP + MCD14DL NRT), Terra + Aqua, 1 km, 2000-11-01 → present | Historical backbone | FIRMS Archive Download (yearly files, by country or custom request); `MODIS_SP` / `MODIS_NRT` via area API |
| **FIRMS VIIRS 375 m S-NPP** (VNP14IMG), 2012-01-20 → 2026-11-02 (FIRMS stream ended) | Primary VIIRS series | Archive Download; `VIIRS_SNPP_SP` |
| **FIRMS VIIRS 375 m NOAA-20** (VJ114IMG), SP 2018-04-01 → present | Continuation after S-NPP | Archive Download; `VIIRS_NOAA20_SP` / `_NRT` |
| **FIRMS VIIRS 375 m NOAA-21** | Recent NRT only (optional) | `VIIRS_NOAA21_NRT` |

**Get these today, first thing:**
1. FIRMS MAP_KEY (free): https://firms.modaps.eosdis.nasa.gov/api/map_key/ — limit 5,000 transactions / 10 min; each day in a request counts.
2. NASA Earthdata login (for archive download + Rekindle rasters).
3. FIRMS **yearly summaries by country** (https://firms.modaps.eosdis.nasa.gov/country/) — instant download, one zip per sensor per year containing one CSV per country. This is the fastest route to global coverage. Download all years for MODIS, VIIRS S-NPP, VIIRS NOAA-20 **onto the cluster, from the login node** (or its data-transfer node) into project/scratch space — compute nodes may have no internet.
4. The yearly files lag; for the most recent months (current year), submit an **Archive Download** request (global or by region, CSV) — results arrive by email, so submit early. Fill the last ≤ 10 days with the area API.

> Inspect the actual zip contents before writing the parser: file naming, sensor/satellite codes, and whether `type` is present can differ between SP and NRT and between years. Write a `pipeline/inspect.py` that prints columns, dtypes, value counts for `satellite`, `confidence`, `type`, `version` for one file of each sensor.

### Rekindle inputs (only for the demo domains)

| Dataset | Use |
|---|---|
| **NASADEM / SRTM GL1** (30 m) | Elevation → slope & aspect. Coverage 60°N–56°S. |
| **MODIS MCD12Q1** land cover (500 m, annual, IGBP) | Fuel model crosswalk |
| **MODIS MOD44W** water mask (250 m) | Non-burnable cells |
| **MERRA-2** (`M2T1NXSLV`, hourly, 0.5°×0.625°) `U10M`, `V10M`, `T2M`, `QV2M` | Wind (→ mid-flame), humidity (optional moisture estimate) |

Download via Earthdata (earthaccess python package works well). Clip to the demo domain only; store as GeoTIFF under `data/rekindle/<fire_id>/`.

### Optional (calibration strata)
- **MODIS MCD12C1** (0.05° land cover climate-modelling grid) → dominant IGBP class per 0.1° cell, for calibration strata.

## FIRMS columns (verified with inspect.py, 2026-11-14)

Two delivery formats, and they differ:

**A. Yearly country zips** (`data/raw/<SENSOR>/…_all_countries.zip`, SP only). Naming: `modis_<YYYY>_all_countries.zip`, `viirs-snpp_<YYYY>_all_countries.zip`, `viirs-jpss1_<YYYY>_all_countries.zip` (jpss1 = NOAA-20). Inside: a directory entry `<prefix>/<YYYY>/` plus one CSV per country, `<prefix>/<YYYY>/<prefix>_<YYYY>_<Country_Name>.csv` (165–227 members).
- MODIS: `latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence (0–100), version, bright_t31, frp, daynight, type`. `satellite` = `Terra`/`Aqua`, `instrument` = `MODIS`, `version` = `6.03` (2020).
- VIIRS: `latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite, instrument, confidence (l/n/h), version, bright_ti5, frp, daynight, type`. `satellite` = `N` (S-NPP) or `N20` (NOAA-20), `instrument` = `VIIRS`, `version` = `2`.

**B. Archive Download zips** (`DL_FIRE_<M-C61|SV-C2|J1V-C2>_<request>.zip`): `fire_archive_<…>.csv` (SP) + `fire_nrt_<…>.csv` (NRT) + `Readme.txt`.
- **All** files (MODIS and VIIRS) use the MODIS column names `brightness` and `bright_t31` — VIIRS has no `bright_ti4/ti5` here.
- S-NPP: `satellite` = `SNPP` **and `instrument` = `SNPP`** (not `VIIRS`). NOAA-20: `satellite` = `N20`, `instrument` = `VIIRS`.
- **NRT files have no `type` column.** NRT `version` = `6.1NRT` (MODIS) / `2.0NRT` (VIIRS). MODIS SP `version` = `6.03` through 2022, `61.03` from 2023.
- In the Argentina request, SP and NRT do **not** overlap: VIIRS SP ends 2026-07-31 and NRT starts 2026-08-01; MODIS SP ends 2026-08-31 and NRT starts 2026-09-01. S-NPP NRT ends 2026-11-02 (confirms `SNPP_END`). The SP/NRT dedupe is still applied.

Ingest maps satellite codes `Terra/T`, `Aqua/A`, `N/SNPP/NPP`, `N20/NOAA-20/J1`, `N21/NOAA-21/J2` and takes processing from `version` (`…NRT`) or the file name (`fire_nrt_`). Columns are read as text (`all_varchar`) and cast explicitly.

**Record starts (actual):** MODIS 2000-11-01 (not 11-11); S-NPP 2012-01-20; **NOAA-20 SP 2018-04-01** (not 2020-01-01).
**Global set on disk:** MODIS 2000–2025; S-NPP 2012–2025 **missing 2022**; NOAA-20 2018–2025 **missing 2024**. 2026 is only in the Argentina fixture so far.

`type`: 0 = presumed vegetation fire, 1 = active volcano, 2 = other static land source, 3 = offshore. `acq_time` is HHMM UTC; in these files it is always 4 characters when read as text, but DuckDB's auto-detection can read it as an integer and drop the leading zeros — we read text and zero-pad anyway.

Volumes (one year): MODIS 2020 4.4 M rows; S-NPP 2020 20.6 M; NOAA-20 2018 (Apr–Dec) 14.5 M. Argentina fixture: MODIS 1.74 M, S-NPP 2.98 M, NOAA-20 1.83 M rows (SP + NRT).

## Unified hotspot schema (`hotspots` table)

One row per cleaned detection. Common fields first; sensor-specific fields kept as nullable so nothing is lost.

| column | type | notes |
|---|---|---|
| `hid` | UBIGINT | stable hash of (sensor, lat, lon, acq_datetime) |
| `sensor` | VARCHAR | `MODIS_TERRA` / `MODIS_AQUA` / `VIIRS_SNPP` / `VIIRS_NOAA20` / `VIIRS_NOAA21` |
| `instrument` | VARCHAR | `MODIS` / `VIIRS` |
| `lat`, `lon` | DOUBLE | WGS84 |
| `acq_datetime` | TIMESTAMP | UTC, from acq_date + acq_time |
| `acq_date` | DATE | UTC |
| `daynight` | VARCHAR(1) | D/N |
| `frp` | DOUBLE | MW |
| `scan`, `track` | DOUBLE | pixel size km (along-scan, along-track) |
| `pixel_area_km2` | DOUBLE | scan × track |
| `conf_class` | VARCHAR | harmonized: `low`/`nominal`/`high` (MODIS: <30 low, 30–79 nominal, ≥80 high) |
| `conf_raw` | VARCHAR | original value |
| `type` | TINYINT | nullable |
| `processing` | VARCHAR | `SP` / `NRT` |
| `version` | VARCHAR | product version |
| `bt_mir_k` | DOUBLE | MODIS `brightness` (band 21/22) or VIIRS `bright_ti4` |
| `bt_tir_k` | DOUBLE | MODIS `bright_t31` or VIIRS `bright_ti5` |
| `cell01` | BIGINT | 0.01° cell id (counting grid) |
| `tile10` | VARCHAR | 10° tile id (partition key), e.g. `S30W070` |
| `year`, `month` | SMALLINT | partition / convenience |

Partitioned Parquet: `$DATA_DIR/interim/hotspots/instrument=*/year=*/tile10=*/<SENSOR>_<i>.parquet` (hive style, so DuckDB prunes on AOI bbox + years). `instrument`, `year` and `tile10` are partition keys (in the path, not in the files; read with `hive_partitioning=true`). Before it sits `interim/staging/sensor=*/year=*/` (normalized but uncleaned rows, plus a `source` column).

## Pipeline intermediates vs. web-facing artifacts

**Intermediates (cluster disk only, never hosted):**
- `hotspots/` — the unified table above (hive-partitioned Parquet).
- `fcd_daily/sensor_group=*/year=*/` — `cell01 (0.01° id), acq_date, sensor_group (MODIS | VIIRS_SNPP | VIIRS_NOAA20 | VIIRS_NOAA21), fcd (always 1), n_det, frp_sum`, i.e. one row per active (cell, day, sensor group). Summed into dekad cubes.

**Web-facing artifacts (hosted; formats in `CONTRACTS.md`):** `cube/l01/<tile>.bin.gz`, `cube/l10/global.bin.gz`, `points/<tile>/<year>.parquet`, `manifest.json`, `calibration.json`, `validation.json`. The calibration/validation files are small; the cubes are expected to be hundreds of MB at most (the manifest reports the real size); points may be several GB — see `ARCHITECTURE.md` → "Points & export".

## Grid ids

Defined once in `CONTRACTS.md` (L01 0.1° per 10° tile; L10 1° global; the 0.01° counting grid is `cell01 = floor((lat+90)*100) * 36000 + floor((lon+180)*100)`). Provide `cell_bounds()` and its inverse in `pipeline/grid.py` and port to `web/src/lib/grid.ts` with a shared golden test.

## Where to run what

| Step | Where | Notes |
|---|---|---|
| Downloads (FIRMS yearly zips, Archive Download results, MAP_KEY API loops) | **Cluster login node / DTN** | Compute nodes may have no internet. Use `tmux`/`nohup`; make scripts resumable. |
| Python env | Built **on the login node** | Try the cluster's wheelhouse (`pip install --no-index`, `avail_wheels duckdb`) first; otherwise `pip install` from the login node into a venv in project space, then use that venv inside jobs. |
| Ingest, clean, FCD, cubes, calibration, validation | **Cluster Slurm jobs** (job array over sensor × year) | Modest walltime (a few hours) and moderate cores/RAM tend to start sooner. Write few large files — cluster filesystems have file-count quotas. Keep results in project space; scratch is purged. |
| Fixture builds, dev loop | **Desktop** (16 GB RAM, GTX 1070 unused) | `DUCKDB_MEMORY_LIMIT=10GB`. Argentina-only fixtures: one month per sensor plus 2011–2013 slice. |
| Rekindle prep, grid runs | **Desktop** (or cluster array) | CPU-bound NumPy; ~200 runs of a ~400×400 grid. |
| Upload to the data host | `rclone` (S3-style buckets) or `huggingface-cli upload` from the **login node** if outbound HTTPS works there; else scp/Globus to the desktop and upload from there | Upload cubes + JSON first; points last. |

Global MODIS + VIIRS since 2000 is large (VIIRS dominates; plan for hundreds of millions of rows). Rules: stream (DuckDB `read_csv(..., union_by_name=true)` → `COPY ... (FORMAT parquet, PARTITION_BY ...)`), never materialize a year, keep raw zips until the pipeline is verified, log row counts and sizes at every stage.
