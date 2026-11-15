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
- 2026-11-15 — **Colour ramp changed to ColorBrewer YlOrRd** (palest class dropped), for both the calendar and the map. This **supersedes** the S2 "reversed inferno" decision. User feedback: its purple/black end read as "cold". Plain inferno would put the highest values in pale yellow, which nearly vanishes on the light basemap and white panel. YlOrRd = "redder is more"; it's in PRODUCT F2's options and has monotonic lightness. VIIRS S-NPP dots changed from vermillion to near-black so they don't blend into the red cells.
- 2026-11-15 — **Map density resolution follows zoom when no AOI is selected:** the 1° world cube below zoom 4; from zoom 4, the 0.1° tiles in view (only tiles in the manifest), if ≤ 16 — the same limit the calendar uses for L01. Otherwise it stays at 1°. With an AOI the map still shows the AOI's own cells. Risk: globally, 16 dense tiles at all-time could be ~100k+ polygons. If that's slow on the real data, lower the limit or render tiles as Mercator-corrected images.
- 2026-11-15 — **Points no longer need an AOI.** Without one, they load for the viewport from zoom 6 (padded 20 %, snapped to 0.5° so small pans reuse the query; the Worker caches opened files). They still need a window ≤ 1 year; the map panel offers a one-click "Show <latest year>".
- 2026-11-15 — **Points gating, cap and clustering (review feedback; supersedes the 150k cap, the 30k→zoom 5.5 gate and the zoom-6 viewport rule above).**
  - Individual hotspots show for a **single month at any zoom**, or a **single year from zoom 8**. Otherwise only density cells show. Point files are per year, so a year is always required.
  - Without an AOI the viewport may cover at most 9 point tiles.
  - The cap is **50,000 per view** (even sample; the note says "Showing a sample of 50,000 of N…").
  - The GeoJSON source is **clustered up to zoom 8** (count bubbles; click to zoom in), with individual dots from zoom 9. It was already a single MapLibre circle layer, not DOM markers.
  - Checked in headless Chrome: Argentina Aug 2025 → 17 clusters over 60,115 hotspots (sampled to 50k); zoom 9.5 → 543 dots; no AOI, 2026: zoom 7 → none, zoom 8.5 → clusters, zoom 10 → 672 dots.
