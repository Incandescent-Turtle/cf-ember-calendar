# DECISIONS.md — deviations, discrepancies, handoffs

Format: date — what — why — who is affected.

## Discrepancies found in the data (S1, 2026-11-14)

- 2026-11-14 — **NOAA-20 SP starts 2018-04-01**, not 2020-01-01 (country zips and Archive Download agree). — Seen with `pipeline.inspect`. — Track A (the `k_N20` fit window can start earlier than 2020-06 if wanted; left at 2020-06 for now), DATA.md updated.
- 2026-11-14 — **MODIS starts 2000-11-01**, not 2000-11-11. So the first dekad is `t = 30`, not 31. — Data. — CONTRACTS.md `manifest.dekad_range` example note updated; the web track must read `dekad_range` from the manifest, never hard-code it.
- 2026-11-14 — Archive Download VIIRS files use `brightness`/`bright_t31` (not `bright_ti4`/`bright_ti5`); S-NPP Archive Download has `instrument = SNPP`; NRT files have no `type` column. — Data. — Ingest handles both name sets; DATA.md updated.
- 2026-11-14 — Global set on disk lacks S-NPP 2022 and NOAA-20 2024. — Download gap. — Must be fetched before the global build, or 2022 will be MODIS/NOAA-20 only (S-NPP 2022 lies outside the 2013–2021 fit window, but it is inside the harmonized VIIRS era).
- 2026-11-14 — The Argentina fixtures are full Argentina 2000→2026-11-14 (≈ 6.5 M rows, ~530 MB CSV), not "one month per sensor". — It is what was downloaded; a fixture build takes about a minute, which is fine. Unit tests use tiny synthetic CSVs instead.
- 2026-11-14 — Chilecito cluster confirmed: 2026-07-27 → 08-01, lat −29.05…−29.24, lon −67.62…−67.78, peak Jul 28 (167 NOAA-20, 78 S-NPP, 19 MODIS detections). VIIRS SP ends Jul 31, so Aug 1 is NRT only. — Track C (prep.py).

## Implementation decisions (S1, 2026-11-14)

- 2026-11-14 — **Grid ids come from integer 0.01° indices with a 1e-9 epsilon** (`floor((lat+90)*100 + 1e-9)`); tiles, L01 and L10 ids are integer divisions of those, so every grid nests exactly. — Without the epsilon, `-29.51` falls into the cell below through float error. — Track B: a TS port that bins coordinates must use the same rule (written into CONTRACTS.md → Grids). AOI membership by cell centre is unaffected.
- 2026-11-14 — **Extra intermediate `interim/staging/sensor=*/year=*`** (normalized, uncleaned rows). Layout under `DATA_DIR`: `interim/{staging,hotspots,fcd_daily,logs}` and `processed/{cube,points,manifest.json}`. — The per-rule counts per sensor-year need a stable "before" table, and it is the natural unit for a Slurm array. — Track A only. DATA.md updated.
- 2026-11-14 — **Zip handling:** each zip's CSV members are extracted to a temp dir (`EMBER_TMP_DIR` or system temp), read by DuckDB and deleted when that source is done. Nothing is unzipped permanently. Peak temp = one zip uncompressed (≈ 1.5 GB for a VIIRS year). — DuckDB can't read zip members without the community `zipfs` extension, which would need internet on compute nodes. — Cluster: point `EMBER_TMP_DIR` at node-local disk/`$SLURM_TMPDIR`.
- 2026-11-14 — **Static-source mask** = 0.01° cells with SP `type ∈ {1,2}` (any year), plus cells detected on > 50% of an instrument's data days in a year (only if that year has ≥ 30 data days), dilated to 3×3 cells (≈ 1–2 km, the "within 1 km" rule approximated on the grid). Applied only to rows with no `type` (NRT). — Simple, grid-native. — Fixture: removes ~4–5% of NRT rows, which matches the type-2 share in SP.
- 2026-11-14 — **Exact-duplicate tie-break:** one row per (sensor, lat, lon, acq_datetime), keeping SP over NRT, then the higher `version`. Country files duplicate border detections, so this rule matters globally (fixture: 2 rows).
- 2026-11-14 — **VIIRS confidence** compared on the first letter, lower-cased (`l`/`n`/`h`), so `low`/`nominal`/`high` spellings would also work. MODIS uses an integer cast.
- 2026-11-14 — **`manifest.row_counts`** = cleaned detections per series group (MODIS = Terra + Aqua). The per-rule counts per sensor-year are in `interim/logs/clean_counts.csv`; the full build report is in `interim/logs/build_report.json` (not hosted).
- 2026-11-14 — **Cubes:** zero values dropped, entries > 65535 saturate and are counted in the report (fixture max: 2033 at L10). The build fails if the sums of the L01 and L10 cubes ≠ the `fcd_daily` row count per series (exactness check). Gzip is deterministic (no name, mtime 0).
- 2026-11-14 — **Points** sorted by `(lat, lon, t_utc)`; `daynight`/`conf` = 255 if missing (the contract only lists 0/1 and 0–2).
- 2026-11-14 — **Tooling:** `uv` wasn't installed; installed with `py -3.12 -m pip install uv` (it lives in `…\Python312\Scripts`, which isn't on PATH in Git Bash). Deps: duckdb 2.0, polars, pyarrow, numpy; dev: pytest, ruff.

