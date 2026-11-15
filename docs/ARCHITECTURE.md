# ARCHITECTURE.md

## Principle: compute offline, serve static

There is **no application server and no API.** Everything heavy runs offline on machines you control; the results are static files; the browser does the rest.

Why:
1. **Judging happens after the weekend, for days.** A static site can't sleep, crash, or run out of free-tier hours. A free-tier API can and will.
2. Your compute is an **Alliance cluster** (batch jobs, no always-on service) plus a **desktop** (GTX 1070, 16 GB RAM). Neither can host a live service.
3. Cost: free.

## Where things run

| Piece | Runs on | Produces | Lives at |
|---|---|---|---|
| Global data pipeline: ingest → clean → fire-cell-days → cubes → calibration → validation | **Alliance cluster** (login node for downloads, Slurm jobs for processing) | cube files, points files, `calibration.json`, `validation.json`, `manifest.json` | **Data host**, one of: Hugging Face dataset (default), inside Pages (if small), R2, GCS bucket |
| Dev loop on fixtures; Rekindle development; Rekindle scenario grids | **Desktop** (solver is CPU-bound; the GTX 1070 is not needed) — or a cluster job array | `web/public/rekindle/**` | **shipped inside the SPA** |
| Web app (React) | the visitor's browser | — | **Cloudflare Pages** (fallback: GitHub Pages / Vercel) |
| Code + docs | GitHub, public | — | `Incandescent-Turtle/cf-ember-calendar` |

```
 Alliance cluster ──upload──▶ data host ────────────┐  /manifest.json /calibration.json /validation.json
   (pipeline)                 /cube/l01/<tile>.bin.gz │  /cube/l10/global.bin.gz
                              /points/<tile>/<yr>.parquet
 Desktop / cluster ──git──▶ web/public/rekindle/** ──┐│
                                                     ▼▼
                                  Cloudflare Pages (SPA + Rekindle outputs)
                                                     │
 Visitor's browser ◀─────────────────────────────────┘
   fetch tiles for the AOI → decode in a Web Worker → sum cells → harmonize → analytics → draw
```

Limits (checked Nov 2026; recheck if something fails):
- Cloudflare Pages: 25 MiB per file, 20,000 files per site → fine for the SPA + Rekindle outputs (tens of MB, hundreds of files). **Not** for the cubes/points.
- If using R2: free tier is 10 GB storage, 1M writes/mo, 10M reads/mo, free egress. Each HTTP GET/Range request is one read. Cubes are expected to be well under 10 GB; **points files may not be** — the pipeline prints total size; if over, see "Points & export".
- R2's built-in `*.r2.dev` URL is for development and rate-limited; production needs a custom domain. **The data base URL is one env var (`VITE_DATA_BASE_URL`), so switching hosts is a rebuild, not a rewrite.**

## Repo layout

```
cf-ember-calendar/
  CLAUDE.md  README.md  .env.example  pyproject.toml
  docs/
  pipeline/    # inspect.py ingest.py clean.py grid.py fcd.py cubes.py calibrate.py harmonize.py
               # validate.py points.py nrt_snapshot.py build_all.py config.py
  rekindle/    # see REKINDLE.md (+ scenario_grid.py, export.py)
  web/         # vite app; src/{data,calendar,map,panels,rekindle,methodology,lib}
               # public/rekindle/**   (generated; committed — small)
  tests/       # fixtures/, golden/, pipeline/, rekindle/
  scripts/     # slurm/*.sh  fetch_firms.sh  sync_data.sh
  data/        # gitignored
```

## The browser data layer (the heart of the app)

Spec of every file format: **CONTRACTS.md**. Flow for any AOI:

1. **AOI → geometry** (turf): draw / bbox / point + radius / country polygon (ship a simplified Natural Earth countries file, ≲ 1 MB).
2. **Pick resolution:** list the 10° tiles the AOI's bbox touches. If ≤ 16 tiles → **L01** (0.1° cells, per-tile files). Otherwise → **L10** (1° cells, one global file). Show the level used in the UI ("resolution: 0.1°").
3. **Fetch** the needed cube files (`fetch` + gunzip via `DecompressionStream` or `fflate`), in a **Web Worker**; keep decoded tiles in an in-memory LRU.
4. **Aggregate:** keep cells whose **centre** is inside the AOI; sum counts per (series, dekad). Result: three time series (MODIS, VIIRS S-NPP, VIIRS NOAA-20) per dekad.
5. **Calibrate:** AOI-specific k from the overlap-era sums if the AOI has ≥ `min_modis_fcd` MODIS FCD in that calendar month; otherwise the tile k from `calibration.json`; otherwise global k. Record which was used.
6. **Harmonize + analytics** (TypeScript, see HARMONIZATION.md): monthly series with bands, percentiles, z-scores, month-to-date, critical period, trend.
7. **Draw** (ECharts) and **export** (Blob download).

Targets: a Chilecito-sized AOI in < 2 s on broadband; Argentina in < 6 s; world (L10) in < 4 s. Pre-warm nothing — there is no server.

