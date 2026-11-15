# BUILD_PLAN.md — Sat 18:45 → Sun 23:59 (America/Toronto)

**One agent session at a time.** Each session = one paste of a brief from `AGENT_BRIEFS.md` (tracks A pipeline, B web, C Rekindle) plus the doc sections listed here. Long jobs (cluster arrays, scenario grids) run in the background while the next session proceeds. Times are targets, not promises; the checkpoints are hard.

**Hard checkpoints**
- **Sun 08:00** — public URL on Cloudflare Pages showing a harmonized calendar from real data for at least Argentina.
- **Sun 20:00** — feature freeze. Only fixes, copy, video, submission after this.
- **Sun 22:30** — submission complete. Last 90 minutes are buffer.

---

## S0 — Setup (you, no agent; Sat 18:45–20:00)
- [ ] Public repo `cf-ember-calendar`; commit docs; `uv init`; `web/` Vite scaffold.
- [ ] **Hello-world deploy (≤ 60 min):** Pages project from the repo + one test file on the chosen data host (Hugging Face is the quickest) fetched with `Range: bytes=0-99` from the deployed page. This de-risks CORS and hosting (ARCHITECTURE.md → Deployment).
- [ ] FIRMS MAP_KEY; Earthdata login.
- [ ] Cluster: `hostname`; free space and file-count quota (project vs scratch); do compute nodes have internet (assume no); venv **on the login node** (`duckdb polars pyarrow numpy scipy`).
- [ ] **On the login node, start downloads** (`scripts/fetch_firms.sh` in `tmux`): MODIS, VIIRS S-NPP, VIIRS NOAA-20 yearly archives. Request 2026 data (email arrives later).
- [ ] Desktop: Argentina-only files → `tests/fixtures/`.

## S1 — Pipeline on the fixture (Track A items 1–4, 6, 7; Sat 20:00–00:00)
Read: DATA.md, HARMONIZATION.md §cleaning/FCD, CONTRACTS.md. Run `inspect.py` on real files first and fix DATA.md. Deliver ingest → clean → FCD → cubes/points on the Argentina fixture, `build_all --fixture`, then Slurm scripts. **Launch the global arrays on the cluster before ending the session.**
Done: pytest passes; fixture data dir exists; global jobs submitted.

