<!--
Draft replacement for the top-level README.md. Apply after the running Rekindle agent finishes.
Fixes vs the current README: drops cut what-ifs (firebreaks, moving the ignition point), adds MCD64A1,
adds the live link and numbers. Keep the MERRA-2, MCD12Q1, MOD44W, MOD44B and Copernicus credit strings
from the current README word for word under "Data and credits" (they were checked against each dataset page).
The three images (docs/img/*.png) don't exist yet; capture them from the live app
(or use docs/report/rekindle/figures/bc-2024_baseline_map.png for Rekindle).
Delete this comment when applying.
-->
# Ember Calendar — with Rekindle

**25 years of fire, one consistent record.**
NASA Space Apps Challenge 2026 · *Harmonization of MODIS and VIIRS Hot Spots*

**[Live app](https://cf-ember-calendar.pages.dev/)** (soon also at embercalendar.earth) · [30-second demo](VIDEO_URL) · [Data on Hugging Face](https://huggingface.co/datasets/Incandescent-Turtle/cf-ember-calendar-data) · [Project page](PROJECT_PAGE_URL)

![Calendar for Chilecito, La Rioja](docs/img/calendar.png)

MODIS (2000 → retiring) and VIIRS (2012 → present) see fire differently, so their raw hotspot records can't be compared: spliced together, every region's history jumps in 2012. Ember Calendar harmonizes 490 million NASA FIRMS detections into one VIIRS-equivalent global record and shows a **burning activity calendar** for any area you draw. It shows which months and years burn most, the critical period, the trend, and how this month compares with the historical median. Everything exports to CSV.

**Rekindle** replays real fires with a Rothermel surface-spread model on a level-set front. It is judged against two satellite references, the fire's hotspots (timing) and MODIS burned area MCD64A1 (shape), and shows illustrative what-ifs (wind, fuel moisture) only where the model meets a pre-set rule.

## How the harmonization works
1. **Clean:** vegetation fires only, low-confidence detections dropped, static sources masked, science/near-real-time duplicates removed.
2. **Common unit:** *fire-cell-days*, the distinct 0.01° cells with fire on each day. This removes most of the effect of pixel size and overpass count.
3. **Calibrate:** MODIS × k → VIIRS-equivalent, with k per region and month fit on 2013–2021 (ratio of sums, bootstrap band). The app uses the most local k with enough data: your area, its 10° tile, then global. NOAA-20 is cross-calibrated to Suomi NPP the same way.
4. **Validate:** leave-one-year-out error 65 % → **2.5 %** (global, monthly); 2012 seam step 1.01 → **−0.03**; seasonality before/after 2012 r = 0.91 (median over 224 tiles). Full results on the in-app Methodology page.
5. **Explore:** the browser fetches only the tiles an area needs and computes the calendar in a Web Worker. No server.

![Seam chart](docs/img/seam.png)

## Rekindle results
Six real fires (Argentina and Canada, 2023–2026). The pre-registered timing test failed on all six, and we report it. One fire (British Columbia 2024) is shape validated against burned area. See `docs/REKINDLE_RESULTS.md` and the app's Findings panel.

![Rekindle, British Columbia 2024](docs/img/rekindle.png)

## Data and credits
| Dataset | Used for |
|---|---|
| NASA FIRMS MODIS C6.1, VIIRS 375 m (Suomi NPP, NOAA-20) | the harmonized record; Rekindle ignition and timing |
| MCD64A1 v061 | Rekindle shape reference |
| MCD12Q1 v061, MOD44B v061, MOD44W v061 | Rekindle fuels and water |
| MERRA-2 M2T1NXSLV | Rekindle wind and fuel moisture |
| Copernicus DEM GLO-30 | Rekindle slope |

(Full citation strings: `rekindle/credits.py`.)

## Run locally
```bash
uv sync && uv run pytest
uv run python -m pipeline.build_all --fixture   # small local build → data/processed
cd web && npm i && npm run dev                  # serves the fixture build
```

The global build runs on an HPC cluster (`scripts/slurm/`). See `CLAUDE.md` → Commands and `docs/ARCHITECTURE.md`.

## Limitations
Hotspots are not fires or burned area. Calibration assumes a stable MODIS–VIIRS relationship, and values before 2012 can't be checked against VIIRS. Bands cover calibration uncertainty only. Rekindle is surface fire only (no crowning, spotting or suppression), with fuels from 500 m land cover. Its what-ifs are illustrative, not forecasts.

## Docs
`docs/HARMONIZATION.md` · `docs/REKINDLE.md` · `docs/REKINDLE_RESULTS.md` · `docs/ARCHITECTURE.md` · `docs/CONTRACTS.md` · `docs/DATA.md` · `docs/submission/`

## License
Code: MIT. Global harmonized table: CC BY 4.0.