## Handoff — S1 (2026-11-14, 22:30)

**Done**
- `pipeline/`: `config`, `sources` (zip/CSV discovery, temp extraction), `inspect`, `ingest`, `clean`, `grid` (+ SQL twins), `fcd`, `cubes` (writer/reader/builder), `points`, `build_all` (`--fixture`, `--data-dir`, `--inputs`, `--steps`). 28 tests pass (`uv run pytest -q`), ruff clean.
- `uv run python -m pipeline.build_all --fixture` → `data/processed/` in ≈ 50 s: 9 L01 tiles, **cubes 2.4 MB**, **points 85 MB** (241 files, 5.81 M rows), dekads 30…967. Cleaned rows: MODIS 1,588,588 (91% of raw), S-NPP 2,625,356 (88%), NOAA-20 1,597,517 (87%). The biggest losses are confidence (~8–10% for VIIRS) and type (~3–5%).
- Sanity: over 2013–2021 in Argentina, S-NPP FCD / MODIS FCD = **2.11** (ratio of sums); the Chilecito cells show the Jul 21–31 2026 dekad clearly (MODIS 29, S-NPP 98, NOAA-20 127 FCD).

**Next**
- S2 (web): point the mock/dev data at `data/processed/` (the cube format is final; `dekad_range` starts at 30, read it from the manifest).
- Before the global run: download **S-NPP 2022** and **NOAA-20 2024**; write `scripts/slurm/*.sh` (not done, per instructions). `build_all` runs all steps in one process. For a job array, call `ingest.ingest_source` per zip and `clean.clean_partition` per (sensor, year) (`clean_all(only=…)` exists), with `build_static_mask` as one job between them, then `fcd_year` per year, then cubes + points + manifest as one job. Add CLI flags for those when writing the Slurm scripts.
- S3: `calibrate`, `harmonize`, `validate`, `make_golden` read `fcd_daily/` or the cubes.

**Surprises**
- The data differs from the docs in five ways: NOAA-20 starts 2018-04, MODIS starts 2000-11-01, Archive Download VIIRS uses MODIS column names, S-NPP has `instrument=SNPP`, and NRT has no `type`.
- **Points will be large globally.** About 15 bytes per row. A guess from per-year volumes (MODIS ~4 M/yr, S-NPP ~18 M/yr, NOAA-20 ~15 M/yr after cleaning) is ~450–500 M rows, i.e. **≈ 6–8 GB**, plus ~10k files. Not Pages; use the HF dataset, or keep recent years only. Decide in S3 when the real manifest exists. Cubes should be ~100–200 MB globally.
- Global in-memory peak per clean partition = one VIIRS year (~20 M rows) as a DuckDB temp table; it spills to `interim/duckdb_tmp`. That's fine at 10 GB, but on the cluster give it ≥ 16 GB and local scratch.