- 2026-11-15 — **Legends say their scale is relative:** the map says "Scale: current view — colours aren't comparable across views"; the calendar says "scale: this area". Both colour scales adapt on purpose (P2…max of what's shown).

## Implementation decisions (S3, 2026-11-15)

- 2026-11-15 — **Calibration input = per-tile dekad sums from `fcd_daily`** (`interim/tile_dekad.parquet`: tile, series, dekad, FCD, detections). The FCD column equals the L01 cube sums (same source, exact), so the tile k is what the browser would fit from the cubes. The detection column feeds the "raw counts" LOYO baseline. — One small table serves calibrate and validate. — Track A only.
- 2026-11-15 — **Bootstrap = the web's.** Python ports mulberry32 bit for bit (checked against node) and draws year indices in the same order, so `calibration.json` bands and the AOI bands in the browser come from one rule. **This settles the S2 open question: no tolerance needed, golden carries the exact band.** The S2 percentile rule (mid-rank, complete years, current year excluded) is kept as is. The current `web/src/lib/harmonize.ts` already matches every golden case to 1e-9 (checked with a throwaway vitest, not committed). **No web change needed.**
- 2026-11-15 — **`calibration.json` details:** `null` where a month's denominator is 0. `n_modis` in the `n20` blocks holds the NOAA-20 FCD denominator, so the web's one threshold check works for both. Tiles with no overlap MODIS at all are left out. An extra `params` object. All in CONTRACTS.md.
- 2026-11-15 — **LOYO definitions:** pooled (series, month) points; MdAPE and bias only on months with obs ≥ 10. At tile level, a tile with < 200 other-year MODIS FCD in a month uses the global k (the web's fallback). `raw_counts` = a count ratio fitted the same way (the naive method). I also report `raw_counts_uncalibrated` (counts, k = 1), which is what splicing raw counts gives.
- 2026-11-15 — **Seam test** = step across 2012-02 (mean log1p of the 24 months after minus the 24 before), minus the MODIS-only step. `before` = raw spliced, `after` = harmonized. The window after includes overlap years used in the fit, so it isn't out of sample. **The hero AOI is too sparse for this test** (0.35 MODIS FCD/month before 2012, mostly zero months), so scopes with < 10 MODIS FCD/month are flagged `sparse`, and I added the hero's 10° tile as a third scope.
- 2026-11-15 — **Analytics rules written once** in `pipeline/analytics.py` (docstring, copied into `analytics_cases.json → rules`): linear quantiles; label by value vs the month's P25/P75/P90, checked in order (an all-zero history labels 0 "normal"); z with ddof 1, null if sd = 0; month-to-date ratio vs the median of the same dekads; critical period with ties going to the larger sum, then the earlier start; Theil–Sen + Mann–Kendall with tie correction and continuity correction, p via erfc (TS tolerance 1e-6).
- 2026-11-15 — **`build_all` steps `calibrate`, `validate`** (run after `manifest`), and **`--add --inputs …`** for incremental sources. Partial runs write `build_report_<steps>.json`, so they don't overwrite the full build report. `.gitattributes` keeps `*.sh` LF for the cluster.
- 2026-11-15 — **Data host = Hugging Face dataset** (ARCHITECTURE rule: mid-sized → HF). Cubes + JSON ~100–200 MB, points ≈ 7 GB, and the 1° global cube may pass 25 MiB, so it can't go inside Pages. One host for everything. Checked with curl on public HF dataset files, small (Git) and large (Xet/CDN): GET and HEAD with `Range: bytes=0-99` → 302/307 → 206 with `Content-Range`. CORS is on both hops (`allow-origin` echoes the origin, then `*` on the CDN). The preflight allows `range` on both hops. `Content-Length` and `ETag` are readable. **Not yet tested on our own upload** (the user deferred the HF login): `scripts/check_host.sh` re-runs all of this, plus "no Content-Encoding on .bin.gz", once data is up.

## Handoff — S3 (2026-11-15, ~02:00)

**Done**
- `pipeline/series.py` (tile and circle-AOI dekad series), `calibrate.py`, `harmonize.py` (port of the TS `harmonize` + `monthPercentile`), `validate.py`, `analytics.py`, `make_golden.py`. `build_all` has `calibrate`, `validate` and `--add`. 39 tests pass, ruff clean.
- `tests/golden/{time_cases,harmonize_cases,analytics_cases}.json` (5 harmonize cases covering every stratum — aoi, aoi-sparse, tile weighted, global, none — plus one real fixture case, Chilecito). The current TS matches them exactly.
- `build_all --fixture` runs end to end (~1 min) and writes `calibration.json` and `validation.json`. Headless Chrome on the dev server: no "Development data" banner, and `/dev-data` serves real manifest/calibration/validation.
- `scripts/sync_data.sh` (HF upload: points one commit per year, manifest last, with `manifest.points` matching what was uploaded) and `scripts/check_host.sh`.

**Real numbers — Argentina fixture** (its "global" is Argentina)
- Global k by month: **1.92 (Sep) … 2.58 (Mar)**. Bands are narrow, e.g. Aug 1.97 [1.91, 2.02], Apr 2.51 [2.39, 2.81]. Tile k (tile-months with ≥ 200 MODIS FCD, n = 60): p5 / p50 / p95 = **1.68 / 2.35 / 3.11**.
- **k_N20 = 0.88 … 1.03** (median ≈ 0.98; lowest in July). Close to 1, as expected.
- LOYO (r_log / MdAPE / bias_log):

  | level | calibrated FCD | FCD, k = 1 | count ratio | raw counts, k = 1 |
  |---|---|---|---|---|
  | global (1) | 0.994 / 6.2 % / −0.02 | 0.993 / 56.7 % / −0.83 | 0.996 / 6.6 % / +0.01 | 0.995 / 71.2 % / −1.25 |
  | tile (9) | 0.971 / 15.8 % / −0.24 | 0.978 / 59.9 % / −1.01 | 0.968 / 16.8 % / −0.21 | 0.980 / 72.4 % / −1.37 |
- Seam (raw spliced → harmonized, minus the MODIS-only step): **global 0.80 → −0.002**; tile S30W070 0.71 → 0.013; Chilecito 25 km 0.52 → 0.51 (`sparse`, not meaningful).
- Seasonality: median r = **0.89** (IQR 0.68–0.97) over 8 tiles.
- Sizes: cubes **2.4 MB**, points **85 MB** (241 files), calibration 12 kB, validation 20 kB.

**Global run (not finished at handoff)**
- Running locally since 22:53 into `D:\ember` (log: `D:\ember\build_stdout.txt`). At 01:22 it was cleaning S-NPP 2015, at ~10 min per VIIRS year. Then fcd, cubes, points, manifest. The S3 steps aren't in that run because it started on the old code.
- Size projection from the cleaned row counts so far: ≈ 470 M rows → **points ≈ 7 GB** (~15 B/row, ~10k files), cubes ~100–200 MB. Replace with `manifest.sizes_mb` once it exists.

**Next — in this order, when `build_stdout.txt` shows `report:`**
1. `uv run python -m pipeline.build_all --data-dir D:/ember --add --inputs data/raw/VIIRS_SNPP/viirs-snpp_2022_all_countries.zip data/raw/VIIRS_NOAA_20/viirs-jpss1_2024_all_countries.zip`. This also rebuilds cubes, points and manifest and runs calibrate + validate. Read the numbers from the log (k range, k_N20, LOYO, seam) into this file.
2. `hf auth login`, then `HF_DATASET_REPO=<user>/cf-ember-calendar-data scripts/sync_data.sh D:/ember` (it ends by running `check_host.sh`). Add `--no-points` to put cubes up first if time is short (that uploads a manifest with empty `points`).
3. In Pages, set `VITE_DATA_BASE_URL=https://huggingface.co/datasets/<user>/cf-ember-calendar-data/resolve/main`.
4. S4: TS golden tests (port the `fromSeries`/analytics cases), At-a-glance, export, methodology page from `validation.json`.

**Surprises**
- **The global run is missing S-NPP 2022 and NOAA-20 2024.** Both zips were copied into `data/raw` at 01:08, after the run's source list was made (22:53). The copy kept the original mtimes (22:30), so they look older than the run. Step 1 above adds them.
- **The global raw data ends 2025-12-31** (no 2026 files). The Chilecito July 2026 fire, the "Try: Chilecito (Jul 2026)" button and the `snpp_end` / NOAA-20-only era therefore have no global data. Only the Argentina fixture has 2026. When the requested 2026 files arrive, `--add` them. Otherwise point the hero button at a 2025 event, or note it in the UI.
- **On monthly sums, a detection-count ratio calibrates about as well as FCD + k** (fixture LOYO: 6.6 % vs 6.2 % MdAPE globally, 16.8 % vs 15.8 % per tile). Without calibration, both are far off: FCD is ~57 % off and raw counts ~71 %. FCD's advantages lie elsewhere: a unit that doesn't depend on pixel size, and sums that are exact across cells. The methodology page should show this honestly. Recheck on global data.
- Tile-level calibrated bias is negative (−0.24 on the fixture). In sparse tile-months MODIS sees nothing while VIIRS sees ≥ 10 FCD, and a ratio can't recover months MODIS missed. Say this under Limitations.
- `hf upload-large-folder` no longer exists in `hf` 2.x, so points go up one commit per year with `hf upload --include`.

## Addendum — S3 data host live (2026-11-15, ~02:20)

- 2026-11-15 — **Data host is live with the Argentina fixture:** `VITE_DATA_BASE_URL=https://huggingface.co/datasets/Incandescent-Turtle/cf-ember-calendar-data/resolve/main` (public dataset, 255 files: 241 points, 10 cubes, 3 JSON + .gitattributes). `scripts/check_host.sh` passes on our own files (L01 cube, L10 cube, a points Parquet): Range → 206 with Content-Range, CORS on GET, preflight allows Range on both hops, HEAD Content-Length, no Content-Encoding. A production build pointed at it (headless Chrome, `vite preview`) loads the manifest cross-origin (years 2000–2026, no errors). The global data will replace these files at the same URL.
- 2026-11-15 — `sync_data.sh` fix: my first edit to upload the manifest last never applied (a silent no-op replace), so the first sync sent the manifest with the cubes. No harm, because points went up first. Fixed and re-run; the manifest now goes up last with `points` matching what was uploaded.
- 2026-11-15 — **Deployed: https://cf-ember-calendar.pages.dev/** (Cloudflare Pages, Git integration on `main`, root `web`, `npm run build` → `dist`, env `VITE_DATA_BASE_URL` = the HF URL above, `NODE_VERSION=22`). Pushes to `main` deploy; other branches get preview URLs. Checked on the deployed URL in a fresh headless Chrome profile (CDP): `.mjs` MapLibre worker served as `application/javascript`, SPA routes fall back to `index.html`, world 1° density ready in ~1.2 s, "Try: Chilecito" → 0.1°, 18 cells, 274 ms, July 2026 points → 622 hotspots (same as localhost), no console errors, no failed requests. **The Sun 08:00 checkpoint (Argentina on a public URL from real data) is met.** Firefox not checked yet (S8 bug bash).
- 2026-11-15 — **When the global build finishes:** `--add` the two missing years (S3 handoff → Next, step 1), then `HF_DATASET_REPO=Incandescent-Turtle/cf-ember-calendar-data scripts/sync_data.sh D:/ember`. The URL stays the same, so no Pages rebuild is needed. Files that exist only in the fixture upload would linger, but every fixture tile is also a global tile, so all of them get overwritten.
- 2026-11-15 — **2026 requested** (FIRMS Archive Download, world, 2026-01-01 → 2026-11-15; MODIS C6.1, VIIRS S-NPP, VIIRS NOAA-20). The 2025 country files run to 2025-12-31 for all four sensors (SP only), so this closes the gap exactly. Expected coverage, judging from the Argentina 2026 files: SP to Aug 31 (MODIS) / Jul 31 (VIIRS), NRT after that to Nov 14 (S-NPP to Nov 2). When the zips arrive, put them in `data/raw/` and pass them to `build_all --add` (with or after the two missing years), then `sync_data.sh`. Until then, keep the fixture on the host. The global upload has no 2026, so it would empty the Chilecito hero view.
