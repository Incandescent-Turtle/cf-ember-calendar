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

## S4 — Real data, analytics, deploy v0 (Track B items 3–5; Sun 08:00–11:00) — **checkpoint**
Harmonize + analytics in TS against golden files; At-a-glance panel; export; methodology page; deploy with the real `VITE_DATA_BASE_URL`. Check the deployed URL from a fresh profile.
Checklist (carried over from S2 — Track B item 4; see the S2 handoff in DECISIONS.md):
- [ ] TS harmonize/analytics vs `tests/golden/*.json`: k exact; reconcile the k-band bootstrap and percentile rule (S2 choices) with Python.
- [ ] **At-a-glance panel (F3):** current month-to-date vs the same dekads in baseline years (ratio, percentile, label), top 3 years / months, busiest month, critical period, Theil–Sen + Mann–Kendall trend.
- [ ] **Export (F5):** calendar CSV (columns in PRODUCT F5; all fields are in `MonthRow`), summary JSON, calendar PNG (ECharts `getDataURL`). Hotspot CSV can reuse `web/src/data/points.ts` (it already reads/filters the Parquet points) — caps + FIRMS link; may slip to S7 as planned.
- [ ] Methodology page (renders `validation.json`).
- [ ] Deploy; on the **deployed** URL check: MapLibre worker asset loads (`.mjs` served as JS), cubes load from the data host, and points either load (host must allow CORS + `Range`) or are hidden. If points aren't hosted for some years/tiles, `manifest.points` must say so — the map reads it.
Done: checkpoint met (if not, stop adding features and fix this first).

## S5 — Rekindle engine (Track C items 1–2; Sun 11:00–13:30)
Read: REKINDLE.md §1–3. `rothermel.py` + `fuels.py` (verify constants against sources), `ellipse.py`, `levelset.py` with the five solver tests. Needs no FIRMS data, so it can run earlier if S1–S4 stall on cluster waits.
Done: all solver tests pass.

## S6 — Rekindle fires, grid, panel (Track C items 3–5, then Track B item 6; Sun 13:30–18:00)
Read: REKINDLE.md §4–7, CONTRACTS.md (Rekindle files). Prep Chilecito first: inspect the real hotspots, baseline, multiplier, quality gate; then scenario grid (desktop, background); build the web panel against the exported runs. Add the other two curated fires only if time remains.
Done: Chilecito baseline metrics reported; grid exported; panel loads a run in < 1 s with the correct status caption.

## S7 — Polish and freeze (Sun 18:00–20:00)
- [ ] Hotspot CSV export with caps and the FIRMS fallback link.
- [ ] 1280 px layout; CVD check (calendar ramp, map density ramp, sensor colours); captions on every chart; Rekindle wording check (CLAUDE.md).
- [ ] Optional (priority 6): satellite basemap toggle (light stays default; EOX Sentinel-2 cloudless 2016 = CC-BY, or Esri World Imagery — check terms, add the host to the allowed network calls); bundle split (main chunk ~2 MB); dekad-of-year calendar sub-view.
- [ ] Re-test on the **deployed** URL in a fresh profile. **20:00 feature freeze.**

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
