# CLAUDE.md — cf-ember-calendar

Instructions for coding agents working in this repo. Read this first, then the doc for the area you're touching.

## What we're building (one paragraph)

A web app for the **NASA Space Apps 2026 challenge "Harmonization of MODIS and VIIRS Hot Spots."** It harmonizes NASA FIRMS active-fire hotspots from MODIS (2000→) and VIIRS (2012→) into one consistent global time series, then shows a **burning activity calendar** (years × months) for any user-selected area, with anomalies vs the historical median, critical periods, and CSV export. On top sits **Rekindle**, a fire-spread simulator (level-set + Rothermel). It **hindcasts** a real past fire with that fire's real weather, tunes one spread-rate multiplier against the fire's own hotspot timestamps, then runs **what-if counterfactuals** (different wind, fuel moisture). It is an *illustrative* tool, not a forecast (see Rekindle wording below).

**Deadline: Sunday 2026-11-15, 23:59 (America/Toronto). Feature freeze: Sunday 20:00.** Solo developer + agents.

## Architecture in five lines

1. **No server, no API.** Heavy work runs offline; the app is a static site.
2. **Pipeline** (Python) runs on an **Alliance cluster** (fixtures on the desktop) and writes sparse **cube files** (fire-cell-days per 0.1° / 1° cell per dekad), points, and calibration/validation JSON.
3. The **React SPA** lives on **Cloudflare Pages**; the data files live on a separate static **data host** chosen after the first size report (`docs/ARCHITECTURE.md`; default Hugging Face dataset, or inside Pages if small). The browser fetches the tiles an area needs and computes the calendar itself in a Web Worker.
4. **Rekindle** runs offline on the desktop/cluster over a scenario grid; outputs are small static rasters shipped with the SPA.
5. Every format is specified in `docs/CONTRACTS.md`. Change the contract and the code together.

## Doc map

| Doc | Read when |
|---|---|
| `docs/CONTRACTS.md` | Reading or writing any shared file format; time axis, grids, series ids |
| `docs/AGENT_BRIEFS.md` | Starting work on a track (pipeline / web / Rekindle) |
| `docs/PRODUCT.md` | Deciding what to build, acceptance criteria, what's cut |
| `docs/ARCHITECTURE.md` | Where things run, hosting, the browser data layer, risks |
| `docs/DATA.md` | Ingest, schemas, FIRMS quirks, cluster notes |
| `docs/HARMONIZATION.md` | The science core: cleaning, fire-cell-days, calibration, validation |
| `docs/REKINDLE.md` | The simulator: Rothermel, ellipse, level-set, scenario grid, validation |
| `docs/BUILD_PLAN.md` | What to do next, in order |
| `docs/SUBMISSION.md` | Judging criteria mapping, demo video script, project page |

## Working mode: one agent at a time

The user runs a single agent session at a time. Work through `docs/BUILD_PLAN.md` **sessions in order**; each session names the doc sections to read and its done-criteria. Read only those docs, not all of them. Long jobs (cluster arrays, scenario grids) run in the background while the next session proceeds. Finish with a short handoff note in `docs/DECISIONS.md` (what's done, what's next, anything surprising).

## Priorities (in order — never invert)

1. **Harmonized calendar works end to end for a drawn area, globally, deployed at a public URL.** This is the challenge. Everything else is secondary.
2. Validity evidence: the methodology page with the 2012 seam before/after chart and leave-one-year-out metrics.
3. CSV export (calendar + summary; hotspots with caps).
4. Anomaly view, critical periods, current-month-vs-median.
5. Rekindle on 1–2 precomputed demo fires.
6. Polish (globe projection, animations, extra overlays).

If time is short, cut from the bottom. A finished #1–#3 beats a half-finished #1–#6.

## Do NOT build

- **Any server, API, database, queue, or job runner in production.** If a feature seems to need one, precompute it or cut it.
- A live solver in the browser or anywhere else. Rekindle results are precomputed.
- User accounts, simulation queue, stop/restart, auto-ingest, streaming anomaly detection.
- Arbitrary-fire Rekindle, free-drawn firebreaks/ignitions (a fixed scenario grid replaces them).
- Environmental overlays beyond what Rekindle needs.
- ADR or FMM simulators (post-hackathon course work; keep the `Simulator` interface pluggable).

## Stack

- **Python 3.12**, `uv`. Packages: `pipeline/`, `rekindle/` (one workspace). **DuckDB** + **Parquet**; **Polars** where clearer. Never load a full global year into memory.
- **NumPy/SciPy** for Rekindle (`numba` only if the solver is too slow). `rasterio` for rasters. `scikit-fmm` only for level-set reinitialization (`skfmm.distance`).
- **Web:** React + Vite + TypeScript (strict), **MapLibre GL JS**, **ECharts**, `@turf/turf`, Terra Draw, Zustand, TanStack Query, `fflate` or `DecompressionStream`, `d3-contour`, a Parquet reader (`hyparquet` or DuckDB-WASM, see ARCHITECTURE.md).
- **Hosting:** Cloudflare Pages (SPA + Rekindle outputs). Data host is swappable via `VITE_DATA_BASE_URL`: Hugging Face dataset, R2, or a Google Cloud Storage bucket (decision rule in ARCHITECTURE.md).

## Conventions

