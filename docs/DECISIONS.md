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

## Implementation decisions (S4, 2026-11-15)

- 2026-11-15 — **Golden tests: TS and Python agree on every case; neither side was wrong, nothing regenerated.** `web/src/lib/golden.test.ts` reads `../tests/golden/*.json`: time (dekad index/range), all 5 harmonize cases (k/lo/hi/stratum, every row field, percentile; tolerance from the file) and every analytics section, including `fromSeries` (trend p at 1e-6 abs). A mutation check (critical share 0.6 → 0.61) makes two tests fail, so the comparisons work. `pipeline/` untouched.
- 2026-11-15 — **`web/src/lib/analytics.ts`** = port of `pipeline/analytics.py`. TS has no `erfc`, so it uses the Numerical Recipes Chebyshev fit (fractional error < 1.2e-7, inside the 1e-6 golden tolerance). Critical period in TS is camelCase (`startMonth`); the test maps golden's `start_month`. `summarize(h, currentYear)` = the golden `fromSeries` recipe: climatology over full months of every year except the current one, baseline = complete years except the current one.
- 2026-11-15 — **`harmonize()` gained `t0` + `dekadal`** (harmonized FCD per dekad) for month-to-date. Existing outputs unchanged; golden still passes, and a test checks that the dekads sum to the monthly rows.
- 2026-11-15 — **Month-to-date drops a dekad that was still in progress at build time.** The manifest has no "data end" date, but `built_at` < the last dekad's end means that dekad holds only a few days (fixture: data to Nov 14, dekad Nov 11–20, build Nov 15). Comparing 4 days with full 10-day dekads would bias towards "below normal". So MTD uses the dekads up to the last complete one (fixture: Nov 1–10, 1 dekad), and the panel says so. Baseline = complete years other than the assessed year. **Suggestion for the pipeline (not done; pipeline was off limits):** a `manifest.data_end` date would let the client use the exact day.
- 2026-11-15 — **At-a-glance:** above the calendar, in the Calendar tab. Each number has a `title` tooltip with its source (raw MODIS/S-NPP/NOAA-20, k + stratum, baseline years and quantiles, Mann–Kendall S/z/p). "Busiest months of the year" = top 3 monthly medians, **leaving out months with a median of 0** (otherwise sparse areas listed "Jan median 0"). "Busiest month on record" = largest full month, current year included. Trend wording: p < 0.05 → "statistically significant increase/decrease", otherwise "no clear trend". Label chips: blue / grey / YlOrRd yellow / dark red, always with text. CVD (Machado 2009, full severity, CIELAB ΔE): chips min ΔE 17.7 (Below vs Normal, protan) after strengthening the blue (it was 7.7); seam lines min ΔE 49.6.
- 2026-11-15 — **Calendar CSV = PRODUCT F5 columns, then extras** (`k_lo,k_hi,snpp_fcd,n20_fcd,era,partial,n_dekads,k_source`). ASCII only (°, –, → transliterated), so Excel opens it without a BOM. `month` 1–12. In the S-NPP era `k = 1`, `k_stratum = reference`. Percentile is empty for partial months. A test rebuilds the July climatology median from the CSV alone. **Summary JSON** carries the month-to-date inputs (dekad values), because MTD can't be rebuilt from the monthly CSV. Both are in CONTRACTS.md → Browser exports.
- 2026-11-15 — **Calendar PNG** = ECharts `getDataURL` at 2×, drawn onto a canvas with title, subtitle, legend (zero swatch + log ramp + end values) and a source line, wrapped, width ≥ 1100 px. `calendar/png.ts` holds the live chart handle (Calendar registers it).
- 2026-11-15 — **Hotspot CSV done in S4 (it was allowed to slip to S7).** Worker request `hotspotCsv`: pass 1 reads only the Parquet footers and adds up the compressed size of the row groups overlapping the AOI's latitude band. Above 200 MiB it stops before downloading any data. Pass 2 reads one year at a time, filters with the calendar's cell-centre mask, sorts by time and stops above 3 M rows. Either cap → message + link to FIRMS Archive Download. The year range defaults to the calendar's selected year (the component is keyed by AOI + selected year). Measured: Chilecito 2026 = 668 rows in ~0.9 s from HF. **Argentina 2001–2025 hits the row cap after ~16 s.** Its ≈ 85 MB is under the byte cap, so the rows have to be read before the cap trips. A row-count estimate from footers would over-count, because row groups span whole tile widths.
- 2026-11-15 — **Methodology page at `/methodology`** (`route.ts`: `pushState` + `useSyncExternalStore`, no router library; Pages and Vite serve index.html for it). It renders `validation.json`, `calibration.json` and the manifest. The findings sentences are generated from the numbers (|ΔMdAPE| ≤ 1.5 pp → "about as well as"). The data-scope box comes from `manifest.tiles` (≥ 100 tiles → "Global"; otherwise "Regional only — 9 10° tiles within 60° S–20° S, 80° W–50° W"), and "global" scopes are relabelled "Whole build" when the build isn't global. The same scope note is a banner in the calendar panel. Sparse seam scopes are flagged "too sparse for the seam test". Seam chart colours are Okabe–Ito plus line styles. The VIIRS line is drawn over the harmonized one, which equals it after 2012-02 (the caption says so).
- 2026-11-15 — **Not done from PRODUCT F8:** the calibration-factor *map*. The page has a k-by-month table and tile k percentiles instead. Candidate for S7.

## Handoff — S4 (2026-11-15, ~03:15)

