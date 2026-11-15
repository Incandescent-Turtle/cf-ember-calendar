# AGENT_BRIEFS.md — one brief per track

Run **one agent session at a time**, in the order in `docs/BUILD_PLAN.md` (sessions S1–S6 name which track items to do). Paste the relevant track section, tell the agent to read `CLAUDE.md` first, and have it read only the docs the session lists. The three tracks are separated by `CONTRACTS.md`, so any session can start without the others being finished.

**Rules for every agent**
- `CLAUDE.md` + `CONTRACTS.md` are the contract. If you must deviate, update `CONTRACTS.md` in the same commit and append a line to `docs/DECISIONS.md` (create it) saying what, why, and who is affected.
- Constants and formulas in the docs were written from memory. **Verify them against the primary source or the real data; the source wins.** Log every discrepancy in `docs/DECISIONS.md`.
- Don't build anything in CLAUDE.md's "Do NOT build" list.
- Commit small and often. Tests must pass before you say you're done.
- Don't touch another track's directory except to fix an interface bug, and then say so.
- End every session by appending a handoff note to `docs/DECISIONS.md`: done, next, surprises.

---

## Track A — Pipeline (`pipeline/`, `scripts/`, `tests/pipeline`)

**Where it runs:** fixture builds on the desktop; the full global build on the Alliance cluster.
**Read:** `CLAUDE.md`, `docs/DATA.md`, `docs/HARMONIZATION.md`, `docs/CONTRACTS.md`.

**Deliver, in this order**
1. `pipeline/inspect.py` — prints columns, dtypes, and value counts (`satellite`, `confidence`, `type`, `version`, date range) for one file of each sensor. **Run it on real downloads before writing the parser**, and update `docs/DATA.md` with what is actually there.
2. `ingest.py` + `clean.py` — FIRMS files → unified hotspots Parquet (DATA.md schema), streaming with DuckDB. Log row counts per sensor-year before and after each cleaning rule.
3. `grid.py` (+ `time.ts` partner, per CONTRACTS) and `fcd.py` — 0.01° fire-cell-days per day, then dekad sums into L01 and L10.
4. `cubes.py` — cube writer and reader with a round-trip test; `points.py` — points writer.
5. `calibrate.py`, `harmonize.py` (reference implementation), `validate.py` — the outputs in CONTRACTS.md. `make_golden.py` for the golden files.
6. `build_all.py` with `--fixture` (small, local) and `--data-dir` (cluster). Write `manifest.json` with real row counts and sizes.
7. `scripts/slurm/*.sh` (job arrays over sensor-year), `scripts/fetch_firms.sh` (login-node downloads), `scripts/sync_data.sh` (upload to the chosen data host: rclone or huggingface-cli), `pipeline/nrt_snapshot.py`.

**Done when:** `uv run pytest` passes; `uv run python -m pipeline.build_all --fixture` writes a data dir the web track can serve; the manifest prints total cube and points sizes; the validation file contains the LOYO table and seam series.

**Constraints:** stream everything — set `memory_limit` from `DUCKDB_MEMORY_LIMIT`; never load a full year into memory. **Compute-node jobs must not need internet**; downloads are separate login-node scripts. Few large output files, not many small ones (cluster file-count quotas). Output only under `DATA_DIR`.

---

## Track B — Web (`web/`)

**Where it runs:** desktop dev; deploys to Cloudflare Pages.
**Read:** `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`.

**Deliver, in this order**
1. Scaffold: Vite + React + TS, MapLibre, Zustand, TanStack Query, ECharts; `VITE_DATA_BASE_URL`.
2. **Mock data first:** `web/scripts/make_mock_data.ts` writes contract-format cube files, `manifest.json`, `calibration.json`, and `validation.json` for a few tiles, so the real decoder is exercised from hour one. Switch to the pipeline's fixture output as soon as it exists.
3. Data layer (`src/data/`): fetch → gunzip → decode cubes in a **Web Worker**; AOI → tiles → cells → series; harmonize + analytics in `src/lib/` against `tests/golden/*.json`.
4. UI per PRODUCT.md Tier 1: AOI tools, calendar heatmap with the four view modes and tooltips, At-a-glance panel, map layers, export (calendar CSV, summary JSON, PNG, hotspots CSV with caps).
5. Tier 2: anomaly view, seasonality chart, methodology page (renders `validation.json`).
6. Rekindle panel (needs Track C's output; build against a hand-made sample run first).

**Done when:** `npm run build` succeeds; tests pass; with real data a country-size AOI renders a calendar in the target time; the app works with `VITE_DATA_BASE_URL` pointing at the data host; CVD check done on every ramp; 1280 px layout is clean.

**Constraints:** no server code, no secrets in the browser, no network calls except to `VITE_DATA_BASE_URL` and the basemap tiles. Every number shown must be traceable in a tooltip (raw MODIS, raw VIIRS, k and its source stratum).

---

## Track C — Rekindle (`rekindle/`, `tests/rekindle`)

**Where it runs:** desktop (CPU); optionally a cluster job array for the scenario grid.
**Read:** `CLAUDE.md`, `docs/REKINDLE.md`, `docs/CONTRACTS.md` (Rekindle files).

**Deliver, in this order**
1. `rothermel.py` + `fuels.py` with unit tests against published reference values. **Verify every constant against Rothermel 1972 / Albini 1976 / Andrews 2018 and every fuel-model value against Anderson 1982** before moving on; log discrepancies.
2. `ellipse.py`, `levelset.py` with the five solver tests in REKINDLE.md (circle, ellipse, merge, barrier, convergence).
3. `prep.py` (takes any lat/lon + dates; curated list in `rekindle/fires.yaml`): **inspect the real hotspots first to find the Chilecito July 2026 cluster**, then one more Argentine and one Canadian fire with many overpasses (REKINDLE.md §4). Build domain rasters and `meta.json`.
4. Baseline hindcast, ROS multiplier calibration against hotspot arrival times, metrics (`metrics.py`), the quality gate and `status` field (REKINDLE.md §5). Counterfactuals only for fires that pass.
5. `scenario_grid.py` — runs the grid in CONTRACTS.md with `multiprocessing`; `export.py` — writes `u16.gz` rasters + index files to `web/public/rekindle/`.
6. Optional: a weather-swap scenario (fire A's weather on fire B's terrain).

**Done when:** all solver tests pass; the baseline run reports timing error and hit rate; the grid exports and the web track can load a run; total export size is within budget.

**Constraints:** surface fire only; follow the Rekindle wording rules in CLAUDE.md (hindcast / illustrative, never "forecast"); state limitations in `meta.notes`; no live solver in production; keep the `Simulator` protocol so ADR/FMM can be added later for the GEOE 443 report.