## S2 — Web scaffold, data layer, calendar (Track B items 1–4; Sun 00:00–04:00)
Read: PRODUCT.md Tier 1, ARCHITECTURE.md (browser data layer), CONTRACTS.md. Mock-data generator first; switch to the fixture output when available. Calendar renders from cubes in the Worker.
Done: calendar for a drawn area on fixture data; `npm run build` passes.
Status (2026-11-15): done, including the F4 map layers (per-cell density in the selected window, linked to calendar clicks; hotspot points from Parquet for windows ≤ 1 year). The At-a-glance panel and export from Track B item 4 moved to S4 (they need S3's golden files and points-hosting decision).
*Sleep window ~04:00–06:00 while cluster jobs run.*

## S3 — Calibration, validation, upload (Track A item 5 + upload; Sun 06:00–08:00)
Read: HARMONIZATION.md §calibration/validation. `calibrate`, `harmonize`, `validate`, `make_golden`; check global jobs; upload cubes + JSON; `manifest.json`; report total points size → decide points hosting.
Done: `calibration.json`, `validation.json` with LOYO table and seam series exist for the real data.
Status (2026-11-15, 02:00): code, tests and golden files done; fixture end to end done (calibration + validation in `data/processed`, dev server off the mocks). Host chosen (Hugging Face dataset; public-file CORS/Range test passed). **Still open:** the global build (local, ETA ~08:00), then `--add` for S-NPP 2022 + NOAA-20 2024, `--steps calibrate,validate` is included in `--add`, then `sync_data.sh` (logged in; dataset `Incandescent-Turtle/cf-ember-calendar-data` is live with the fixture). **Deployed at https://cf-ember-calendar.pages.dev/ and checked; the 08:00 checkpoint is met on Argentina data.** See the S3 handoff in DECISIONS.md.

## S4 — Real data, analytics, deploy v0 (Track B items 3–5; Sun 08:00–11:00) — **checkpoint**
Harmonize + analytics in TS against golden files; At-a-glance panel; export; methodology page; deploy with the real `VITE_DATA_BASE_URL`. Check the deployed URL from a fresh profile.
Checklist (carried over from S2 — Track B item 4; see the S2 handoff in DECISIONS.md):
- [x] TS harmonize/analytics vs `tests/golden/*.json`: k exact; reconcile the k-band bootstrap and percentile rule (S2 choices) with Python.
- [x] **At-a-glance panel (F3):** current month-to-date vs the same dekads in baseline years (ratio, percentile, label), top 3 years / months, busiest month, critical period, Theil–Sen + Mann–Kendall trend.
- [x] **Export (F5):** calendar CSV (columns in PRODUCT F5; all fields are in `MonthRow`), summary JSON, calendar PNG (ECharts `getDataURL`). Hotspot CSV can reuse `web/src/data/points.ts` (it already reads/filters the Parquet points) — caps + FIRMS link; may slip to S7 as planned.
- [x] Methodology page (renders `validation.json`).
- [x] Deploy; on the **deployed** URL check: MapLibre worker asset loads (`.mjs` served as JS), cubes load from the data host, and points either load (host must allow CORS + `Range`) or are hidden. If points aren't hosted for some years/tiles, `manifest.points` must say so — the map reads it.
Done: checkpoint met (if not, stop adding features and fix this first).
Status (2026-11-15, ~03:30): done on the Argentina fixture, including the hotspot CSV (capped). Deployed and checked; see the S4 handoff in DECISIONS.md. The global data swap is still pending (S3 open items).

## S5 — Rekindle engine (Track C items 1–2; Sun 11:00–13:30)
Read: REKINDLE.md §1–3. `rothermel.py` + `fuels.py` (verify constants against sources), `ellipse.py`, `levelset.py` with the five solver tests. Needs no FIRMS data, so it can run earlier if S1–S4 stall on cluster waits.
Done: all solver tests pass. **✓ Done 2026-11-15** (handoff in DECISIONS.md; report material in `docs/report/rekindle/`).

## S6 — Rekindle fires, grid, panel (Track C items 3–5, then Track B item 6; Sun 13:30–18:00)
Read: REKINDLE.md §4–7, CONTRACTS.md (Rekindle files), DECISIONS.md S5 handoff + addendum. **First (≈ 15 min): three solver tests S6 relies on** — slope (head runs upslope at Rothermel R_head), wind shift (head follows a 90° turn), ROS multiplier (×2 ⇒ arrival times exactly ÷2); optional fuel-interface and determinism tests. **Needs `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` in `.env`** (MCD12Q1, MERRA-2 with the GES DISC app authorized). Prep Chilecito first: inspect the real hotspots, baseline, multiplier, quality gate; then scenario grid (desktop, background); build the web panel against the exported runs. Add the other two curated fires only if time remains.
Done: Chilecito baseline metrics reported; grid exported; panel loads a run in < 1 s with the correct status caption.

## S6b — Fix the Chilecito hindcast, then other fires (Sun 12:10 →; branch `s6b`)
- [x] Pre-registered changes A (MOD44B cover), B (diurnal moisture) and C (nearest wind), each alone and combined: all fail the gate (best 12.0 h vs 3.2 h). Logged in DECISIONS.md.
- [x] Córdoba 2024 blind test with A+B frozen: fails (15.2 h vs 2.9 h). Exploratory seeded start on Chilecito: 9.6 h, fails.
- [x] Diagnosis (`rekindle.input_check`): the inputs are sane; both fires burst and then stall, which a free-spread model cannot represent. Literature added (REKINDLE.md §5b).
- [x] Ship Chilecito (A+B) and Córdoba as `poor_agreement` hindcasts, with the burst-and-stall figure and the citations in the Rekindle tab and methodology.
- [x] EXPLORATORY 24 h re-initialised windows (REKINDLE.md §5b) on both fires (Fir): both fail (Chilecito 8.1 h, Córdoba 9.1 h).
- [x] Free-spread pre-screen → blind test on a new fire (Argentina, then Canada < 60°N): 2 of 600 windows pass; `sask-2023` blind fails (22.4 h vs 1.67 h), shipped baseline-only; no grid.
- [ ] Optional exploratory inputs: cover-scaled fuel load, lapse-rate T2M. **Cut** (time; see S6b handoff).

## S7 — Polish and freeze (Sun 18:00–20:00)
- [x] Hotspot CSV export with caps and the FIRMS fallback link (done in S4).
- [x] 1280 px layout; CVD check (calendar ramp, map density ramp, sensor colours); captions on every chart; Rekindle wording check (CLAUDE.md). (S7 handoff in DECISIONS.md; also: traceable map-cell tooltip.)
- [x] Optional (priority 6): bundle split (main chunk 2.16 MB → 66 kB) and dekad-of-year calendar sub-view done. **Satellite basemap toggle cut:** EOX's current licence page puts EOxCloudless under CC BY-NC-SA 4.0 (commercial licence otherwise) and doesn't confirm a CC-BY 2016 layer.
- [x] Downloadable global harmonized table (`pipeline.export_global`; not yet uploaded, see S7 handoff).
- [ ] Re-test on the **deployed** URL in a fresh profile — done read-only at ~12:40 on the *current* deploy (pre-Rekindle `main`: 0 errors, no overflow at 1280/390). Repeat after merging and deploying this branch. **20:00 feature freeze.**

## S8 — Ship (you + agent; Sun 20:00–22:30)
- [ ] Bug bash (Chrome + Firefox, incognito).
- [ ] 30 s video (script in SUBMISSION.md), captions on, ≤ 29 s.
- [ ] README final: screenshots, live link, how it works, data list, limitations.
- [ ] Project page on spaceappschallenge.org; repo public; test every link from incognito.
- [ ] Optional polish: free GoDaddy domain pointed at the Pages site.

## If behind, cut in this order
1. Land-cover calibration strata → global + tile only.
2. Hotspot CSV export → link to FIRMS Archive Download only.
3. `recent.json` snapshot and provisional styling.
4. Extra Rekindle fires → Chilecito only.
5. Rekindle grid → baseline + 3 hand-picked counterfactuals (wind ×2, direction flip, drier fuels).
6. Rekindle entirely → statistical counterfactuals (F11) + a recorded clip marked "in progress".

Never cut: harmonized calendar for an arbitrary AOI, calendar CSV export, methodology seam chart, the deployed link, the video.
