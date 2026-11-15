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