**Done**
- Golden tests in web (time, harmonize, analytics incl. fromSeries): all pass, Python unchanged. `npm test` 46/46; `npm run build` and `npm run lint` clean (0 warnings); `uv run pytest` 39/39.
- At-a-glance (F3); calendar CSV / summary JSON / calendar PNG; hotspot CSV with caps (F5); methodology page (F8 minus the k map).
- **Deployed** (main → https://cf-ember-calendar.pages.dev/) and checked over CDP in a fresh headless Chrome profile at 1280×900 and 390×844:
  - the world density loads;
  - "Try: Chilecito" → At-a-glance + calendar;
  - all four downloads arrive (calendar CSV 26.7 kB, PNG ~127 kB, JSON 18.6 kB, hotspots 668 rows);
  - `/methodology` works from the link and on direct load;
  - no horizontal overflow; **0 console errors/warnings, 0 failed requests**.
- Also checked from a local production build against the HF host. Argentina: critical period Jul–Oct (66 %), trend −2.2 %/yr (p = 0.03), busiest month Aug 2020 (56,288 FCD), Nov 1–10 2026 = 1,918 FCD vs a median of 2,532 (0.8×, 48th percentile, Normal).
- The CDP driver is a scratch script, not in the repo: ~150 lines of Node 22 `WebSocket` + `--remote-debugging-port`, with `Browser.setDownloadBehavior` for the exports. Easy to rewrite for S8.

**Next**
- When the global build finishes: the S3 steps (`--add` the two missing years, then 2026 when FIRMS delivers it, then `sync_data.sh`). **No web change is needed.** The methodology page, scope banner and findings follow the files, and with ≥ 100 tiles the banner disappears and the page says "Global". Re-read the findings sentences on global data (the "about as well as" wording is picked by a threshold).
- S5/S6 Rekindle: `App.tsx`'s tab bar has only "Calendar"; add the Rekindle tab there. `route.ts` can take a third route if Rekindle wants its own URL.
- S7: calibration-factor map (optional); bundle split (main chunk ~2.05 MB / 605 kB gzip; the methodology page could be lazy-loaded); satellite basemap toggle.

**Surprises**
- The two analytics implementations agreed on the first run, so S3's work writing down the rules paid off.
- The fixture's last dekad (Nov 11–20) was only partly observed at build time. Without the MTD rule above, the Argentina headline would compare 4 days with full dekads.
- In sparse AOIs (Chilecito 25 km) most monthly medians are 0. So the panel reads "critical period Aug–Sep, 100 % of a typical year" and "0 vs a median of 0, Normal". Correct by the rules, but thin. For the demo, a bigger hero AOI (50–100 km, or La Rioja province) would give a more telling At-a-glance.
- To stop the dev/preview servers, match node processes by port (5191/5192), not every `node.exe`. The global build (Python) must stay up.

## Addendum — S4 hero radius and sparse areas (2026-11-15)

- 2026-11-15 — **"Try: Chilecito" is now 50 km, not 25 km** (`web/src/map/aoiActions.ts`). User feedback: the 25 km At-a-glance read oddly ("0 FCD vs a median of 0", "critical period Aug–Sep, 100 % of a typical year"). Measured on the fixture, same centre:

  | radius | months with no activity | months with median > 0 | critical period | trend | Jul 2026 vs median July |
  |---|---|---|---|---|---|
  | 25 km | 69 % | 2 of 12 | Aug–Sep (100 %) | +2.7 %/yr, p = 0.20 | 98 vs 0 |
  | 50 km | 27 % | 12 of 12 | Jun–Oct (70 %) | +4.3 %/yr, p = 0.01 | 101 vs 6 |
  | 100 km | 8 % | 12 of 12 | Jul–Oct (61 %) | +1.2 %/yr, p = 0.56 | 114 vs 28 |

  50 km keeps the fire dominant (Jul 2026 is the busiest month on record) and gives every calendar month a non-zero median. **Not changed:** the validation seam scope (`pipeline/validate.py` HERO, still 25 km, flagged `sparse`) and the golden `fixture-chilecito` case. They are pipeline-side and independent of the button, and at 50 km the seam test would still be sparse (≈ 3 MODIS FCD a month).
- 2026-11-15 — **Sparse areas get honest wording**, since users can draw small areas too. At-a-glance shows a warning when ≥ 50 % of baseline months have no activity ("Hotspot activity is rare in this area: 69 % of months (209 of 302) have none…; draw a larger area"). Month-to-date with 0 now and a median of 0 reads "No activity so far, like 24 of 25 past years at this time" instead of a mid-rank "48th percentile" of zeros. When the month-to-date median is < 5 FCD (and the area isn't already flagged sparse), a caveat says a few fire-cell-days either way would change the label. Example: the 50 km hero's Nov 1–10 2026 = 4 vs a median of 1, "Extreme". The rules themselves (analytics.py / golden) are unchanged; only the wording around them.

## Implementation decisions (S5, 2026-11-15)

Constants and values checked against the primary sources (sub-agent lookups: Andrews 2018 RMRS-GTR-371, Rothermel 1972 INT-115, Anderson 1982 INT-122, Anderson 1983 INT-305, Albini 1976 INT-30 Table 7, Finney 1998 RMRS-RP-4). **The source wins; REKINDLE.md is updated to match.**

| Item | REKINDLE.md said | Source | Used |
|---|---|---|---|
| Γ' exponent A | Albini = 1/(4.774σ^0.1 − 7.27), R72 = 133σ^-0.7913 | **Swapped.** R72 eq 39 = 1/(4.774σ^0.1 − 7.27); Albini 1976 / BehavePlus = 133σ^-0.7913 (A18 Table 6c, p.14, p.24) | 133σ^-0.7913 |
| η_s | 0.174 S_e^-0.19 | Same, **max 1.0** (Albini) | capped (inactive at S_e = 0.01: 0.417) |
| LB units | U_E in mi/h | Coefficients 0.2566/−0.1548/−0.397 are **Finney 1998 eq 13 (p.7), U = effective midflame wind in m/s**, LB > 8 truncated. Anderson 1983 eq 17 is 0.936e^(0.1147U) + 0.461e^(−0.0692U), U in mi/h, no −0.397. In mi/h the doc's form gives about twice the LB | m/s, clamp [1, 8] |
| Normal speed | S = R(θ_n) (polar) | Not a sourcing error, but it fails test 2 (LB 19–117 % too large). Richards 1990 / Huygens: S = support function of the ellipse wavelet | **Huygens** default; `normal_speed="polar"` kept for the course report |
| FM 7 live woody SAV | (not given) | Albini 1976 Table 7 p.92: **1550**; Andrews 2018 Table 8a: 1500 | 1550 (the older primary value; it changes FM 7 only slightly) |
| Fuel loads like 3.01, 5.01, 14.03 t/ac | — | INT-122 Table 1. These are the exact t/ac equivalents of the original lb/ft² values (0.138 lb/ft² = 3.006 t/ac), not typos | kept as printed |
| SAV, heat content, live herb/woody split | "Anderson 1982" | INT-122 has **no SAV or heat columns** (loads, depth and Mx only). SAV and the herb/woody split come from Albini 1976 via Andrews 2018 Table 8a (FM 2 live = herbaceous; FM 4, 5, 7, 10 live = woody); 10-h 109, 100-h 30, h = 8000 for all | as sourced; CSV comment row says so |
| Size-class bins for g_ij | — | A18: 1200 / 192 / 96 / 48 / 16 (one A18 passage says 49) | 48; weight 0 below 16 |
| Live M_x | — | 2.9 W (1 − M_f,dead/M_x,dead) − 0.226, floored at M_x,dead (A18 §3.2.2) | as source |
| Wind limit | U ≤ 0.9 I_R | Same (R72 p.33). Andrews et al. 2013 revised it to 96.8 I_R^(1/3); BehavePlus 5+ makes it optional | flag `wind_limit`, default off, 0.9 I_R |
| All other §1 constants (β_op, Γ'_max, η_M, ξ, ε, Q_ig, C, B, E, φ_s, ρ_p, S_T, S_e, h) | — | match R72 / A18 | unchanged |

- 2026-11-15 — **Rothermel reference values: Andrews 2018 Table 17, rows 1–3** (BehavePlus 6, printed p.59). Inputs: 2 t/ac dead fuel split 2/0, 1/1 and 0.1/1.9 between 1-h (SAV 2500) and 10-h (SAV 109); depth 1 ft; M = 5 %; Mx = 20 %; midflame wind 5 mi/h; no slope. Published ROS 81.6 / 40.2 / 32.0 ft/min. **Ours: 81.616 / 40.248 / 32.000 (≤ 0.12 %)**. ρ_b, β, σ, β_op, β/β_op and φ_w match to the printed digits. **No tabulated Anderson FM 1 / FM 4 run with all inputs stated was found** (A18 shows those only as plots), so `test_regression_fm1_fm4` is labelled as a **regression against our own output**, not a published value.
- 2026-11-15 — **Wind and slope combine as vectors** (φ_w along the wind's "toward" direction, φ_s upslope). U_E is the inverse of φ_w (not printed in A18; it is just algebra), and LB uses U_E, as in FARSITE.
- 2026-11-15 — **Solver choices beyond REKINDLE.md §3:**
  - Reinitialize every 20 steps **or** once the fastest cell has moved 3 dx, whichever comes first. With CFL 0.5 the front can move 10 dx in 20 steps, which would leave the 6 dx band.
  - skfmm `narrow=8 dx`; cells outside the band stay frozen at ±8 dx.
  - The run stops early when no unburned spreadable cell touches a burned one (barriers, extinction).
  - Non-burnable cells are never ignited.
  - Edge: flagged in `metrics.edge_reached`; it stops the run only when `stop_at_edge=True` (the default).
  - `SimResult.ros_head` = the head ROS in the cell when it burned. Isochrones are not done yet (S6/export).
- 2026-11-15 — **scikit-fmm 2025.6.23 installed fine on Windows.** It does not appear on the Python 3.12 list, but the project venv runs Python 3.13.12 (`platform.python_version()`). Also added: `pyyaml` (fires.yaml) and dev-only `matplotlib` (report figures).

## Handoff — S5 (2026-11-15)

**Done** (branch s5, fast-forwarded to main)
- `rekindle/`:
  - `rothermel.py`: imperial internally, SI wrappers, full Albini dead/live weighting with g_ij, live M_x, wind+slope vectors → U_E and head direction, wind-limit flag.
  - `fuels.py` + `data/anderson13.csv` (13 models, with a citation row) and the IGBP crosswalk.
  - `ellipse.py`, `scenario.py` (Domain, Moisture, WindSample with linear u/v interpolation, Ignition with a start time, Scenario, params_hash).
  - `levelset.py`, `simulators.py` (Simulator protocol + LevelSetRothermel), `verify.py` (measurement helpers).
  - `verification_report.py`, `hotspots.py`, `fires.yaml`.
- Tests: 50 in `tests/rekindle` (Rothermel incl. the published Table 17 check, ellipse, the 5 solver tests + edge flag). `uv run pytest` **89 passed** (pipeline 39 untouched); ruff clean.
- **Report material for the LaTeX write-up:** `docs/report/rekindle/` holds results.json, 9 figures (PDF+PNG), references.bib and a README mapping each figure to its citation. Regenerate with `uv run python -m rekindle.verification_report`.

**Solver numbers** (`docs/report/rekindle/results.json`)
- Test 1, circle (FM 1, no wind, dx 10 m, r = 700 m at 72 azimuths): max radius error **11.8 m = 1.18 dx** (the 1.5 dx ignition radius is part of it); axis vs diagonal rate bias **1.1 %**; rate within 1.3 % of R0.
- Test 2, ellipse (FM 1, U10 3–15 m/s, dx 20 m):

  | Normal speed | LB error | Head-rate error |
  |---|---|---|
  | Huygens (used) | **≤ 2.0 %** | ≤ 1.8 % |
  | polar | +19 % to +117 % | −3 % to −36 % |

  Visible artifact: the head tip is slightly pointed and lags the exact ellipse by ~1–2 dx (first-order upwind with a direction-dependent speed; see `figures/test2_ellipse`).
- Test 3: two ignitions merge into 1 component; still 2 components before they meet; meeting time within 8 %.
- Test 4: 1- and 3-cell strips hold, with 0 cells burned in or behind the strip. The run ends by itself.
- Test 5, convergence (L1 arrival-time error against the exact solution, dx 40/20/10/5 m):
  - Circle: 5.7 / 2.3 / 1.0 / 0.53 %, observed order 1.34 / 1.14 / 0.96.
  - Wind case (U10 = 9 m/s, exact Minkowski solution): 4.3 / 1.9 / 0.99 / 0.56 %, order 1.17 / 0.93 / 0.81.
  - So the scheme is **first order**, as expected for first-order Godunov.
- **Timing, 24 h simulated on 400 × 400 at 90 m** (synthetic hill, mixed FM 1/2/4/9, a river, wind veering 250°→322°), NumPy only:
  - moderate fire (9,400 ha burned): **6–8 s**;
  - worst case (53,000 ha, front across most of the grid): **18–27 s**.
  - The spread is because the global pipeline build was running on the same machine. Both are under the 30 s target, so **no numba**.

**Chilecito (S6 prep, fixture data, read-only)**
- 649 detections in the bbox, Jul 27 – Aug 1: NOAA-20 364, S-NPP 247, Terra 31, Aqua 7.
- The first overpass is **NOAA-20 at 2026-07-27 17:40 UTC: 9 pixels already spread ~5 km N–S** (lat −29.086…−29.133, lon −67.660…−67.678). The fire was established before it was first detected, so the hindcast should start from a **line/multi-point ignition at 17:40**, not a single point.
- Next pass: S-NPP at 19:02. Tables are in `docs/report/rekindle/chilecito-2026_*.csv`.

**What S6 needs, in order** (sizes are estimates; nothing downloaded)
1. **DEM:** Copernicus GLO-30. Public on AWS Open Data (`copernicus-dem-30m`), no login. 1° COG tile `S30 W068`, tens of MB. Alternatives NASADEM / SRTM need an Earthdata login or an OpenTopography key.
2. **Land cover:** MCD12Q1 v061 IGBP (LC_Type1), 500 m, latest year (LP DAAC). **Needs an Earthdata login**: one h12v11 tile, a few MB. The crosswalk in `fuels.py` is ready. Plus MOD44W water (also Earthdata), or take water from IGBP class 17 only.
3. **Wind:** MERRA-2 M2T1NXSLV hourly U10M/V10M, Jul 26 – Aug 2 2026 (GES DISC). **Needs an Earthdata login with the GES DISC app authorized.** Subset to the point with OPeNDAP or the GES DISC subsetter (KB); full daily files are ~400 MB each. Check that MERRA-2 has reached Jul 2026 (it lags a few weeks).
4. `rekindle/prep.py`: reproject to UTM 19S (EPSG:32719), 90 m grid ≈ 40 × 40 km around the bbox; slope/aspect from the DEM; fuel from the crosswalk → `Domain`. Ignition = the 17:40 pixel centres as multiple `Ignition`s, starting at t = 0.
5. Then `metrics.py`, the multiplier fit and the quality gate (REKINDLE.md §5).

**Surprises**
- **skfmm silently misreads a non-contiguous view** (`phi[1:-1, 1:-1]`). It returned scrambled distances and fronts jumped around. Fixed with `np.ascontiguousarray`. Watch for this in any other skfmm call.
- The polar normal speed that REKINDLE.md planned for v1 fails the doc's own ±10 % LB test badly. The Huygens form fixes it and costs nothing extra.
- REKINDLE.md's LB units were wrong by a factor of 2.237 in U, and its A attribution was swapped. Both are fixed in the doc.
- The first version of the stop condition never fired, because burned interior cells keep S > 0. An "active front" check replaced it.

## Addendum — S5 → S6 scope (2026-11-15, ~10:30)

- 2026-11-15 — **S6 starts with three more solver tests** (user decision; add them to `tests/rekindle/test_levelset.py`, reusing `rekindle/verify.py`):
  1. **Slope:** uniform incline, no wind. The head must run upslope at `head_fire(...).r_head` (±5 %), and the backing side must be slower. This is the only test of the slope-vector path in the solver; now only the benchmark touches it.
  2. **Wind shift:** wind turns 90° mid-run (a two-sample `Scenario.wind`). The late-time head direction must follow the new wind. Real MERRA-2 wind changes hourly.
  3. **ROS multiplier:** `ros_multiplier=2` must give arrival times ÷ 2 (to within dx/R tolerance). The S6 calibration sweep depends on it.
  - Optional: a fuel interface (FM 1 → FM 12 strip; speed changes at the boundary, no artifacts) and determinism (same inputs ⇒ identical arrival field and `params_hash`).
  - Put any new figure or number in `rekindle/verification_report.py`, so `docs/report/rekindle/` stays the single source for the LaTeX report.
- 2026-11-15 — **No backend for Rekindle.** The solver is fast (≤ 30 s / 24 h on 400 × 400), but the plan stands. CLAUDE.md forbids servers. Per-fire inputs need offline prep and credentials, uncalibrated runs aren't hindcasts, and free Python hosts cold-start. Spend the speed on a **denser precomputed grid** instead (finer wind/moisture steps, if the export budget allows). A live backend is a post-hackathon roadmap item only.
- 2026-11-15 — **Credentials check:** `.env` has no `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` yet, and there is no `~/.netrc`. MCD12Q1/MOD44W (LP DAAC) and MERRA-2 (GES DISC; authorize the "NASA GESDISC DATA ARCHIVE" app in the Earthdata profile) need them. The DEM can come from Copernicus GLO-30 on AWS (no login) instead of NASADEM (REKINDLE.md §4 named NASADEM; either is fine, so log the choice).

## Implementation decisions (S6, 2026-11-15)

- 2026-11-15 — **Solver tests 6–10** (`tests/rekindle/test_levelset.py`, cases in `rekindle/verify.py`, numbers in `docs/report/rekindle/results.json`):
  - 6 slope: 20° incline, FM 1, no wind, dx 10 m. Head 0.1508 vs Rothermel 0.1509 m/s (−0.1 %). Backing 0.038 m/s = ellipse backing rate.
  - 7 wind shift: 6 m/s from 270° for 3,273 s, then from 180°. Before the shift, east 0.456 / north 0.171 m/s. After it, north 0.456 / east 0.171 (expected head 0.458).
  - 8 ×2 multiplier: arrival times exactly halved (0 s difference on 6,698 cells). dt scales with 1/S, so the scheme is exactly scale-invariant while dt_max doesn't bind.
  - 9 fuel interface FM 1 → FM 12: rates 0.02337 / 0.00766 m/s vs R0 0.02339 / 0.00766; arrival is monotone across the boundary.
  - 10 determinism: identical arrival field and params_hash.
- 2026-11-15 — **DEM = Copernicus GLO-30** (AWS Open Data COGs, windowed reads, no login), not NASADEM (which needs a login). Tiles S30W068 + S29W068, bilinear to the 90 m UTM 19S grid (444 × 444, 40 km).
- 2026-11-15 — **Fuels = MCD12Q1 v061 2025** (the year before the fire), **water = MOD44W v061 2025 ∪ IGBP 17**. Downloaded from LP DAAC with the Earthdata token. GDAL has no HDF4 driver here, so the files are read with `pyhdf`.
  - In the domain: IGBP 7 (open shrubland → FM 6) 57 %, 10 (grassland → FM 1) 36 %, 16 barren 6 %, 13 urban 1 %. 0 water cells.
  - Detections fall on FM 1 (265) and FM 6 (384).
- 2026-11-15 — **Wind = MERRA-2 M2T1NXSLV hourly via the Earthdata cloud OPeNDAP** (`opendap.earthdata.nasa.gov/collections/C1276812863-GES_DISC/…dap.csv`). The old `goldsmr4.gesdisc` OPeNDAP returns **410 Gone**.
  - July 2026 is published (CMR granules exist to 2026-10-01).
  - The domain centre is bilinear from the 4 surrounding grid points; values are hourly means centred on :30.
  - Jul 27 afternoon: dry westerly 9–10 m/s, QV2M ≈ 2 g/kg.
- 2026-11-15 — **Token handling:** `rekindle/earthdata.py` sends `Authorization: Bearer` only to `*.earthdata.nasa.gov`, `*.earthdatacloud.nasa.gov` and `*.gesdisc.eosdis.nasa.gov`, never on redirects to S3. It never prints the token. The first probe script re-sent the header on every redirect and was blocked by the safety check; this fixes it.
- 2026-11-15 — **Baseline dead fuel moisture = 6 %.** This is the moisture-axis value nearest the median Simard (1968) EMC over the run (5.4 %; p10 3.0, p90 10.6), from MERRA-2 T2M/QV2M at the ignition elevation (2,345 m, median RH 24 %). It is constant in time, with no diurnal cycle.
  - Live moisture: defaults. They don't matter here, because FM 1 and FM 6 carry no live fuel.
- 2026-11-15 — **Metrics definitions** (`rekindle/metrics.py`):
  - T_sim per detection = the minimum arrival inside its scan × track footprint.
  - Pixels never reached count as Δ = +inf; they are not dropped.
  - Hit = reached by the next overpass.
  - **Gate threshold = mean interval between overpasses (3.2 h)**, fixed before the sweep. The median gap (1.4 h) would be stricter; it is dominated by NOAA-20/S-NPP pairs 80 min apart.
  - Grid and baseline runs use `stop_at_edge=False`, so a fire leaving the domain keeps burning inside it.
- 2026-11-15 — **Grid axes** (only used if a fire passes): wind 0–15 m/s step 3; 8 directions; dead moisture **3, 4, 6, 8, 10, 14 %**. 3 % was added because the EMC p10 is 3 %, and 8 % fills the gap. Calm runs once per moisture and is shared by all 8 directions in `runs/index.json`. That gives 247 runs per fire.
  - Timing: 100–320 s per 110 h run at 444² on this machine. A full grid with 3 workers takes about 3–4 h.
- 2026-11-15 — **Data credits** (exact strings in `rekindle/credits.py`; also in each exported `meta.json`, the Rekindle panel, the README and `references.bib`):
  - **MERRA-2:** "Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 tavg1_2d_slv_Nx: 2d,1-Hourly,Time-Averaged,Single-Level,Assimilation,Single-Level Diagnostics V5.12.4, Greenbelt, MD, USA, Goddard Earth Sciences Data and Information Services Center (GES DISC), Accessed: 2026-11-15, 10.5067/VJAFPLI1CSIV".
    - Assembled from the collection's own CMR `CollectionCitations` fields (creator, title, place, publisher, release 2015) and the DOI.
    - The GES DISC acknowledgement FAQ (disc.gsfc.nasa.gov/data-guidelines) is JavaScript-rendered and **could not be read verbatim**, so no GES DISC acknowledgement sentence is quoted.
    - The Earthdata data-use guidance (read) asks users to cite the dataset (DOI) and acknowledge NASA. The credits do both.
  - **MCD12Q1:** "Friedl, Mark, & Sulla-Menashe, Damien. (2022). MODIS/Terra+Aqua Land Cover Type Yearly L3 Global 500m SIN Grid V061 [Data set]. NASA Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MCD12Q1.061" (Earthdata catalog page).
  - **MOD44W:** "Carroll, Mark, DiMiceli, Charlene, Townshend, John, Sohlberg, Robert, Hubbard, Alfred, Wooten, Margaret, Spradlin, Caleb, Gill, Roger, Strong, Savannah, Burke, Amanda, Blanco-Rojas, Mariana, & Frost, Melanie. (2024). MODIS/Terra Land Water Mask Derived from MODIS and SRTM L3 Global 250m SIN Grid V061 [Data set]. NASA Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MOD44W.061".
  - **Copernicus DEM:** licence (License-COPDEM-30.pdf) Art. 6(b), the adapted/modified form, because we derive slope/aspect and reproject: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved". Also the AWS registry access line. DOI 10.5270/ESA-c5d3d65.
  - **FIRMS:** "We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS)." (FIRMS FAQ).
  - **From memory, not verified:** `schroeder2014` author list and `machado2009` DOI in references.bib; Simard 1968 publisher details beyond the report number FF-X-14.
- 2026-11-15 — `pyproject.toml`: new dependency group `rekindle-prep` (rasterio, pyproj, requests, pyhdf), made a default group so `uv run` doesn't remove it.
  - The sync only **added** packages (dry run checked first), so the running pipeline's environment was not changed.
  - Web: `d3-contour` + types.
  - Dev only: the `?rkbase=<dir>` query param loads a test export (used to check the what-if UI).

## Handoff — S6 (2026-11-15, ~12:10)

**Done** (branch s6)
- Solver tests 6–10 pass. `uv run pytest` **94 passed**, ruff clean. The report regenerated with the new figure (`test6_7_slope_windshift`).
- `rekindle/prep.py` → `data/rekindle/chilecito-2026/{domain.npz, meta.json}`.
  - 9 NOAA-20 ignition pixels at 2026-07-27 17:40 UTC.
  - 649 detections; 168 h of MERRA-2 wind.
- `rekindle/metrics.py`, `rekindle/hindcast.py` (sweep + gate + figures), `scenario_grid.py` (smoke-tested on 2 keys with `--force`; works), `export.py`, `credits.py`, `domain.py`, `earthdata.py`.
- **Chilecito baseline result — fails the gate, so `status: "poor_agreement"`; baseline only, no counterfactuals:**

  | ×ROS | median Δ (h) | median abs Δ (h) | hit rate | Sørensen | area (km²) |
  |---|---|---|---|---|---|
  | 0.25 | +inf (most pixels never reached) | inf | 0.07 | 0.20 | 317 |
  | 0.5 | +31.9 | 32.5 | 0.25 | 0.21 | 873 |
  | 1.0 | −3.8 | 17.2 | 0.58 | 0.14 | 1,458 |
  | **1.41 (best)** | **−10.4** (IQR −31.1 to +4.7) | **13.3** | **0.66** | **0.14** | 1,479 |
  | 2.0 | −13.4 | 13.8 | 0.91 | 0.14 | 1,489 |
  | 4.0 | −23.3 | 23.3 | 0.99 | 0.14 | 1,489 |

  - Gate: median |Δ| ≤ 3.2 h. Missed by a factor of 4. Detection footprints cover 112 km²; the simulation burns most of the 40 km domain.
- **Why** (see `figures/chilecito-2026_s6_baseline_map`):
  - The real fire starts in the NE cluster, then moves SW and uphill over days on the Famatina foothills (2,000–3,200 m).
  - The model runs east and downslope into the FM 6 open-shrub lowlands within hours, pushed by MERRA-2's 10 m/s westerly on Jul 27.
  - Plausible causes, in the order REKINDLE.md lists them as limitations:
    - the 500 m land-cover → Anderson crosswalk (sparse Monte shrubland is not FM 6);
    - single-point 50 km reanalysis wind over steep terrain;
    - constant moisture with no night recovery.
  - Nothing was tuned after seeing the result.
- `web/public/rekindle/` exported: 433 KB in total, one 252 KB baseline raster at 444 × 446 px.
- **Rekindle tab** (`/rekindle`; tabs in the panel are now links, `route.ts` has a third route):
  - arrival-time ramp (inferno, truncated) with a time slider and play button;
  - white isochrones every 12 h (d3-contour);
  - FIRMS detections up to the clock time, with popups;
  - burned area vs time (ECharts), baseline metrics table, status caption on every view;
  - limits in a collapsible section, and a visible credits line with the Copernicus notice.
  - What-if mode (sliders snap to the axes, dashed baseline outline, "not precomputed" fallback) appears only if `status == validated`. It was checked with a temporary validated test export of the two smoke-test runs, then removed.
  - Checked at 1,280 px and 390 px (no horizontal overflow).
  - CVD: unit test (Machado 2009 protan/deutan/tritan) confirms monotonic luminance and contrast > 4.
  - Run loads in < 10 ms locally (250 KB gz).
  - `npm test` 47 passed, lint clean, build OK (existing > 500 kB chunk warning).

**Not done / next**
- Deployed-URL check of `/rekindle` (Pages serves index.html for any path, as for `/methodology`).
- Step 6, a second curated fire: not started. A fire that passes the gate would turn on the what-if UI with no code changes: run `prep` → `hindcast` → `scenario_grid` → `export`.
- Physically motivated baseline improvements, untested. Don't tune until it passes; log every attempt:
  - hourly dead moisture from the EMC series (solver change: time-varying Moisture);
  - an IGBP 7 override for sparse desert shrub;
  - a downscaled or terrain-adjusted wind.

## Global build report (2026-11-15, ~11:45)

- 2026-11-15 — **The global build is done, uploaded and live: full report in `docs/GLOBAL_BUILD.md`** (timeline, row counts per cleaning stage, sizes, global k / LOYO / seam numbers vs the fixture, local and deployed smoke tests). In short: `D:\ember` holds 2000-11-01 → 2026-11-20 for 433 10° tiles (the two missing years and 2026 were added with `--add`); cubes 132 MB, points 6.6 GB; the L10 cube is 12.6 MiB. Global k 2.45 (Jul) … 3.30 (Feb); LOYO MdAPE 2.5 % calibrated vs 65 % with k = 1; seam 1.01 → −0.03. The HF dataset at the same URL now serves the global files, so the S3 "Next" steps (`--add`, 2026, global upload) are done. No pipeline code changed.

## Addendum — S6 → S6b scope: fix the Chilecito hindcast (2026-11-15, ~12:30)

User decisions: **Chilecito is the priority.** Try to make its baseline pass the gate with physically motivated fixes. If that fails, fall back to other fires. `D:\ember` is now a **read-only** source: the global build is done (`docs/GLOBAL_BUILD.md`), points are at `D:\ember\processed\points\<tile>\<year>.parquet`, and data is live on Hugging Face. Still never write, move or delete anything there.

**Diagnosis (S6 handoff):**
- Best ×1.41: median |Δ| 13.3 h vs a 3.2 h gate; 1,479 km² simulated vs 112 km² of detection footprints.
- The model runs east and downslope into IGBP 7 open shrubland (FM 6) within hours. The real fire crept SW and uphill on the foothills for days.
- Figure: `docs/report/rekindle/figures/chilecito-2026_s6_baseline_map.png`.

**Rules:**
- **No goal-post moving:** the gate (median |Δ| ≤ mean overpass interval, 3.2 h) and the metric definitions in `rekindle/metrics.py` stay as they are.
- **Pre-register:** write the list of changes below (with their physical reason) here *before* running them. Run each change alone, then the combination. Log every attempt's numbers in DECISIONS.md and `docs/report/rekindle/`, failures included.
- A fix that passes on Chilecito is still *calibrated, not blind*; say so.
- Each change must be a model input or physics improvement, never a Chilecito-specific hack such as hand-painting fuels or moving ignitions.

**Candidate changes, roughly by expected impact:**
1. **Fuel cover / bare ground:**
   - Add MODIS **MOD44B v061** Vegetation Continuous Fields (% non-vegetated, % non-tree vegetation; LP DAAC, same download/HDF path as MCD12Q1).
   - Mark cells non-burnable where bare ground ≥ a threshold chosen *a priori* (e.g. 80 %, stated with a reason or a source). Optionally scale fuel load by vegetated cover.
   - The arid Monte lowlands east of the fire are mostly bare, but the crosswalk turns them into continuous FM 6.
   - Add the MOD44B citation to `rekindle/credits.py`, verified from its own page.
2. **Diurnal dead fuel moisture:**
   - Use the hourly 1-h moisture from the MERRA-2 EMC series (Simard 1968, already computed in `hindcast.estimate_dead_moisture`), with a simple 1-h time-lag response.
   - EMC ranges from p10 3 % to p90 10.6 %, and FM 1 extinction is 12 %, so nights should nearly stop the grass fire.
   - Needs time-varying moisture in the solver (`Scenario.moisture_series`; rebuild `_Fuels` when the hourly value changes, cached by rounded value). Add a solver test: constant series = constant moisture, bit-identical.
   - The grid's moisture axis then becomes an offset or a fixed value for counterfactuals; update CONTRACTS.md `notes` and `meta.notes` to match.
3. **Wind** (lower priority; only if 1 and 2 aren't enough): MERRA-2 is a 50 km grid-cell mean over 6,000 m relief. Options:
   - nearest grid point instead of bilinear, as a sensitivity check;
   - a stated terrain sheltering factor (lower WAF in rough terrain, with a citation for the value).

   Don't invent a wind model.

**Time box** (feature freeze 20:00; a full 247-run grid takes ~3–4 h at 3 workers, less for a smaller grid or a shorter run):
- **By ~15:00:** if Chilecito passes, start its grid. Shrink it if needed (e.g. 72 h run, moisture axis 4 values) and log that.
- **If it still fails at ~15:00:** keep Chilecito as the `poor_agreement` baseline. Re-export it with whichever fixes improved it, and report the numbers. Then select another fire from `D:\ember` points (read-only, DuckDB `memory_limit='1GB', threads=2`):
  - one Argentine fire, and one Canadian fire south of 60°N if time allows;
  - many overpasses over ≥ 3 days, grass/shrub/savanna fuels, moderate terrain;
  - show the top ~3 candidates before committing.

  Score any new fire with the S6b model settings fixed (a blind test of the fixes), calibrating only the ROS multiplier as before.

**Resources:**
- The pipeline is no longer running. Rekindle may use ≤ 4 worker processes and ≤ 6 GB total.
- Check free RAM before grid runs.
- Don't run pytest, npm build and the grid at the same time.

**Pipeline commands:**
- `uv run python -m rekindle.prep --fire <id>`
- `uv run python -m rekindle.hindcast --fire <id> --workers 3` (sweep, gate, figures; `--figures-only` redraws the map)
- `uv run python -m rekindle.scenario_grid --fire <id> --workers 3` (resumable)
- `uv run python -m rekindle.export --fire <id>`

New fires go in `rekindle/fires.yaml` (bbox, dates, `points_tiles`). The web tab needs no changes: what-if mode turns on when `status == "validated"`.

## Pre-registration — S6b Chilecito changes (2026-11-15, 12:40, before any run)

Fixed and unchanged: gate (median |Δ| ≤ mean overpass interval, 3.2 h), `rekindle/metrics.py`, ignitions, DEM, IGBP crosswalk, MERRA-2 wind, ROS sweep `[0.25 … 4]` (the only fitted parameter). Each change runs alone, then A+B; C only if A+B fail. All results get logged below, failures included.

- **A. Fuel cover from MOD44B v061** (DiMiceli, Sohlberg & Townshend 2022, doi:10.5067/MODIS/MOD44B.061; year before the fire = A2025065, h12v11). A cell is non-burnable where `Percent_NonVegetated` > **50 %**, i.e. vegetated cover < 50 %. 250 m data are resampled nearest to the 90 m grid. Fill (200) keeps the IGBP fuel.
  - Physical reason: Rothermel assumes a continuous fuel bed. A fire can't cross a landscape whose burnable fraction is below the percolation threshold. Van Nes et al. 2018 (PLoS ONE 13:e0191027) report percolation-model thresholds of 30–70 % cover, and **50 % is the midpoint**. No source gives a MODIS-VCF pixel cutoff, so this is an a-priori assumption.
  - **A′ (sensitivity only, not eligible to claim a pass):** threshold 80 %, the example in the S6b addendum. Reported alongside A.
  - Load is not scaled by cover; Rothermel ROS is not monotone in load at fixed depth.
- **B. Diurnal dead fuel moisture.** EMC is computed hourly from MERRA-2 T2M/QV2M (Simard 1968; existing `estimate_dead_moisture` inputs, pressure at the ignition elevation).
  - Each dead class relaxes toward EMC with its own time lag: m ← EMC + (m − EMC)·exp(−Δt/τ), with τ = **1 h / 10 h / 100 h** for the 1-h / 10-h / 100-h classes. This is the definition of the time-lag classes (Fosberg/NFDRS).
  - Initial values: 1-h = EMC at t0; 10-h and 100-h = median EMC over the run, the S6 constant estimator.
  - Solver: `Scenario.moisture_series`. Fuels are rebuilt when the moisture rounded to 0.1 % changes. A constant series must be bit-identical to constant moisture (new test).
  - Live moisture stays at the defaults (FM 1/6 have no live load).
- **C. Wind** (only if A+B fail): MERRA-2 nearest grid point instead of bilinear, as a sensitivity check. No new wind model.

## S6b results log (Chilecito; gate 3.21 h; every attempt, failures included)

Run with `rekindle.hindcast --tag <variant>`. Per-variant sweep JSON and figures are in `docs/report/rekindle/chilecito-2026_<variant>_{calibration.json,calibration.png,baseline_map.png}`.

| variant | change | best ×ROS | median \|Δ\| (h) | median Δ (h) | hit | Sørensen | area km² | gate |
|---|---|---|---|---|---|---|---|---|
| S6 | none | 1.41 | 13.3 | −10.4 | 0.66 | 0.14 | 1,479 | fail |
| s6b_A | MOD44B non-veg > 50 % → non-burnable (20 % of domain) | 1.41 | 12.87 | −9.13 | 0.65 | 0.17 | 1,155 | fail |
| s6b_Aprime | non-veg > 80 % (sensitivity only; 1 % of domain) | 1.41 | 13.35 | −10.40 | 0.66 | 0.14 | 1,463 | fail |
| s6b_B | diurnal time-lag dead moisture | 1.41 | 12.38 | −12.03 | 0.81 | 0.14 | 1,481 | fail |
| s6b_AB | A + B | 1.41 | 12.04 | −11.81 | 0.80 | 0.17 | 1,155 | fail |
| s6b_C | MERRA-2 nearest grid point (−67.5, −29.0) | 2.0 | 13.30 | −12.63 | 0.89 | 0.14 | 1,489 | fail |
| s6b_ABC | A + B + C | 1.41 | 12.26 | −9.98 | 0.66 | 0.17 | 1,154 | fail |

- A: median Δ crosses 0 between ×0.71 (+13.1 h) and ×1.0 (−2.5 h), but |Δ| stays > 12 h at every multiplier. The *spatial pattern* is wrong (some pixels far too early, others far too late), not the overall speed. Detections themselves sit on 13–26 % non-vegetated cells, and the domain median is 32 %, so the mask removes little of the fire's path.
- **All pre-registered changes fail.** The best is A+B at 12.0 h, 3.7× the gate. Every change moves median |Δ| by < 1.3 h. Chilecito stays `poor_agreement`.
- Infrastructure: the desktop runs were 2–2.5× slower than in S6 because the S7 agent shared the CPU. A′, A+B and the grid moved to the Alliance cluster Fir (`scripts/slurm/rekindle_{hindcast,grid}.sh`, account def-hngharti, venv in `~/scratch/rk-venv`); solver tests pass there (15/15). A′ was started on the desktop and stopped after a few minutes, then rerun on Fir.

## Handoff — S7 (polish) (2026-11-15, ~13:00)

**Done** (branch `worktree-agent-a0b9a83797c20fd75`, 5 commits on top of `main` f8867ab; nothing pushed, uploaded or deployed)
- **Layout:** headless Chrome (fresh profile, CDP) at 1280×900 and 390×844 on world view, "Try: Chilecito", `/methodology`, `/rekindle`: no horizontal overflow anywhere (the LOYO/k tables scroll inside `.table-wrap`), **0 console errors, 0 failed requests** — on the dev server against the live HF host, on a production build (`vite preview`) and read-only on the deployed URL. **The deployed site is still pre-Rekindle `main`** (no Rekindle tab); re-check after the next deploy.
- **CVD:** new `web/src/lib/cvd.ts` + `cvd.test.ts` (Machado 2009, severity 1, CIELAB ΔE): the calendar = map density ramp (YlOrRd) gets darker monotonically under normal/protan/deutan/tritan (L* range > 55), neighbouring classes ΔE > 5, zero vs lowest class and zero vs no-data ΔE > 8, seam lines ΔE > 20. **Sensor colours failed:** MODIS #0072B2 vs NOAA-20 #009E73 was ΔE 17 under tritan. NOAA-20 points are now **#33B88A** (min ΔE 25.1).
- **Captions:** every chart has one (calendar, seam chart figcaption, Rekindle burned-area chart, new dekad view); tables have `<caption>`.
- **Wording:** no "fires" for the unit anywhere. The map legend now says "Hotspot activity (VIIRS-equivalent fire-cell-days)" with the same unit tooltip as the calendar. Methodology: "predict/predicted/predicting" (LOYO) → "estimate/estimated/estimating"; "can't recover fires MODIS missed" → "activity". Rekindle: the status caption shows in hindcast and what-if modes; "forecast" appears only as "not a forecast". **No edits to `web/src/rekindle/**`.**
- **Traceability:** the map cell popup showed only the harmonized value. It now shows raw MODIS, raw VIIRS (S-NPP before the NOAA-20 switch, NOAA-20 after), the k applied (value for a single month, range for "all months") and its stratum (drawn area = calendar k; world = calibration.json global k; or fitted from the 1° cube). `densityFromCube` returns the raw sums; the worker returns `kSource`.
- **Test infra:** vitest had 2 failing suites in a fresh checkout: `rekindle/data.ts` reads `location` at import (Node has none) and `density.test.ts` read the fixture Parquet even when skipped. Added `web/src/test-setup.ts` (a `location` stub, via `setupFiles`) and a guard. `npm test` 58 passed / 2 skipped; `npm run lint` clean; `npm run build` OK; `uv run pytest` **101 passed, 1 skipped**; ruff clean.
- **Bundle split:** Methodology and Rekindle routes are `React.lazy`; rolldown `codeSplitting` groups maplibre / echarts / turf / vendor. Main chunk 2,160 kB → 66 kB (maplibre 1.18 MB, echarts 0.60 MB, vendor 0.28 MB, cacheable separately). Production build checked as above.
- **Dekad-of-year sub-view:** collapsed "Dekad view (10-day periods)" under the monthly calendar (`calendar/DekadCalendar.tsx`, `dekad.ts`): years × 36, `Harmonized.dekadal`, same ramp; tooltip has raw MODIS/VIIRS + k + stratum. A test checks dekads sum to the monthly rows.
- **Global harmonized table** (user-approved): `uv run python -m pipeline.export_global --data-dir D:/ember --out data/exports` (45 s, numpy only, no DuckDB; reads the L10 cube + calibration + manifest, writes nothing in `D:\ember`, refuses `--out` inside `--data-dir`). One row per 1° cell-month with any raw activity: **2,193,522 rows, 17,000 cells**, Parquet 24.8 MiB, CSV.gz 24.3 MiB, plus `README.md` (data dictionary, FCD definition, FIRMS acknowledgement, licence) and `.stats.json`. Raw totals equal the cube exactly (MODIS 97,705,475 / S-NPP 152,969,509 / NOAA-20 89,922,052). Strata: aoi 219,587, tile 483,386, global 17,891, reference 1,472,658 rows. Bigger than the "few MB" guess: 2.2 M rows × 21 columns with full float precision.
  - **Equals the browser:** each row = the calendar CSV row for an area covering exactly that cell (1° cells sum exactly from L01, so the L10 cube is the same input). Checked three ways: (1) pytest feeds every single-tile golden harmonize case through the vectorized code (k/lo/hi/stratum + all row fields at 1e-9); (2) pytest on a synthetic build compares every row with `pipeline.harmonize` per cell; (3) a scratch script ran `web/src/lib/harmonize.ts` + `calendarCsv` on 13 real cells from `D:\ember` (all four strata, Chilecito, Central Africa, Canada, Mato Grosso + random): **2,218 rows, 0 mismatches**. A mutation (k threshold ×2) makes the golden test fail.
  - Columns: `cell, lon_center, lat_center, tile` + the calendar CSV columns minus `percentile`; `k_source` says "this cell" for "this area". Contract in CONTRACTS.md → Global harmonized table; commands in CLAUDE.md.
  - **Licence for the table: CC BY 4.0** (in the README; code stays MIT). That's my choice, not a user decision — change it in `pipeline/export_global.py` → `write_readme` if you want something else.
  - **UI:** "Download global table" block on `/methodology` (Parquet / CSV.gz / README links), shown **only** when `manifest.exports.global_table` exists or `VITE_GLOBAL_TABLE=1`. Today neither is true, so nothing changes until the upload.

**Upload (not done):**
```bash
HF_DATASET_REPO=Incandescent-Turtle/cf-ember-calendar-data scripts/sync_data.sh D:/ember --exports data/exports --exports-only
```
This uploads `exports/` (~50 MB, one commit), then re-uploads the manifest from `D:\ember` with `points` unchanged plus `exports.global_table`, then runs `check_host.sh`. No Pages rebuild is needed; the link appears on the next page load. (`--exports` without `--exports-only` does a full sync plus the table.)

**Cut:** satellite basemap toggle. EOX's current licence page (cloudless.eox.at/documentation/license) puts EOxCloudless under CC BY-NC-SA 4.0, or a commercial licence. It does not confirm the CC-BY 2016 layer BUILD_PLAN assumed. Not worth the risk before the freeze.

**Next**
- Merge this branch, deploy, then re-run the deployed check (the Rekindle tab and the lazy chunks are new on the deployed site).
- Upload the table (above) if you want the download link in the submission.

**Surprises**
- The worktree started from `875b5ca` (pre-S6). I fast-forwarded it to `main` f8867ab before working.
- `python` text-mode writes on Windows produce CRLF; `*.sh` files are LF-only by `.gitattributes`, so `sync_data.sh` was normalized before the commit.

## S6b decisions before the next runs (2026-11-15, 13:20; no results from these runs seen yet)

- **Frozen S6b model settings = A+B** (MOD44B non-vegetated > 50 % non-burnable, plus diurnal time-lag dead moisture), because A+B improved Chilecito the most among the pre-registered changes (12.0 h vs 13.3 h).
  - Fixed before the C / A+B+C results and before any run on another fire.
- **Córdoba 2024 blind test** (`cordoba-2024`, fires.yaml). A+B frozen; only the ROS multiplier is swept, exactly as for Chilecito. Same gate (mean overpass interval) and same metrics. The S6 model is also run there, for comparison only.
  - Chosen from the `rekindle.candidates` search (Argentina 2023–2026, ranked by VIIRS overpasses).
  - Rejected candidates:
    - Neuquén −68.7/−38.3 recurs at the same spot every year, likely gas flares;
    - Paraná delta −59.3/−33.6 has many separate island ignitions;
    - Chaco/Santa Fe clusters look like clearing burns.
- **EXPLORATORY, not pre-registered: seeded start (`--seed-h 3`).** Every detection within 3 h of the first one becomes an ignition at its own detection time, and those pixels are excluded from scoring, as the first-overpass pixels already are. Rule and gate are otherwise unchanged.
  - Why: at 1.4–1.7 h after the first overpass, FIRMS already sees fire 5–6 km W/SW of the ignition pixels, upwind of a ~10 m/s westerly. One point ignition can't produce that: either several fires were burning or the fire was already larger than its detected pixels.
  - This is a general protocol rule ("start from the observed early extent", on the roadmap). But it was proposed *after* seeing Chilecito fail, so any Chilecito result from it is labelled **exploratory**, not a validation.
  - Whether an exploratory pass may ship counterfactuals is decided after the numbers, and stated explicitly.

## S6b results: Córdoba blind test and the exploratory seeded start (2026-11-15, 13:33)

All runs on Fir. Sweep JSON and figures are in `docs/report/rekindle/<fire>_<variant>_*`.

| fire / variant | settings | best ×ROS | median \|Δ\| (h) | median Δ (h) | hit | Sørensen | area km² | gate |
|---|---|---|---|---|---|---|---|---|
| cordoba-2024 / s6b_AB (**blind**, frozen S6b) | A+B | 0.25 (sweep edge) | 15.16 | −13.10 | 0.84 | 0.39 | 471 | fail (gate 2.93 h) |
| cordoba-2024 / s6 (comparison) | S6 model | 0.25 (sweep edge) | 18.75 | −2.11 | 0.59 | 0.39 | 413 | fail |
| chilecito-2026 / x_seed3_AB (**exploratory**) | A+B, seed 3 h (28 ignitions) | 0.5 | 9.61 | −8.69 | 0.78 | 0.21 | 958 | fail |
| chilecito-2026 / x_seed3 (**exploratory**) | seed 3 h only | 0.5 | 10.24 | −7.93 | 0.76 | 0.17 | 1,179 | fail |

- Córdoba: even at ×0.25 the simulation arrives ~13 h early. Faster multipliers burn the whole domain (~1,600 km²) within a day. The best value sits at the edge of the fixed sweep range; the range was **not** extended.
- The seeded start is the largest single improvement on Chilecito (12.0 → 9.6 h), which supports the ignition diagnosis, but it still fails by 3×.

## S6b input check and diagnosis (`uv run python -m rekindle.input_check`)

| | Chilecito | Córdoba |
|---|---|---|
| MERRA-2 10 m wind p50 / p90 / max | 2.5 / 7.3 / 10.5 m/s | 4.2 / 6.9 / 9.1 m/s |
| RH median (range) | 24 % (9–78) | 25 % (3–82) |
| T2M range | 3.0–25.4 °C | 11.7–32.1 °C |
| fuel models under detections | FM1 265, FM6 384 | FM1 618, FM2 274, FM6 2, FM10 5 |
| Rothermel head ROS at 6 % dead, wind p50–p90 | FM1 0.35–2.4 km/h, FM6 0.22–0.80 | FM1 0.82–2.2, FM2 0.40–0.93, FM6 0.40–0.75 |
| observed: max distance from ignition | **5.8 km by 1.4–1.7 h**; 9.0 km at 24 h; 14.3 km at 120 h | 6.2 km at 12 h; p90 4.9 → 5.5 km from 12 h to 72 h; p90 11.9 km at 120 h |

- **The inputs check out:** no unit, direction or projection error. Rothermel speeds at these inputs are ordinary grass/shrub head-fire rates.
- **Diagnosis: both real fires burst, then stall.**
  - Chilecito covers 5.8 km in under 2 h, then only ~8 km more over 4.5 days (≈ 0.07 km/h).
  - Córdoba covers 6 km in 12 h, then stalls for ~2 days.
  - A free-spread model at ~0.5 km/h travels tens of km in 5 days. A single ROS multiplier can only trade "too slow early" against "too fast later". That is the signature of all 12 sweeps.
- **What stalls a real fire is not in our inputs:** suppression (both fires are near towns), fuel breaks below the 250–500 m land-cover scale, and local weather/sheltering. The model's only stop mechanism is moisture above extinction, and MERRA-2 grid-cell RH never gets there.
- One questionable input remains: T2M is a grid-cell mean with no lapse-rate correction to the fire's elevation. Correcting it would make Chilecito's nights more humid. It cannot produce a multi-day daytime stall.
- **Chilecito's first-overpass "ignition" is not a point ignition.** 1.4–1.7 h after it, FIRMS sees fire 5–6 km W/SW, upwind of the westerly. Several fires were already burning, or the fire was already larger than its detected pixels.

## S6b literature (a sonnet lookup; abstracts and catalogue pages only; see references.bib)

- **Cruz & Alexander 2013** (Environ. Model. Softw. 47:16–28, doi:10.1016/j.envsoft.2013.04.004):
  - 49 datasets, 1,278 observations; mean absolute % error 20–310 %;
  - under-prediction in 75 % of datasets; ±35 % proposed as a benchmark.
  - These are rates during active spread. Our 10× over-burn comes from the missing stall, not from implausible burst speeds.
- **Price & Germino 2022** (Fire Ecology 18:23, doi:10.1186/s42408-022-00147-2), FARSITE in sparse sagebrush steppe:
  - Sørensen 0.38 with LANDFIRE fuels;
  - 0.70 (and 0.80 on a second fire) with fuels built from fractional vegetation cover.
  - Fuel inputs from cover are a large lever; our change A (a threshold) was a blunt version.
- **Coen & Schroeder 2013** (GRL, doi:10.1002/2013GL057868), the coupled CAWFE model on the Little Bear Fire:
  - re-initialised from VIIRS 375 m detections every 12 h;
  - good for 12–24 h after each restart, then drifted.
  - **Nobody runs a 5-day fire from a single ignition**; our protocol asked more than the state of the art delivers.
- **Benali et al. 2016** (Sci. Total Environ. 569–570:73–85, doi:10.1016/j.scitotenv.2016.06.112): on 8 Portuguese fires, the dominant error sources were wind, fuel-model assignment and ignition location/timing.
- **Finney 2000** (FARSITE validation report): Rothermel spread rates tended to be over-predicted. Seen only as a secondary quote, so partly unverified.
- **Inputs available:**
  - Pettinari & Chuvieco 2016 global FCCS fuelbed map (doi:10.5194/bg-13-2061-2016; PANGAEA, CC BY-NC-SA, needs a crosswalk);
  - the global MODIS live fuel moisture set (ends 2018, so not usable here);
  - ERA5-Land and WindNinja not checked.

## Why we didn't foresee this (lessons)

- The Rekindle plan assumed that one global ROS multiplier could carry a 5-day, single-ignition hindcast. That holds only if the error is "uniformly X× too fast". It fails for stop-and-go fires, and the literature restarts models every 12–24 h.
- Chilecito was chosen for the calendar story, not for simulability. Nobody looked at its distance-from-ignition-over-time curve, which `rekindle.input_check` now prints in seconds, before building on it.
- REKINDLE.md listed coarse fuels, single-point wind and moisture as limitations, but not *fire behaviour outside the model's domain* (suppression, stalls, multiple ignitions).

## Plan from 13:50 (user decision: implement all of it; a sub-agent continues on `s6b`)

1. **Ship Chilecito and Córdoba as `poor_agreement` hindcasts.**
   - Chilecito re-exported with the frozen A+B settings; Córdoba as a second baseline-only fire.
   - The Rekindle page and methodology get the burst-and-stall figure, the variant table and the citations.
2. **EXPLORATORY: 24 h re-initialised windows** (Coen & Schroeder 2013 style).
   - Each day starts from the observed VIIRS extent so far, and only that window's new detections are scored.
   - Same gate and metric definitions; A+B frozen; ROS multiplier swept once per fire across all windows.
   - Labelled exploratory everywhere. Whether a pass may ship counterfactuals is the user's call, stated explicitly.
3. **Free-spread pre-screen, then a blind test on a new fire with the original protocol.** A candidate's distance-from-ignition must grow without multi-day plateaus. Argentina first, then Canada south of 60°N.
4. **Optional, exploratory input improvements:** cover-scaled fuel load from MOD44B (after Price & Germino), and a lapse-rate T2M correction. Pre-register each before running.

## Infrastructure: Alliance cluster Fir

- **Account and paths:** account `def-hngharti` (Slurm `def-hngharti_cpu`). There is no project directory for it, so work happens in `~/scratch/cf-ember-calendar` (git clone of `s6b`) with the venv at `~/scratch/rk-venv`. Python 3.12 module; numpy, scipy, scikit-fmm from PyPI, pyyaml, matplotlib, pytest.
- **Jobs:**
  - `scripts/slurm/rekindle_hindcast.sh <fire> <tag> [hindcast opts]`: 9 cores, one sweep in ~4–10 min;
  - `scripts/slurm/rekindle_grid.sh <fire>` as `--array=0-N`.
  - Both need `REKINDLE_VENV=~/scratch/rk-venv`. Jobs started with no queue wait at ~11:00 PT.
- **Access from the desktop:**
  - SSH needs Duo MFA every time, and OpenSSH ControlMaster doesn't work under Git for Windows.
  - Instead a local paramiko bridge holds one authenticated connection; commands and SFTP go to 127.0.0.1 only, with a token. It lives in the session scratchpad: `rk_bridge.py` and its `rb` wrapper.
  - If it dies, the user approves a new Duo push.
- Data moves with SFTP put/get of the small inputs and a tar of the outputs. Results also live in the repo (`docs/report/rekindle/`); `data/` is gitignored.

## Pre-registration — EXPLORATORY 24 h re-initialised windows (2026-11-15, 15:14, before any run)

Labelled **EXPLORATORY** everywhere (proposed after Chilecito failed). Gate, metric definitions (`metrics.score`), A+B settings and the ROS sweep `[0.25 … 4]` are unchanged; one multiplier per fire, chosen by the same rule (lowest pooled median |Δ|, then hit rate).

- **Windows:** t_k = k × 24 h after the first detection, k = 0, 1, … while t_k < the last detection. Window k runs from t_k to t_k + 24 h (capped at the fire's run length).
- **Restart state (primary, `--windows 24`):** every detection with t ≤ t_k is an ignition **at t_k** (the observed extent at restart, as in Coen & Schroeder 2013, who re-initialise from the VIIRS extent). Implemented by shifting t0 to t_k, so wind and the hourly moisture series follow the real clock.
  - Deviation from the brief ("at its own time"): igniting day-1 pixels at their own time lets them spread freely for k days before the window, which is the S6b failure mode and not a re-initialisation. The "own time" variant runs too, as a sensitivity (`--window-ignite own`), and is reported alongside.
- **Scored:** only pixels first detected in (t_k, t_k + 24 h], via `metrics.prepare(..., t_end = t_k + 24 h, seed_s = t_k)`; earlier pixels are excluded exactly as ignition pixels are.
- **Pooled metric:** the per-pixel Δ of all windows are pooled for the median |Δ| (the gated number); per-window medians are reported too. Gate threshold = the whole fire's mean overpass interval (3.21 h Chilecito, 2.93 h Córdoba).
- If a fire passes, it stays not-validated and ships no counterfactuals until the user decides.

## Pre-registration — free-spread pre-screen and the next blind fire (2026-11-15, 15:16, before running the screen)

Screen (`rekindle.candidates --screen`), applied to each `rekindle.candidates` window (0.2° cell × 10 days, ranked by distinct VIIRS overpasses). Fire box = ±0.2° around the cell's mean detection; run window = first day + 6 days (as Chilecito/Córdoba); all FIRMS sensors (as `prep`). Ignition = the detections of the first overpass; R(t) = running max over passes of the farthest detection's distance from the nearest ignition (km, equirectangular).

| rule | reject if | physical reason |
|---|---|---|
| P0 enough to score | fewer than 3 days with detections, or R_final < 5 km | a gate needs spread over several overpasses |
| P1 single start | first-overpass detections span > 3 km | several separate ignitions (Paraná-delta type) |
| P2 no early burst | R(t ≤ 3 h) > 3 km | > 1 km/h in the first hours, i.e. far from the ignition pixels before the model can get there (Chilecito: 5.8 km at 1.7 h). Distance in any direction, stricter than "upwind" (no wind needed for the screen) |
| P3 no multi-day plateau | any 48 h interval [t, t + 48 h], t ≥ 6 h, with detections after t + 48 h, where R grows by < max(1 km, 0.15·R_final) | a stall that free spread cannot represent (Chilecito: 60→108 h grows 1.7 km < 2.1 km) |
| P4 no recurrence | the ±0.05° box around the cell centre has detections on ≥ 20 days in each of ≥ 2 other years (2019–2026) | gas flares, industrial or yearly agricultural burning |

- **Pick:** among windows passing all rules, the most distinct VIIRS overpasses (then most days). The top 3 with reasons are logged before any simulation; the pick goes through `prep` and the frozen A+B sweep (blind, same gate and metrics).
- Chilecito and Córdoba would fail P2/P3 (sanity check, reported with the screen output).

## S6b results: EXPLORATORY 24 h re-initialised windows (15:19; all on Fir, A+B frozen)

`rekindle.hindcast --fire <f> --nonveg-max 50 --diurnal --windows 24 [--window-ignite own] --tag x_win24[own]_AB`; JSON in `docs/report/rekindle/<fire>_x_win24*_AB_windows.json`. Pooled median |Δ| over all windows' new pixels; per-window medians in brackets ("—" = median pixel never reached).

| fire / variant | best ×ROS | pooled median \|Δ\| | pooled median Δ | hit | n px | per-window median \|Δ\| at best × | gate |
|---|---|---|---|---|---|---|---|
| chilecito-2026 / x_win24_AB (restart) | 2.0 | 8.13 h | −7.94 | 0.91 | 640 | [6.5, 8.0, 10.5, 11.0, 0.4] | fail (3.21 h) |
| cordoba-2024 / x_win24_AB (restart) | 0.5 | 9.13 h | −9.13 | 0.95 | 897 | [5.4, 9.7, 22.2, 9.1, 10.4, 0.1] | fail (2.93 h) |
| cordoba-2024 / x_win24own_AB (own-time sensitivity) | 0.25 | 37.85 h | −36.28 | 0.88 | 897 | [4.4, 24.9, 60.3, 66.2, 47.0, 91.5] | fail |
| chilecito-2026 / x_win24own_AB | (job 4240230 running) | | | | | | |

- **Both fail.** Restarting every 24 h from the observed extent cuts the error (Chilecito 12.0 → 8.1 h, Córdoba 15.2 → 9.1 h) but not to the gate. Igniting earlier detections at their own times (no real restart) is far worse, as expected.
- **Why the floor:** many windows' medians barely move with the multiplier (Córdoba window 2: 9.7 h at every ×). New pixels next to the restart extent are reached within minutes, but the first overpass that sees them comes hours later (night gaps), so Δ ≈ −(time to the next overpass). Hotspot times are upper bounds; with a 24 h clock-based restart the metric is dominated by overpass timing rather than spread. Restarting at overpass times would reduce that, but it is a different (not pre-registered) protocol and is not run.
- Nothing ships from this; no counterfactuals.

## S6b free-spread pre-screen results (15:17; before any simulation of a candidate)

`uv run python -m rekindle.candidates --region {argentina,canada} --screen --top 300 --out docs/report/rekindle/candidates_<region>_screen.json` (thresholds exactly as pre-registered; seconds per region).

- **Sanity check:** Chilecito fails P1 (first pass spans 5.4 km), P2 (5.8 km by 3 h) and P3 (35→83 h grows 1.4 km); Córdoba fails P3 (no growth 46→94 h).
- **Argentina 2023–2026:** 1 of 300 windows passes. Fail counts: P3 plateau 287, P4 recurrence 208, P1 138, P2 136, P0 7.
- **Canada < 60°N 2023–2026:** 1 of 300 passes. Fail counts: P3 296, P1 200, P2 58, P0 7, P4 3.
- Multi-day plateaus are the norm, not the exception: free spread over 6 days is rare in FIRMS. That is itself a finding for REKINDLE.md.

**Top 3 (pick rule: passes all rules, then most distinct VIIRS overpasses; both regions screened before any simulation, so the rule is applied to the pooled set):**
1. **−105.882, 56.102, from 2023-05-11 (northern Saskatchewan)** — passes all; 58 VIIRS overpasses in the window, 74 passes in the 6-day run, R_final 16.5 km (inside the ±0.2° box), first pass 0.6 km across, 0.4 km by 3 h, steady growth (6 → 10.6 → 11.2 → 16.5 km), no activity in that box in other years. **Picked → `sask-2023`.** Caveat: another large fire burns ~50 km to the west; the bbox is the screen's ±0.2° box, so its detections are excluded.
2. −66.614, −30.618, from 2025-11-17 (La Rioja/San Juan) — passes all, but only 31 overpasses and R_final 6.2 km, barely above P0. Second blind test if time allows.
3. No third window passes. Nearest misses fail only P3 (e.g. −60.332, −23.968, 2024-06-03; −125.908, 53.352, 2024-08-02); they are not used.

## S6b result: `sask-2023` blind test (15:23; Fir job 4240797; A+B frozen, original protocol)

| fire | best ×ROS | median \|Δ\| | median Δ | hit | Sørensen | area km² | gate |
|---|---|---|---|---|---|---|---|
| sask-2023 (**blind**) | 4.0 (fast sweep edge) | 22.38 h | −17.25 | 0.78 | 0.72 | 463 | **fail** (1.67 h) |

- ×0.25–2.0 never reach most detected pixels (median |Δ| = inf); ×2.83 gives 27.1 h. The range was not extended.
- The spread profile (`figures/sask-2023_spread_profile.png`) shows the model now has the right *shape* (daily steps, no burst/stall mismatch) but runs behind the detections even at ×4. Sørensen 0.72 is the best of all runs.
- Likely reasons (not tested): MERRA-2 RH median 81 %, so the hourly 1-h dead moisture is 7–27 % (median 16.5 %), near or above extinction for the grass/shrub fuel models; a spring boreal fire probably ran in conifer crowns, which a surface model omits; the gate is very strict at 56°N (overpasses every 1.7 h).
- Shipped as a third `poor_agreement` baseline-only fire (export + spread profile). No grid, no counterfactuals.
- Second candidate (Argentina −66.614, −30.618, 2025-11-17) not run; time went to shipping.

## Handoff — S6b (final, 2026-11-15 ~15:30)

**Done**
- `main` (S7) merged into `s6b`. pytest 106 passed, vitest 60 passed, oxlint clean, `npm run build` OK. Rekindle tab and /methodology checked at desktop width and 390 px (no horizontal overflow; fire selector, spread chart, findings table render for all three fires).
- **Task 1:** Chilecito's shipped baseline = frozen A+B, by **rerunning `rekindle.hindcast --fire chilecito-2026 --nonveg-max 50 --diurnal` without `--tag` on Fir** (job 4234707): ×1.41, 12.04 h vs 3.21 h, `poor_agreement` (same as variant s6b_AB). Córdoba likewise (job 4234708): ×0.25, 15.16 h vs 2.93 h, shipped as a second baseline-only fire. S6 Chilecito report files renamed `chilecito-2026_s6_*`. `export.py` writes `model_settings`, `moisture` (hourly series) and `spread_profile` (CONTRACTS.md updated). New `rekindle.spread_profile` + `SpreadChart` (burst-and-stall figure) and `Findings` (gate, every variant with BLIND/EXPLORATORY tags, diagnosis, the 4 citations) on the Rekindle tab and /methodology. Status caption on every view.
- **Task 2 (EXPLORATORY):** `hindcast --windows 24 [--window-ignite own]` + `tests/rekindle/test_windows.py`. Restart windows: Chilecito 8.13 h (×2.0), Córdoba 9.13 h (×0.5); both fail. Own-time sensitivity: Córdoba 37.85 h. Nothing to decide: no window run passed.
- **Task 3:** `rekindle.candidates --screen` (thresholds pre-registered 15:16). 1/300 Argentina and 1/300 Canada windows pass. Picked `sask-2023` (58 overpasses): prep on the desktop, blind A+B sweep on Fir (job 4240797): ×4.0 (sweep edge), 22.38 h vs 1.67 h → fail. Shipped as a third baseline-only fire. No grid, so no what-if UI anywhere.

**Cut:** task 4 (cover-scaled fuel load, lapse-rate T2M); the second screened candidate (Argentina −66.614, −30.618, 2025-11-17); restart-at-overpass windows (not pre-registered).

**Still running:** Fir job 4240230 (Chilecito own-time windows, sensitivity only; not shown in the UI). If wanted: `scripts/fir.sh run 'cd ~/scratch/cf-ember-calendar && grep EXPLORATORY logs/rk-hindcast-4240230.out'` and copy `docs/report/rekindle/chilecito-2026_x_win24own_AB_windows.json` back (tar + get), then add the row to the windows table above.

**User actions**
- Deploy: `git push origin s6b:main` (s6b contains main; a fast-forward). Then re-test the deployed `/rekindle` and `/methodology`.
- Nothing needs a counterfactual decision: no fire, exploratory or blind, passed the gate.

**Fir access for a new session:** `scripts/fir.sh serve` in the background → approve the Duo push → `scripts/fir.sh run '<cmd>' | put <local-abs-win> <remote> | get <remote> <local>`. Checkout `~/scratch/cf-ember-calendar`, venv `~/scratch/rk-venv`, module `StdEnv/2023 python/3.12`, account `def-hngharti`. Run `git clean -fdq docs/report` there before `git pull`.

## Pre-registration — S6c burst-window what-ifs (2026-11-15, written before `sask-2023` windows are run)

User decision (after the S6b failures): save the what-if feature by running counterfactuals only for 24 h windows where the hindcast, re-initialised from the observed extent, matches the detections. **POST-HOC / EXPLORATORY.** The whole-fire pre-registered gate still fails for all three fires and stays shown.

- **Window qualifies** if, at its own best multiplier (chosen by window median |Δ|, ties by hit rate, as before): median |Δ| ≤ the fire's gate (mean overpass interval), **and** Sørensen ≥ 0.4, **and** ≥ 50 scored pixels. Multiplier fitted in-sample on that window (same as the whole-fire protocol: calibrated, not blind).
- Written after seeing the Chilecito and Córdoba window files (docs/report/rekindle/*_win24_AB_windows.json), so for those two it is post-hoc. By this rule Chilecito day 2 (t=24 h: 2.3 h, Sør 0.46, n 157) qualifies; Córdoba day 1 (3.2 h vs 2.93 h) does not (near miss). `sask-2023` windows have not been run; the rule is applied to it as is.
- **What-if axes, relative to the observed window conditions:** MERRA-2 wind speed ×{0, 0.5, 1, 1.5, 2} (direction unchanged), dead fuel moisture {−2, 0, +2, +4} percentage points on the diurnal series (floor 2 %). Live moisture, fuels, multiplier unchanged. Result shown: burned area at window end and the area difference vs the window baseline, plus the Rothermel head-rate ratio for the same perturbations.
- Wording: the model's response in a window where it matched the detections; not a reconstruction of the whole fire, and not a forecast.

## S6c results: burst-window what-ifs (2026-11-15; desktop, `rekindle.burst`; EXPLORATORY / post-hoc)

`uv run python -m rekindle.hindcast --fire sask-2023 --nonveg-max 50 --diurnal --windows 24 --tag x_win24_AB` (desktop, run after the pre-registration above): pooled 12.14 h at ×4.0 (sweep edge) vs 1.67 h → fail. Per-window Sørensen 0.55–0.91: the model gets the shape of each day's growth and runs behind (dead 1-h 14 %, near FM2's extinction moisture).

Window verdicts (own best multiplier; `docs/report/rekindle/<fire>_burst.json`):

| Fire | Qualifying | Near misses / notes |
|---|---|---|
| Chilecito | **day 2** (t=24 h, ×0.5): 2.27 h ≤ 3.21 h, Sør 0.456, n 157. Rerun reproduces the windows file exactly | day 5: 0.4 h but Sør 0.18 (over-burn ×4); the window baseline burns 242 km² vs 72 km² detection footprint (3.4×) |
| Córdoba | none | day 1: 3.23 h vs 2.93 h, Sør 0.53 |
| Saskatchewan | none | day 3: 1.75 h vs 1.67 h, Sør 0.82. Day 6 (t=120 h) passed the rule as written but is a **2 h tail** (detections end at 122 h) |

**Deviation (logged as it happened):** the rule excludes windows shorter than 24 h (clipped by the end of the detections). Found when sask's 2 h tail passed. The pre-registration says 24 h windows, and excluding the tail removes a what-if rather than adding a claim. Its 20 runs were made and then deleted; no what-ifs for sask.

Chilecito day-2 what-ifs (new area in 24 h vs the window baseline 231 km²): wind ×0 → ×0.74, ×0.5 → ×0.77, ×1.5 → ×1.28, ×2 → ×1.60; dead moisture +2 → ×0.84, +4 → ×0.73, −2 → ×1.09. Rothermel head-rate ratios (FM1, 1.6 m/s, 5.6 %): wind ×2 → ×2.7, +4 points → ×0.64. Areas respond less than head rate, because flank and back spread and the restart extent dominate a 24 h window.

UI: Rekindle tab gets a "Whole fire (hindcast) | Burst-window what-if (EXPLORATORY)" switch (only for fires with a qualifying window), a status caption stating the hindsight choice and the failed whole-fire gate, a ratio grid, and a "24 h window check" table on every fire. Findings (tab + /methodology) add "Equations or data?", the window table, the over-burn caveat on the 8–9 h windowed numbers, and FARSITE/Prometheus practice (Finney 1998; Tymstra et al. 2010). Wording: "the equations are verified; the failures point to inputs and missing processes, not the equations, but the model has not been shown to work over a whole fire". Claiming "the physics is right" would go further than the evidence.

## Handoff — S6c (2026-11-15)

Done: burst-window what-ifs (Chilecito day 2 only), window check on every fire, Findings rewrite, CONTRACTS `burst/`. pytest 108, vitest 60, ruff/oxlint clean, build OK, checked at 1280 px locally (390 px not checked: browser would not resize). Pushed to `main` (fast-forward from `s6b`). Next: check the deployed `/rekindle` (both views, all three fires) and `/methodology`, including phone width.

## S6d — Saskatchewan whole-fire footprint what-ifs (2026-11-15; user decision; EXPLORATORY, shape only)

The user asked for what-ifs on `sask-2023` because its shape looked right. It did not pass any gate (whole fire 22.4 h vs 1.67 h, signed median −17.2 h; best ×4 = sweep edge), so this goes **outside the gate rule, at the user's request**, and is labelled "shape only: read where, not when". The basis is the footprint match: Sørensen 0.72, 463 km² simulated vs 348 km² detection footprint (1.3×), with per-window Sørensen 0.55–0.91. Entry condition coded in `rekindle.shape_whatif`: whole-fire Sørensen ≥ 0.6 (Chilecito 0.17 and Córdoba fail it).

Design: frozen baseline (calibration.json: A+B, ×4, 122 h, hourly MERRA-2 wind and diurnal moisture), wind speed ×{0, 0.5, 1, 1.5, 2}, dead moisture {−6, −4, −2, 0, +2} points. Shifted toward drier because the observed fuels (dead 1-h 14 %) sit near FM2's extinction moisture, so damper runs stall at once. Output: `burst/index.json` → `shape`, rasters in `burst/shape/`. UI: a third view, "Footprint what-if (SHAPE ONLY)".

S6d results (desktop, 1627 s): baseline rerun 22.38 h / Sør 0.721 = calibration exactly. Final footprint vs the baseline 463 km²: calm ×0.26, wind ×0.5 → ×0.40, ×1.5 → ≥×2.31, ×2 → ≥×3.91; dead −2 → ×2.08, −4 → ≥×3.50, +2 → ×0.39. 11 of 25 runs reached the domain edge (burnable 2372 km²), flagged `domain_limited` from the exported rasters and shown as "≥" lower bounds.

## S6e — three more fires for the Rekindle demo (2026-11-15, ~17:50 Toronto; written before any run of these fires)

User request: flesh out the demo with 2–3 more fires. Picked from the S6b screen output (`candidates_*_screen.json`): `bc-2024` (fails only P3; 1815 detections, 79 passes, R 25 km; 50 km domain), `larioja-2025` (the second window passing every rule; R 6.2 km), `chaco-2024` (fails only P3; 129 detections, sparse). They are demo fires, not a new blind test of the timing claim, but the frozen A+B model and **all rules apply unchanged**: whole-fire gate; S6c burst-window rule (incl. the ≥ 24 h tail exclusion); S6d footprint what-ifs only if whole-fire Sørensen ≥ 0.6. A fire passing none ships baseline-only with its window table. Fir: two Duo pushes timed out (user away), so everything runs on the desktop. Cut order if late: chaco, then larioja.

## S6e results and S6f — shape-only window what-ifs (2026-11-15 ~18:00; user asked to "model any part")

S6e (Fir jobs 4255620–24 + desktop): whole fire bc-2024 ×2.0, 41.7 h vs 1.76 h, Sør 0.47; larioja-2025 ×0.25 (edge), 17.1 h vs 3.28 h, Sør 0.15 (floods the domain, 528 vs 46 km²); chaco-2024 ×0.25 (edge), 61.1 h vs 4.91 h, Sør 0.58. Windows: bc 7.15 h at ×4, chaco 12.45 h, larioja 7.60 h; all fail. **No S6c window and no S6d footprint qualifies** (chaco 0.58 < 0.6, not relaxed). All three shipped baseline-only with window tables.

S6f rule (post-hoc, written before these runs): a fire with **no other what-if view** gets one shape-only 24 h window, the window with the highest Sørensen (at its timing-best multiplier) that has Sørensen ≥ 0.6, ≥ 50 scored pixels and a full 24 h. Candidates: bc-2024 day 3 (0.674, n 264, 8.6 h), cordoba-2024 day 5 (0.651, n 303, 10.4 h). larioja/chaco have none (too few pixels). Same axes as S6c. Label: "shape-only window: the footprint matched, the timing did not".

S6f results (desktop): bc-2024 day 3 (start 2024-08-04 05:09 UTC, ×1.0) rerun 8.57 h / Sør 0.674 = windows file; 102 km² simulated vs 79 km² detected. Wind ×2 → ×2.23 newly burned, calm → ×0.52, +4 points → ×0.43. cordoba-2024 day 5 (2024-09-23 19:42 UTC, ×0.5) rerun 10.42 h / 0.651; 224 vs 111 km² (over-burns 2×). Wind ×2 → ×2.56, calm → ×0.49. UI: "Window what-if (SHAPE ONLY)" with its own caption; Findings add the three fires and the shape-only window rule.

## Handoff — S6e/S6f (2026-11-15 ~18:30)
Six fires on the Rekindle tab. What-if views: Chilecito burst window (timing rule), Saskatchewan whole-fire footprint, BC day 3 and Córdoba day 5 shape-only windows. La Rioja and Chaco are hindcast-only. Fir bridge was used for S6e (jobs 4255620–24). Next: deploy (user pushes `s6b:main`), check the deployed `/rekindle` for all six fires and phone width.

## S6g/S6h — a second reference: MCD64A1 burned area (2026-11-15, ~18:45–19:10; user decision)

`rekindle.burned_area`: MCD64A1 v061 (500 m, monthly) per fire, burn day in [first detection day − 1, run end + 7 d] (burn dates lag under cloud), compared **inside the fire bbox** (where hotspots were collected; a first pass over the whole domain wrongly penalised the hotspots, corrected). Hotspots vs burned area agree only at Sørensen 0.31–0.66 (Chaco 0.12; MCD64A1 sees 2 km²), and the first-detection day matches the burn day within ±1 d for 30–74 % of pixels. Model vs burned area: Chilecito 0.61 (ceiling 0.66), Córdoba 0.32, Saskatchewan 0.26, BC 0.33, La Rioja 0.07, Chaco 0.10. Fair-interval timing (zero if the arrival falls between the previous overpass and the detection) cuts the median error by only 0.5–8 h.

User decision: the final submission is the only one, so the analysis adopts both references. Shape is judged against hotspots and burned area (with the inter-reference ceiling); timing against hotspots with the fair interval. Earlier gates and numbers stay as logged and shown. UI: green MCD64A1 outline on every Rekindle map, "Judged against two satellite references" on every fire, Findings "Two references, not one answer key", MCD64A1 credit (Giglio et al. 2018/2021). Not done (time): recalibrating the multiplier to burned-area shape, which is the stated next step.

## Pre-registration — S6i shape calibration against MCD64A1 (2026-11-15 ~19:10; user: ignore the freeze, use the cluster)

- **Objective:** choose the ROS multiplier per fire by **Sørensen(model, MCD64A1) inside the fire bbox** (burn day in [first detection − 1 d, run end + 7 d]); tie-break by fair-interval timing vs hotspots. Wider sweep: ×{0.125, 0.18, 0.25, 0.35, 0.5, 0.71, 1, 1.41, 2, 2.83, 4, 5.66, 8} (two fires sat at the old edges). Frozen A+B model otherwise.
- **Reported per fire:** shape score, the ceiling (hotspots vs MCD64A1), shape/ceiling ratio, Sørensen vs hotspots, raw and fair-interval timing, burn-day agreement.
- **Shape-validated** (new label, not the old timing gate) if shape/ceiling ≥ 0.7 **and** ceiling ≥ 0.3 (a reference pair agreeing less than that can't judge anything). Shape-validated fires get whole-fire footprint what-ifs (S6d design) on the shape-calibrated baseline. The timing gate result stays reported; no fire is called timing-validated.
- The shape-calibrated baseline becomes each fire's shipped hindcast; the timing-calibrated numbers stay in Findings. Window views (S6c/S6f) stay as they are (timing-calibrated windows), labelled as such.

## S6i results (in-box) and amendment S6i-b (2026-11-15 ~19:40; before the rerun)

In-box shape calibration (Fir jobs 4264264–69): Chilecito ×0.5 (0.62/0.66 = 0.94, "validated"), Saskatchewan ×2.83 (0.31/0.31), BC ×1.0 (0.39/0.52 = 0.75), Córdoba ×0.25 (0.54 ratio), La Rioja ×0.125 (0.28), Chaco ×0.125 (ceiling 0.12). **Flaw found:** the in-box score saturates. Chilecito's box (21 % of the domain) is fully burned from ×0.71 up, and at ×0.5 the model burns 770 km² in the domain vs 276 km² in the box. Whole-domain Sørensen vs MCD64A1 at the in-box best multipliers: Chilecito 0.28, Córdoba 0.22, Saskatchewan 0.16, BC 0.33, La Rioja 0.11, Chaco 0.24. For the four Argentine fires all MCD64A1 burn lies inside the box anyway (≤ 2 km² outside), so the box only hid over-burn. For Saskatchewan and BC, MCD64A1 maps 295 and 46 km² outside the box (partly other fires).

**S6i-b (replaces the in-box objective):** compare over the **whole domain**, against **fire-connected MCD64A1**: burned patches (8-connected, 90 m grid) that touch this fire's hotspot footprint dilated by 1 km. Ceiling = Sørensen(hotspots, fire-connected MCD64A1) over the domain. Same sweep, objective, tie-break and thresholds (ratio ≥ 0.7, ceiling ≥ 0.3). All 13 arrival maps are saved per fire. `rekindle.burned_area` (reference.json, Findings table) switches to the same definition.

## S6i-b results (Fir jobs 4266304–10; 2026-11-15 ~20:10) and handoff

Shape-best (whole domain, fire-connected MCD64A1): Chilecito ×0.125 (edge) 0.30 / ceiling 0.66 = 0.46; Córdoba ×0.125 (edge) 0.30/0.59 = 0.50; Saskatchewan ×2.83 0.22/0.25 (ceiling < 0.3, can't judge); **BC ×1.0 0.38/0.53 = 0.72 → shape validated**; La Rioja ×0.125 (edge) 0.11/0.39; Chaco ×0.125 0.26/0.12 (can't judge). Timing at the shape multipliers: Chilecito median pixel never reached (inf), Córdoba 76.6 h, Saskatchewan 27.1 h, BC 48.2 h, La Rioja 46.2 h, Chaco 72.3 h. The timing-calibrated runs scored the same way: 0.20, 0.22, 0.19, 0.32, 0.06, 0.10. Shape fitting gains +0.04–0.16 and costs a lot of timing.

Promoted: `rekindle.promote_shape` makes the shape-calibrated run each fire's shipped hindcast (status shape_validated / shape_poor; old files `calibration_timing.json`, `baseline_timing.npy`). BC whole-fire footprint what-ifs (`shape_whatif`, desktop 891 s): baseline rerun 48.2 h / Sør hot 0.556 matches; wind ×2 → ×2.89, calm → ×0.57, −6 pts → ×2.43, +2 pts → ×0.63; 2 of 25 runs reach the domain edge. The entry rule of `shape_whatif` is now status shape_validated (the Saskatchewan S6d view stays as a labelled developer exception on its ×4 timing run). Saskatchewan's S6d what-ifs were not rerun.

Fix: Python wrote `Infinity` into three web JSON files (unreached timings), which browsers can't parse. `export.web_safe` now converts inf/nan to null for every web JSON write, and all files were validated.

Wording change (user decision): the baseline caption reads "calibrated to its satellite-mapped burned area" for shape-calibrated fires (CLAUDE.md's "calibrated to its detections" is kept for timing-calibrated runs). MCD64A1 is described as a "second, partly independent reference" (same MODIS instrument, different measurement). Results and wording for the presentation: `docs/REKINDLE_RESULTS.md`.

Next: user deploys `s6b:main`, checks the deployed `/rekindle` (six fires; BC footprint view) and `/methodology`, and updates `docs/SUBMISSION.md` claims (still says "validated against hotspot timestamps").

Observation (map, S6i-b baseline): Chilecito at ×0.125 spreads north-east with the MERRA-2 wind (from ~245°), while the MCD64A1 burn and the hotspots lie south-west of the ignition. The wind direction was likely wrong at the fire (~50 km reanalysis, terrain winds). Not tested; added to Findings as an observation.

## UI changes after user review (2026-11-15 ~20:50)
Hidden from the fire picker (`index.json` `hidden`): larioja-2025, chaco-2024 (kept in Findings). No whole-fire view (`whole_fire: false`): chilecito-2026, cordoba-2024 (open on their window what-if). MCD64A1 outline: toggle, default off; exported as burn day (minutes from the run start to 00:00 UTC of the burn day) so it grows with the clock. Saskatchewan outline vs hotspots mismatch = the low ceiling (0.24), not a bug. `export.py` keeps extra index keys on re-export.

## Rekindle UI simplification (user review, 2026-11-15 ~21:00)
Whole-fire panel cut to: status caption, big play bar, "what you are seeing", burned area chart, one-line match summary linking to /methodology, collapsed model/data credits. Removed from the tab (kept on /methodology and in REKINDLE_RESULTS.md): metrics table, two-reference block, spread chart, findings, window-check table. Legend moved to a map overlay (calendar style) with the MCD64A1 toggle. Shared `Controls.tsx` (TimeBar, RkLegend). Retired the old validated-grid what-if state in RkLoaded.

UI (user review ~21:10): sask-2023 shows only its footprint view (`whole_fire: false`, no switcher); bc-2024 drops the day-3 window view (`burst_window: false`) → "Hindcast" + "Footprint what-if"; play button says "Simulate" (Pause while running, Continue mid-way).
Correction (user): bc-2024 keeps its day-3 window simulation as the first tab, "Hindcast / window" (`whole_fire: false`, window view default), plus "Footprint what-if". The whole-fire BC hindcast tab is not shown.
Copy (user): Rekindle what-if panels rewritten in plain language: tabs "24-hour simulation" / "Whole fire (shape)"; captions say what is shown and that only part of the fire is simulated; "Why only part of the fire?" / "What this shows" dropdowns without statistics, linking to /methodology. Unused WindowScreen table deleted.

Methodology page (user, ~21:45): two parts with a contents box. Part 1 Harmonization: method (k defined) → seam → LOYO → k factors → seasonality → "What the tests show" → limitations → downloads. Part 2 Rekindle (new `methodology/RekindleMethod.tsx`): what it does → the model (Rothermel equation and terms, ellipse, level-set, moisture, verification) → data used (cited table) → how a fire is run → how we judge it (timing error, fair interval, Sørensen, ceiling, pass marks) → results (Findings) → limitations. Part 2 renders even if the validation files fail to load.