Known approximations (state them in the methodology page): cell-centre membership; coarse resolution for very large AOIs; FCD counts are summed over 0.01° cells *within* each coarse cell, so aggregation is exact at the coarse level but edge cells are included or excluded whole.

**Two implementations of `harmonize` + analytics** exist (Python in `pipeline/` for validation; TypeScript in `web/src/lib/`). They must agree: `tests/golden/*.json` holds input/expected-output cases generated by Python; the TS tests consume them. A change to either implementation means regenerating the golden files.

## Points & export (raw hotspots)

- `points/<tile>/<year>.parquet`, sorted by latitude, row groups ≈ 100k rows, so a reader can skip row groups outside the AOI (CONTRACTS.md).
- The browser fetches only the (tile × year) files the AOI and date range need, filters to the polygon, and writes a CSV Blob. Reader: `hyparquet` (pure JS, small) or DuckDB-WASM — **time-box a 30-minute spike, pick whichever works, keep the fallback below.**
- **Caps:** if the request would fetch more than ≈ 200 MB or yield more than ≈ 3M rows, don't try. Show "too large for in-browser export" and deep-link to the **FIRMS Archive Download** page (official source, full resolution).
- **If total points size exceeds the chosen host's free tier:** options in order — (1) move points to the Hugging Face dataset repo or a GCS bucket, (2) keep points only for the most recent N years and link FIRMS for older, (3) pay the few cents of overage if the host bills per GB-month (check the current rate card). Decide when the pipeline reports the real size.
- The map shows individual points only when the window is ≤ 1 year and zoom is high; otherwise it draws the L10/L01 density from the cubes.

## Recent data

`web/public/recent.json` is a **build-time snapshot** of the last ≤ 10 days (FIRMS area API, NOAA-20/21 NRT), created by `pipeline/nrt_snapshot.py` on the login node (it needs `FIRMS_MAP_KEY`, which never goes to the browser). Take it Sunday afternoon; mark those dekads "provisional" in the UI. No live fetching.

## Rekindle outputs (static)

Precomputed on the desktop/cluster, exported to `web/public/rekindle/` (CONTRACTS.md). The browser loads `meta.json` + `observed.geojson` + the one `runs/<key>.u16.gz` that matches the slider positions (sliders snap to the precomputed grid), draws it as a MapLibre image source, and derives isochrones with `d3-contour`. No solver runs in production.

## Deployment (do the hello-world in hour one)

1. **Choose the data host** (decide when the pipeline's size report exists; until then use Hugging Face or the Pages deploy for the smoke test):
   - total data (cubes + points) fits Pages limits (≤ 25 MiB/file, ≤ 20,000 files): ship it **inside Pages**, no separate host;
   - mid-sized: **Hugging Face dataset repo** (free, large files, CORS-enabled; account only);
   - large or you want an S3-style bucket: **Google Cloud Storage** (Space Apps perk; needs billing/credits) or **R2** (may require a payment card even on free tier).
   Whatever it is, it must serve CORS (`GET, HEAD`, header `Range`, expose `Content-Length, Content-Range, ETag`) and `Range` requests. For a bucket, set that CORS config.
2. Create the **Pages** project from the GitHub repo (build: `npm run build`, output `web/dist`, env `VITE_DATA_BASE_URL=https://<bucket-url>`).
3. **Smoke test now:** upload one small test file to the chosen data host; have a throwaway page on Pages fetch it with `Range: bytes=0-99`. If that works, the whole deployment path works. If CORS fails, you learned it in minute 20, not Sunday night.
4. Upload data (`rclone` for S3-style buckets, `huggingface-cli upload` for HF) from the cluster login node — login nodes have internet; compute nodes may not. If outbound is blocked on your cluster, pull the files to the desktop (scp/Globus) and upload from there.
5. Optional polish: point the free GoDaddy domain (Space Apps perk) at the Pages site, only after everything else works.
6. Repo must be **public** before submission.

## Config

`.env.example`:
```
# pipeline
FIRMS_MAP_KEY=
EARTHDATA_USERNAME=
EARTHDATA_PASSWORD=
DATA_DIR=./data
MODIS_MIN_CONF=30
VIIRS_KEEP_CONF=n,h
CAL_START=2013-01-01
CAL_END=2021-12-31
CAL_MIN_MODIS_FCD=200
SNPP_END=2026-11-02
DUCKDB_MEMORY_LIMIT=10GB     # desktop has 16 GB; raise on the cluster
# web (build-time)
VITE_DATA_BASE_URL=
```

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cluster queue is slow Saturday night | Request modest walltime (a few hours) and moderate cores/RAM — such jobs usually backfill sooner. Do the Argentina fixture build on the desktop first so the web track is never blocked. |
| Compute nodes have no internet | Downloads run as login-node scripts (`scripts/fetch_firms.sh`), processing as Slurm jobs reading local disk. |
| File-count quotas on cluster filesystems | The pipeline writes few, large files (per tile-year or per sensor-year), never millions of small ones. |
| Data host CORS / throttling | Hello-world test in hour one; host is swappable via one env var; Hugging Face default. |
| Browser memory/time for big AOIs | L10 fallback by tile count; Web Worker; progress indicator. |
| Points too big for the free tier | See "Points & export". |