- All times UTC; dates `YYYY-MM-DD`. Time axis = dekads (CONTRACTS.md).
- Coordinates WGS84, **[lon, lat]** order in code and GeoJSON. Bboxes `west,south,east,north`.
- Sensor/series names exactly as in CONTRACTS.md. Harmonized unit = **fire-cell-day (FCD), VIIRS-equivalent**. In UI copy never say "fires": say "hotspot activity (VIIRS-equivalent fire-cell-days)" with a tooltip.
- **Rekindle wording.** Baseline = "hindcast of a real fire, calibrated to its detections". Counterfactuals and absolute timings = "illustrative". Never write "forecast", "predicts" or "prediction" in UI or docs as a present capability; "toward prediction" is allowed only as roadmap. Show the status caption on every Rekindle view. A fire whose baseline fails the quality gate (`docs/REKINDLE.md` §5) ships no counterfactuals.
- Every number shown in the UI is traceable: tooltip shows raw MODIS, raw VIIRS, k used and its stratum.
- Python: type hints, `ruff`, `pytest`. TS: strict, ESLint.
- Config via env vars, documented in `.env.example`. Secrets (`FIRMS_MAP_KEY`, Earthdata, bucket/HF tokens) never committed and never in the browser bundle.
- `data/` is gitignored. Only tiny fixtures go in `tests/fixtures/`. `web/public/rekindle/**` is generated but committed (small).
- The Python and TS implementations of harmonization/analytics are checked against `tests/golden/*.json` (generated by Python, never hand-edited).

## Commands (keep updated as things land)

```bash
uv sync
uv run python -m pipeline.inspect <file>          # look at real data before writing a parser
uv run python -m pipeline.build_all --fixture     # small local build → data/processed
uv run python -m pipeline.build_all --data-dir "$SCRATCH/ember"   # on the cluster, via scripts/slurm/*.sh
uv run python -m pipeline.build_all --data-dir D:/ember --steps calibrate,validate   # on an existing build
uv run python -m pipeline.build_all --data-dir D:/ember --add --inputs <zip> ...    # add sources incrementally
uv run python -m pipeline.make_golden             # regenerate golden test files (needs the fixture build)
HF_DATASET_REPO=<user>/<name> scripts/sync_data.sh D:/ember [--no-points]   # upload to the data host
uv run python -m pipeline.export_global --data-dir D:/ember --out data/exports   # global monthly 1° harmonized table (~45 s)
HF_DATASET_REPO=<user>/<name> scripts/sync_data.sh D:/ember --exports data/exports --exports-only   # upload it + list it in the manifest
scripts/check_host.sh <VITE_DATA_BASE_URL>        # CORS + Range check on the data host
uv run python -m rekindle.scenario_grid --fire chilecito-2026 --workers 8
uv run python -m rekindle.verification_report --out docs/report/rekindle   # solver/Rothermel numbers + figures (~2 min)
uv run python -m rekindle.hotspots --fire chilecito-2026    # a curated fire's detections → docs/report/rekindle
uv run python -m rekindle.hindcast --fire <id> --tag <variant> [--nonveg-max 50] [--diurnal] [--wind nearest] [--seed-h 3]   # S6b variants (seed = exploratory)
uv run python -m rekindle.fuel_cover --fire <id>             # add MOD44B non-vegetated % to domain.npz (prep does this for new fires)
uv run python -m rekindle.input_check                        # observed spread vs Rothermel at our inputs (free-spread pre-screen)
uv run python -m rekindle.burst --fire <id> --workers 6   # S6c burst-window what-ifs (needs <id>_x_win24_AB_windows.json) → web/public/rekindle/<id>/burst
uv run python -m rekindle.candidates --region argentina|canada   # candidate fires from D:/ember points (read-only)
# Fir (Alliance): cd ~/scratch/cf-ember-calendar; REKINDLE_VENV=~/scratch/rk-venv sbatch --account=def-hngharti scripts/slurm/rekindle_hindcast.sh <fire> <tag> [opts]
#                 ... sbatch --account=def-hngharti --array=0-N scripts/slurm/rekindle_grid.sh <fire>
uv run pytest
cd web && npm i && npm run dev                    # serves /dev-data from data/processed, falling back to web/mock-data
cd web && npm run mock                            # regenerate web/mock-data (contract-format mock cubes + JSON)
cd web && npm test && npm run build               # build → web/dist (Pages)
```

## How to verify your work

- Pipeline: run on the fixture first; print row counts at every stage (counts only go down through cleaning); cube writer/reader round-trip; the manifest reports real sizes.
- Harmonization: `validation.json` contains LOYO metrics (calibrated vs uncalibrated vs raw counts) and the seam series. Report numbers, don't assume them.
- Web: golden tests pass; check at 1280 px and a narrow width; every colour ramp passes a CVD simulation; test on the **deployed** URL, not only localhost.
- Rekindle: Rothermel unit tests against published reference values first; solver tests on uniform fuel/no wind must give a circle growing at R0.

## Gotchas

- FIRMS VIIRS `confidence` is a letter (`l`/`n`/`h`); MODIS `confidence` is 0–100. Don't mix.
- FIRMS files can contain both science (SP) and near-real-time (NRT) rows for recent periods: dedupe so a detection isn't counted twice.
- The FIRMS Suomi NPP VIIRS stream stopped on 2026-11-02; after that the VIIRS series continues from NOAA-20 (cross-calibrated). Terra's orbit has drifted and it had a standby event on 2026-03-26, so calibration is fit only on 2013–2021 (HARMONIZATION.md).
- **Cluster:** on several Alliance clusters compute nodes have no internet. Download on the login node (or data-transfer node); process in Slurm jobs against local disk; build the Python venv on the login node. Filesystems have file-count quotas, so write few large files. Scratch is purged periodically — keep results in project space.
- **The desktop has 16 GB RAM.** Keep DuckDB `memory_limit` ≤ 10 GB there. The laptop has little free disk — use fixtures locally.
- Pages files are limited to 25 MiB each; anything big goes on the data host. Check the data host's CORS and `Range` handling before blaming the app.
- Facts in the docs were written from memory. **Verify against primary sources/real data; the source wins; log deviations in `docs/DECISIONS.md`.**