## Implementation decisions (S2, 2026-11-14)

- 2026-11-14 — **Dev data = Vite middleware at `/dev-data`** (dev server only; `apply: 'serve'`, not in the build). Serves `EMBER_DEV_DATA_DIR` (default `data/processed`) first, then `web/mock-data/`. So the fixture cubes are used as soon as they exist, and files the pipeline hasn't written yet (`calibration.json`, `validation.json` before S3) come from the mock. `VITE_DATA_BASE_URL` defaults to `/dev-data`. — No copying of data into `public/`. — Web track; S3/S4 just set `VITE_DATA_BASE_URL`.
- 2026-11-14 — **Mock files carry `"mock": true`** (manifest/calibration/validation). It's an extra optional field, not a contract change; the UI shows a yellow "Development data" banner when it sees it. The pipeline never writes it.
- 2026-11-14 — **`calibration.json` is optional in the client.** Missing → AOI-specific k only; months below `min_modis_fcd` then use the AOI ratio flagged `aoi-sparse` (tooltip says so). With the file: AOI → tile → global, as in ARCHITECTURE.md step 5.
- 2026-11-14 — **Multi-tile AOIs, tile stratum:** k = MODIS-FCD-weighted mean of the tile ks (weights = the AOI's own overlap-era MODIS FCD per tile and month), using only tiles with `n_modis[m] ≥ min_modis_fcd` (or no `n_modis`). Equal weights if the AOI has no overlap MODIS FCD. The Worker returns sums **per 10° tile** (L10 too, by mapping each 1° cell to its tile) to make this possible.
- 2026-11-14 — **AOI k band** = year bootstrap (200 resamples, seeded mulberry32 per month), 5th/95th percentiles, linear interpolation. Not checked against Python yet: S4 must make `make_golden` and TS agree (seeding will differ — compare k exactly and the band with a tolerance, or have golden carry the band).
- 2026-11-14 — **NOAA-20 k (AOI)** = S-NPP/NOAA-20 ratio of sums over 2020-06-01 … min(2026-10-31, the dekad before `snpp_end`), same threshold applied to NOAA-20 FCD. The dekad containing `snpp_end` (Nov 1–10 2026) is NOAA-20 era.
- 2026-11-14 — **Raw views:** "VIIRS raw" = S-NPP before the switch dekad, NOAA-20 after (uncalibrated). "Side-by-side" = **raw spliced at 2012-02** (MODIS before, VIIRS after) next to harmonized, same colour scale. That shows the seam better than MODIS-only vs VIIRS-only. PRODUCT.md F2 doesn't define side-by-side precisely; this is my reading.
- 2026-11-14 — **Percentile (tooltip)** = mid-rank among the same calendar month in complete years (3 dekads observed), excluding the current year. Provisional until the S4 analytics + golden.
- 2026-11-14 — **Colour:** reversed inferno without its black end (light = low, dark = high), log10(1+FCD). The scale starts at the 2nd percentile of the shown non-zero months (rounded down to 0.5 decades), otherwise country-size AOIs render almost all dark. Zero months use a separate neutral grey series; months outside the record are blank; partial months have a dashed border. Inferno has monotonic lightness, so it reads under CVD. **A formal CVD simulation hasn't been run yet** (Track B done-criteria).
- 2026-11-14 — **Tile selection uses the union of tiles per polygon part**, not the overall bbox. Otherwise Chile (Easter Island) fell back to 1°. Membership is still by cell centre.
- 2026-11-14 — **Countries:** Natural Earth 1:50m admin-0 (public domain), Douglas–Peucker 0.02°, 0.01° rounding → `web/public/countries.geojson` (0.77 MB, 242 features), built by `web/scripts/make_countries.ts`.
- 2026-11-14 — **Basemap:** CARTO Positron GL style (no key), overridable with `VITE_BASEMAP_STYLE_URL`. In the headless run the browser's network hosts were only localhost and `*.basemaps.cartocdn.com`.
- 2026-11-14 — **Linter is oxlint** (the Vite template default), not ESLint as CLAUDE.md says. It's fast and clean; swap it if ESLint-specific rules are needed. `npm run lint` passes with 0 warnings.
- 2026-11-14 — **Root `.gitignore`: `data/` → `/data/`.** The unanchored pattern also ignored `web/src/data/`. `tests/fixtures/` is ignored too, so the web's pipeline-generated decoder fixture lives in `web/test-fixtures/` (68-byte cube + `pipeline_cases.json` with dekad/grid cases from `pipeline/grid.py`).

## Handoff — S2 (2026-11-15, ~00:30)

**Done**
- `web/`: Vite 8 + React 19 + TS (strict), MapLibre 6, ECharts 6 (tree-shaken core), Zustand, TanStack Query, turf, Terra Draw, fflate.
- Data layer: `src/data/cube.ts` (decoder + encoder; uses `DecompressionStream`, falls back to fflate, and accepts bytes that are already gunzipped in case a host sets `Content-Encoding`), `cube.worker.ts` (fetch → decode → LRU of 24 → cell-centre mask → per-tile, per-dekad sums), `aggregate.ts`, `client.ts`, `hooks.ts`. `src/lib/time.ts` and `grid.ts` are twins of `pipeline/grid.py`; `src/lib/harmonize.ts` covers strata, eras, bands and the percentile.
- UI: AOI tools (rectangle, polygon, point + radius, country picker, the "Try: Chilecito" hero button, area in km²), calendar with Harmonized / MODIS raw / VIIRS raw / Side-by-side, marginal bars (per-year total, per-month median), traceable tooltips (harmonized + band, raw MODIS/S-NPP/NOAA-20, k + band + stratum detail, percentile), click-to-select a month (stored; not yet wired to the map), log legend, accessible table toggle, plain-language captions, unit tooltip.
- `scripts/make_mock_data.ts` (`npm run mock`) writes contract-format mock cubes/JSON.
- Checks: `npm test` 13/13 (decoder vs a pipeline-written cube, every fixture tile decodes sorted, dekad/grid cases vs Python, harmonize/aggregate units). `npm run build` passes. `npm run lint` is clean.
- Headless Chrome at 1280 px against the fixture cubes: a rectangle drawn over Argentina gives the calendar in ~1.3 s (Worker ~0.8 s, 9 tiles, L01, 66k cells). Argentina from the country picker ~0.8–1.3 s; Chilecito 25 km 2–5 ms; Brazil → L10 ~0.2–0.5 s; Chile → L01 with 7 tiles. No page errors. At 420 px the layout stacks with no horizontal scroll. On fixture data the raw spliced view shows the 2012 step and the harmonized one doesn't.

**Next (S3/S4)**
- S3: `calibration.json` / `validation.json` / golden files. Once they exist in `data/processed`, the dev middleware stops using the mock ones automatically.
- S4: TS analytics against `tests/golden/*.json` (also port the k-band/percentile rules above, or change them to match Python). At-a-glance panel, export (calendar CSV columns are in PRODUCT F5; everything needed is in `MonthRow`), methodology page, deploy with the real `VITE_DATA_BASE_URL`, test the deployed URL.
- Map layers (F4): L10 density for the world view, and month-selection → points. `selected` is already in the store.
- Bundle: the main chunk is 2.0 MB (585 kB gzip; MapLibre + ECharts + turf). Split with `manualChunks` or lazy-load ECharts if first load matters.
- CVD simulation of the ramp (see above); dekad-of-year sub-view (optional).

**Surprises**
- **MapLibre 6 resolves its worker as `./maplibre-gl-worker.mjs` next to its own module URL.** That breaks both under Vite's dev pre-bundling and in the production bundle ("Worker failed to load"; the basemap draws nothing). Fix in `MapView.tsx`: import `maplibre-gl/dist/maplibre-gl-worker.mjs?url` (it's self-contained) and call `setWorkerUrl`. Verified in dev and with `vite preview` of `dist/` (worker asset loads, tiles render). **Still check this on the deployed Pages URL** (`.mjs` must be served as JavaScript).
- MapLibre's CSS sets `.maplibregl-map { position: relative }`, which overrode the map container's absolute fill (the map was 0 px tall).
- ECharts: every cartesian heatmap series needs a visualMap, and a continuous visualMap **clamps** out-of-range values rather than using `outOfRange`. So zeros get their own series with a single-colour piecewise visualMap.
- The cell-centre point-in-polygon for country polygons (~120k cells × ~1k vertices) costs ~0.5–1 s of the Argentina time. That's fine for the < 6 s target. If it isn't on slower machines, rasterize the polygon per tile or pre-filter by part bbox.

