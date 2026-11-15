# Global build — report (2026-11-15)

Global run of the pipeline into `D:\ember`, the missing years and 2026 added, checked locally in the real app, then uploaded to the data host. Numbers below are copied from the logs and the JSON files (`D:\ember\interim\logs\`, `D:\ember\processed\`), not estimated.

## Timeline (America/Toronto)

| time | event |
|---|---|
| Sat 22:53 | Base build starts (separate process): ingest → clean → fcd → cubes → points → manifest. Old code, so no calibrate/validate. |
| Sun 03:27 | fcd done (440 s). Ingest took 1,710 s, clean 14,316 s (~4 h). |
| 03:31 | The three FIRMS 2026 Archive Download zips arrive in `data/raw/` (from the user). |
| 03:46 | cubes done (1,126 s). |
| 04:11 | points (1,408 s) and manifest done, `report:` written, exit 0. Report and manifest backed up as `interim/logs/{build_report,manifest}_base.json`. |
| 04:12 | `--add` (S-NPP 2022, NOAA-20 2024, three 2026 zips) starts at the default 10 GB DuckDB limit. |
| 04:14 | **Claude Code stops the `--add` run because the machine is critically low on memory.** Another agent's `rekindle.verification_report` was running at the same time. All 5 sources were ingested and MODIS 2026 was cleaned. Log kept as `D:\ember\add_stdout_attempt1.txt`. |
| — | With the user's OK, the same `--add` is restarted with `DUCKDB_MEMORY_LIMIT=6GB`. The process was suspended for low memory and resumed. Its first log line is at 10:20. Re-running is safe: each source's staged files and each sensor-year's cleaned output are deleted before being rewritten. |
| 10:20 → 10:59 | `--add`: ingest + clean 10 min, fcd 1 min, cubes 791 s, points 811 s, manifest 68 s, calibrate 29 s, validate 6 s. Exit 0. |
| 11:00 → 11:03 | Local smoke test in the real app (headless Chrome over CDP), all checks pass. |
| 11:03 → 11:42 | `sync_data.sh` to the HF dataset, host check OK. |
| 11:44 | Deployed site checked on global data: world, Chilecito hero (Jul 2026), methodology "Global", 0 errors. |

No pipeline code was changed. No crash, no stall.

## Base build (before `--add`)

From `interim/logs/manifest_base.json` / `build_report_base.json`:

- **Rows (cleaned):** MODIS 102,650,215 · VIIRS_SNPP 217,300,771 · VIIRS_NOAA20 108,965,425.
- **Cleaning per sensor, raw → kept** (counts only go down): MODIS Aqua 71.74 M → 67.12 M; Terra 39.68 M → 35.53 M; S-NPP 263.98 M → 217.30 M; NOAA-20 133.42 M → 108.97 M. Most of the drop is the type and confidence rules. The SP/NRT and static rules removed 0 rows. That's expected: the yearly country files are SP only, and the static rule only applies to rows without `type` (NRT). In the 2026 add it does apply (MODIS Aqua 2026: 2,106,211 → 2,082,850).
- **sizes_mb:** cubes 118.14, points 5,738.67.
- **Files:** 7,822 in `processed/`, of which 407 cube files and 7,414 points files.
- **Tiles:** 406. **dekad_range:** [30, 935], i.e. 2000-11-01 → 2025-12-31.
- **L10 global cube:** 11,788,500 B = **11.2 MiB, under the 25 MiB Pages limit.**
- Missing as expected: S-NPP 2022, NOAA-20 2024, all of 2026.

## Inputs added

| file | content | coverage |
|---|---|---|
| `VIIRS_SNPP/viirs-snpp_2022_all_countries.zip` | yearly country file (SP) | 17,164,365 rows ingested |
| `VIIRS_NOAA_20/viirs-jpss1_2024_all_countries.zip` | yearly country file (SP) | 22,511,092 rows ingested |
| `MODIS/DL_FIRE_M-C61_850592.zip` | Archive Download, world | **SP 2026-01-01 → 08-31** (2,302,480 rows), **NRT 09-01 → 11-15** (804,343) |
| `VIIRS_NOAA_20/DL_FIRE_J1V-C2_850593.zip` | Archive Download, world | **SP 2026-01-01 → 07-31** (9,559,961), **NRT 08-01 → 11-15** (7,500,734) |
| `VIIRS_SNPP/DL_FIRE_SV-C2_850594.zip` | Archive Download, world | **SP 2026-01-01 → 07-31** (8,859,653), **NRT 08-01 → 11-02** (6,602,259) |

The 2026 zips are the Archive Download format (one `fire_archive_*.csv` + one `fire_nrt_*.csv` per sensor, not split by country). This is the same format as the Argentina fixture's 2026 files, and ingest already handles it (SP/NRT is read from the member name). SP and NRT don't overlap in any of the three, so dedupe has nothing to remove. **S-NPP ends on 2026-11-02**, matching `manifest.snpp_end`. The coverage matches what DECISIONS.md expected. Nov 15 is a partial day in MODIS and NOAA-20 NRT.

## Final build (after `--add`)

- **Rows (cleaned):** MODIS 105,420,695 · VIIRS_SNPP 243,785,210 · VIIRS_NOAA20 141,349,262 (total 490.6 M = points rows).
- 2026 cleaning, raw → kept: MODIS Aqua 2,166,246 → 1,993,006; Terra 940,577 → 777,474. 2026 FCD: MODIS 2,599,456, NOAA-20 8,862,063, S-NPP 7,934,641.
- **sizes_mb:** cubes **132.34**, points **6,555.81** (7,805 files, 490,555,167 rows).
- **Files:** 8,242 in `processed/` (434 cube files, 7,805 points files, 3 JSON). calibration.json 240 kB, validation.json 19.5 kB, manifest 15.4 kB.
- **Tiles:** 433. **dekad_range:** [30, 967], i.e. 2000-11-01 → 2026-11-20 (last dekad partial). `points.years` 2000–2026.
- **L10 global cube:** 13,177,659 B = **12.6 MiB, under 25 MiB.** L01 cubes total 119.8 MB.

## Science numbers (global) vs the Argentina fixture

**Global k by month** (MODIS → VIIRS-equivalent, ratio of sums over 2013–2021, with band):

| Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.86 [2.82, 2.91] | **3.30** [3.23, 3.38] | 3.26 [3.19, 3.35] | 2.99 [2.94, 3.03] | 2.91 [2.85, 2.98] | 2.46 [2.44, 2.48] | **2.45** [2.42, 2.48] | 2.64 [2.54, 2.75] | 2.74 [2.68, 2.78] | 2.98 [2.95, 3.03] | 2.94 [2.88, 2.99] | 2.60 [2.56, 2.66] |

- Range **2.45 (Jul) … 3.30 (Feb)**; fixture 1.92 (Sep) … 2.58 (Mar). Bands are narrow (widest Aug, ±0.1).
- **Tile k** (tile-months with ≥ 200 MODIS FCD, n = 1,911, 281 tiles in calibration.json): p5 / p50 / p95 = **1.727 / 3.006 / 6.667**; fixture 1.68 / 2.35 / 3.11 (n = 60).
- **k_N20** by month: 0.984, 1.009, 0.972, 0.982, 0.979, 0.967, **0.863 (Jul)**, 0.943, 0.994, 0.992, 0.956, 0.992 → range **0.863 … 1.009**; fixture 0.88 … 1.03, also lowest in July.

**LOYO** (fit years 2013–2021; r_log / MdAPE / bias_log):

| level | calibrated FCD | FCD, k = 1 | count ratio | raw counts, k = 1 |
|---|---|---|---|---|
| global (1 series, 108 months) | 0.9835 / 2.47 % / −0.0018 | 0.9432 / 64.86 % / −1.0427 | 0.9887 / 2.38 % / −0.0009 | 0.9672 / 75.89 % / −1.4125 |
| tile (395 series, 25,681 months) | 0.9626 / 18.36 % / −0.3441 | 0.9610 / 71.29 % / −1.3807 | 0.9578 / 18.33 % / −0.3223 | 0.9600 / 78.88 % / −1.6817 |
| *fixture global* | *0.994 / 6.2 % / −0.02* | *0.993 / 56.7 % / −0.83* | *0.996 / 6.6 % / +0.01* | *0.995 / 71.2 % / −1.25* |
| *fixture tile (9)* | *0.971 / 15.8 % / −0.24* | *0.978 / 59.9 % / −1.01* | *0.968 / 16.8 % / −0.21* | *0.980 / 72.4 % / −1.37* |

(Tile MdAPE is over 21,448 months for FCD and 21,742 for counts: months with a zero reference are left out.)

**Does "a detection-count ratio calibrates about as well as FCD + k" hold globally? Yes.** Global MdAPE 2.38 % (count ratio) vs 2.47 % (FCD + k); tile 18.33 % vs 18.36 %. The difference is ≤ 0.1 pp at both levels; on the fixture it was 0.4 pp and 1.0 pp, in favour of FCD. The methodology page picks the same wording on global data: "On monthly sums, a simple detection-count ratio calibrates about as well as fire-cell-days + k (median error 2.4 % vs 2.5 %)." Without calibration both are far off again (FCD 65 % / 71 %, counts 76 % / 79 %). The tile-level calibrated bias is still negative and slightly larger than on the fixture (−0.34 vs −0.24).

**Seam test** (mean log difference to MODIS-only, 24 months each side of 2012; before = raw spliced, after = harmonized):

| scope | before → after | step: MODIS only / raw spliced / harmonized | sparse |
|---|---|---|---|
| global | **1.0111 → −0.0298** | −0.021 / 0.991 / −0.050 | no (332,617 MODIS FCD/month) |
| 10° tile S30W070 (contains Chilecito) | **0.6301 → −0.0060** | 0.031 / 0.661 / 0.025 | no (3,359/month) |
| Chilecito 25 km | 0.4954 → 0.4683 | 0.311 / 0.806 / 0.779 | **yes** (0.4/month) — not meaningful |

Fixture: global 0.80 → −0.002, tile 0.71 → 0.013, Chilecito 0.52 → 0.51 (sparse).

**Seasonality:** median r **0.909** (IQR 0.786–0.970) over 224 tiles (≥ 12 FCD/yr); fixture 0.89 (0.68–0.97) over 8 tiles.

## Local smoke test (global data, real app)

`EMBER_DEV_DATA_DIR=D:/ember/processed npm run dev` (port 5191), fresh headless Chrome profile over CDP (Node 22 `WebSocket`, `--remote-debugging-port`), 1280×900, cache disabled, worker network captured via `Target.setAutoAttach`. The dev server was stopped by its port afterwards.

- **World view at 1°:** density ready in 1.9 s.
- **Countries** (wall time from select to calendar + At-a-glance; worker time from the panel's meta line):

  | country | resolution | cells | files | worker | wall | Nov 1–10 2026 headline |
  |---|---|---|---|---|---|---|
  | Brazil | 1° (large area) | 703 | 1 | 47 ms | 0.9 s | Normal, 25,021 vs median 26,561 |
  | Australia | 1° | 698 | 1 | 33 ms | 0.9 s | Above normal, 29,416 vs 22,551 |
  | Canada | 1° | 1,693 | 1 | 115 ms | 0.9 s | Normal, 1,369 vs 1,705 |
  | Central African Rep. | 0.1° | 5,055 | 4 | 309 ms | 0.9 s | Above normal, 7,784 vs 4,072 |
  | Dem. Rep. Congo | 0.1° | 18,970 | 9 | 948 ms | 1.5 s | Above normal, 3,928 vs 1,944 |
  | India | 0.1° | 27,848 | 15 | 700 ms | 1.3 s | Below normal, 8,119 vs 21,987 |
  | Argentina | 0.1° | 27,865 | 11 | 587 ms | 1.2 s | Normal, 1,965 vs 2,585 |

  Every calendar's latest dekad is 2026-11-11…20, so 2026 is live everywhere.
- **Zoomed-in viewport (zoom ≥ 4, no AOI, 0.1° tiles in view):** I fitted the map to a circle and then cleared the AOI. Central Africa (22° E, 6° N, fitted to a 1,300 km radius): 0.1° density ready in **1.0 s**, including 7 newly fetched L01 tiles (2.9 MB; the other tiles in view were already in the worker cache). Mato Grosso, Brazil (same radius): 0.6 s. At a 1,700 km radius the view covers > 16 tiles and correctly falls back to the 1° cube. **The S2 risk (16 dense 0.1° tiles render too slowly) did not show up.**
- **Methodology page:** "Data in this build: **Global** — global (433 10° tiles with activity). Record 2000-11-01 to 2026-11-20 …". The regional banner is gone.
- **0 console errors/warnings, 0 failed requests** across the whole run.

## Upload

**Uploaded and live.** `HF_DATASET_REPO=Incandescent-Turtle/cf-ember-calendar-data scripts/sync_data.sh D:/ember`, 11:03 → 11:42, exit 0. Points went up one commit per year (2000–2026), then cubes + calibration/validation JSON, then the manifest last. `manifest.points` = 2000–2026, 433 tiles.

- `check_host.sh` (run by the script): **host OK**. On an L01 cube, the L10 cube and a points file: Range → 206 with Content-Range, CORS on GET, preflight allows Range on both hops, HEAD Content-Length, no Content-Encoding.
- The live manifest at `…/resolve/main/manifest.json`: built_at 2026-11-15T15:58:24Z, dekad_range [30, 967], 433 tiles.
- **https://cf-ember-calendar.pages.dev/**, checked in a fresh headless Chrome profile over CDP. No Pages rebuild was needed (same URL).
  - World view at 1°: ready in 1.9 s.
  - **"Try: Chilecito"** → 0.1°, 74 cells, 1 file, 239 ms. At-a-glance: "Busiest month on record: **Jul 2026, 101 FCD**", the same as the fixture at 50 km, so the hero still shows the July 2026 fire. Nov 1–10 2026 = 4 FCD vs a median of 1 ("Extreme", with the low-numbers caveat from S4).
  - `/methodology`: "Data in this build: **Global** — global (433 10° tiles with activity). Record 2000-11-01 to 2026-11-20 …".
  - **0 console errors/warnings, 0 failed requests.**
- Every fixture file on the host was overwritten by its global version: each fixture tile is also a global tile.

## Problems

- **Memory-pressure stop (04:14):** the first `--add` ran at the same time as another agent's Rekindle job on this 16 GB machine. The restart used `DUCKDB_MEMORY_LIMIT=6GB` and finished. The process was suspended for about 6 h before it resumed, which explains the 04:14 → 10:20 gap. Lesson for the remaining sessions: don't run DuckDB pipeline jobs while Rekindle jobs run, or keep the limit at 6 GB.
- No pipeline bugs found; no code changed.
- The 25 km Chilecito seam scope in `validation.json` is still `sparse` (0.4 MODIS FCD/month). The page already flags it as "too sparse for the seam test".

## For you to decide

1. **Downloadable global harmonized table?** The data host now holds the inputs (per-sensor FCD cubes), the factors (`calibration.json`) and the evidence (`validation.json`). The browser applies k per area, and per-area CSV export exists. There is no ready-made global harmonized file, e.g. harmonized FCD per 1° cell or per country per month. **Recommendation:** if the submission wants a "harmonized dataset" link, add a small `pipeline` step that writes monthly harmonized FCD per 1° cell from the L10 cube + global/tile k (a few MB, Parquet + CSV) and ship it on the HF dataset. Otherwise, describe the cubes + calibration.json as the dataset on the project page. It's cheap, but it's new code before the 20:00 freeze, so it's your call.
2. **Memory discipline for the rest of the day:** run DuckDB jobs and Rekindle jobs one at a time (recommended), or keep `DUCKDB_MEMORY_LIMIT=6GB` in `.env` for D:\ember work.
3. **Raw zips in Downloads:** the two 2022/2024 copies in `Downloads` duplicate `data/raw` (≈ 700 MB). Safe to delete; I haven't touched them.
4. **DECISIONS.md:** I didn't edit it (another agent is active). The next session should add a one-line pointer to this file and update the S3 "Next" list (done: `--add`, 2026, global upload).