## Addendum — S2 map layers (2026-11-15)

The S2 header (Track B item 4) included map layers, but the first S2 pass left them out. They're done now. At-a-glance and export are tracked in the S4 checklist in BUILD_PLAN.md; satellite basemap / bundle split are S7 optional.

- 2026-11-15 — **Shared time window.** The store has `window = {year|null, month|null}`. A calendar cell click sets `{year, month}` and clicking it again resets. The map's Year/Month selects edit the same state. `{null, 6}` = every July (seasonality).
- 2026-11-15 — **Density layer = per-cell harmonized FCD in the window**, with the calendar's eras applied cell by cell (`web/src/data/density.ts`). Inside an AOI it uses **the calendar's own k**, so map and calendar agree, and only the AOI's cells (same mask). With no AOI it shows the world at 1° with `calibration.json` global k; if the file is missing, the Worker fits a global ratio-of-sums k from the 1° cube (same definition as the global stratum). Cells are GeoJSON squares (exact on the grid; an image source would be off by ~1 row at mid-latitudes in Mercator). Colour = calendar ramp over P2…max of log10(1+FCD) per window.
- 2026-11-15 — **Points:** `hyparquet` + `hyparquet-compressors` (the files are zstd, which core hyparquet can't read). Only row groups whose `lat` statistics overlap the AOI bbox are read (byte ranges via `Range`). Membership = the same cell-centre mask as the calendar, so the dots are exactly the detections in the counted cells. Shown only with an AOI and a window ≤ 1 year (F4). Capped at 150k drawn (even subsample, with the total stated). Above 30k, the dots appear from zoom 5.5, because tiling 150k points takes MapLibre 2–4 s in headless Chrome and at country zoom the dots form a solid mass that hides the density. Colours are Okabe–Ito by sensor group; click a dot for sensor, UTC time, FRP and confidence.
- 2026-11-15 — **Dev middleware now supports `HEAD` and `Range` (206/416)**, like a real host; hyparquet needs both.
- 2026-11-15 — **Fixture facts:** points row groups are 100,352 rows (pyarrow's choice), not exactly 100k; hyparquet returns `num_rows` as BigInt. Argentina 2025 = 338,761 cleaned detections in the AOI; Chilecito Jul 2026 = 622.
- 2026-11-15 — **Narrow screens:** the map is 58vh and the overlays are compacted (legend notes and sensor key hidden), so the map isn't covered.
- Bundle: the Worker grew to 192 kB (hyparquet + zstd); the main chunk is unchanged at ~2.0 MB.
