# Project description (paste into the rich-text field)

Notes in *[italic brackets]* mark where an image or GIF goes, or a value to confirm. Delete them after pasting. The headings point to the judging criteria without naming them (see `criteria.md`).

---

## Ember Calendar: 25 years of fire, one consistent record

**Live app:** https://cf-ember-calendar.pages.dev/ (soon also at embercalendar.earth) · **Code:** *[GitHub URL]* · **Demo:** *[video URL]* · **Data:** https://huggingface.co/datasets/Incandescent-Turtle/cf-ember-calendar-data

*[HERO GIF, 6–8 s: draw an area around Chilecito, the calendar fills in, hover July 2026 to show the tooltip.]*

Ember Calendar merges NASA's MODIS and VIIRS active-fire hotspots into one continuous global record, from November 2000 to today. It turns that record into a burning activity calendar for any area you draw. On top of it, **Rekindle** replays real fires with a physics model and shows how a fire might have behaved under different conditions.

### Why this matters now

Since 2000, MODIS on NASA's Terra and Aqua satellites has built the longest global record of active fires. Both satellites are near the end of their missions. VIIRS has carried the record since 2012, but it doesn't see fire the way MODIS does:

| | MODIS (Terra, Aqua) | VIIRS (Suomi NPP, NOAA-20) |
|---|---|---|
| Pixel at nadir | ~1 km | 375 m |
| Small or cool fires | often missed | often detected |
| Record | Nov 2000 → ending | Jan 2012 → present |

For the same burning, VIIRS records 2.5 to 3.3 times as much activity as MODIS, depending on the month. Splice the raw records together and every region's fire history jumps in 2012, for reasons that have to do with the instrument, not with fire. As Marina Compagnucci of CONAE says in the challenge video, without a way to compare them, "almost 10 years of historical information will be lost." The handover is already under way: Suomi NPP's FIRMS stream stopped on 2 November 2026, and our record continues from NOAA-20.

Early-warning and emergency teams need to know whether this month's activity is unusual for *this* area, and when the area's critical season starts. Fire weather is projected to become more common and more intense, so that question will be asked more often.

*[IMAGE: Methodology page seam chart, 2008–2016, raw spliced vs harmonized. The step at 2012 and the line that removes it.]*

### What we built

The challenge has two parts, and the project follows them:

1. **A harmonized global hotspot record** in which the sensor of origin no longer matters. 490 million cleaned detections from 2000–2026 become one series in a single unit, with an uncertainty band and published validation.
2. **A web app** that turns the record into a burning activity calendar for any area on Earth, with anomalies against the historical median, the critical period, trends, and CSV export.
3. **Rekindle**, which goes further: it uses the harmonized hotspots as the answer key for a fire-spread model, then runs "what if" scenarios on real fires.

### How the harmonization works

**1. Clean.** We use NASA FIRMS science-quality archives for MODIS Collection 6.1 and VIIRS 375 m (Suomi NPP and NOAA-20), plus near-real-time data for recent weeks. We keep vegetation fires only, drop low-confidence detections, mask static hot sources such as gas flares, and remove rows that appear in both the science and near-real-time files. Row counts are logged at every stage and only go down, ending at 490.6 million cleaned detections.

**2. A common unit: fire-cell-days.** A single fire produces many more VIIRS pixels than MODIS pixels, and the two missions pass overhead a different number of times a day. So we don't count detections. We count **fire-cell-days (FCD)**: the number of distinct 0.01° cells (about 1 km) with at least one detection on a given day. Several VIIRS pixels in one cell, or several passes in one day, count once. What remains is mostly the sensitivity difference, and step 3 calibrates that.

**3. Calibrate MODIS to VIIRS-equivalent.** For each region and calendar month, we fit a factor k on the 2013–2021 overlap, when both sensors were stable:

```
k[region, month] = Σ_years Σ_cells VIIRS FCD  /  Σ_years Σ_cells MODIS FCD
```

*[If the form renders LaTeX or you paste an image of it:* `k_{s,m} = \frac{\sum_{years}\sum_{cells \in s} \text{VIIRS FCD}}{\sum_{years}\sum_{cells \in s} \text{MODIS FCD}}` *]*

A ratio of sums is robust to the many zero months. The factors vary a lot: globally from 2.45 (July) to 3.30 (February), and across 10° regions from 1.7 to 6.7 (5th–95th percentile). So one global number would be wrong almost everywhere. The app uses the most local factor with enough data: the drawn area itself, then its 10° tile, then the global month. A bootstrap over the overlap years gives each factor an uncertainty band. NOAA-20 is cross-calibrated to Suomi NPP the same way (k = 0.86 to 1.01), so the record stays continuous after Suomi NPP stopped.

**4. Assemble one series.** MODIS × k until February 2012, Suomi NPP until November 2026, NOAA-20 × k after that. Every switch falls on a 10-day boundary (dekad). The raw series are kept alongside, so the app can show what harmonization changed.

**5. Validate.** We held out each overlap year in turn, fit k on the others, and estimated that year's VIIRS activity from MODIS alone:

| Leave-one-year-out test, 2013–2021 | Global monthly error (median) | Regional monthly error (median, 395 tiles) | Global bias (mean log ratio) |
|---|---|---|---|
| Raw detection counts, no calibration | 75.9 % | 78.9 % | −1.41 |
| Fire-cell-days, no calibration | 64.9 % | 71.3 % | −1.04 |
| **Fire-cell-days, calibrated (ours)** | **2.5 %** | **18.4 %** | **−0.002** |

The 2012 seam test compares the 24 months either side of the switch. The step falls from **1.01 to −0.03** (mean log difference) globally, and from 0.63 to −0.01 in the 10° tile around Chilecito. The shape of the fire season also survives: the median monthly cycle before 2012 (harmonized MODIS) and after it (VIIRS) correlates at a median r = 0.91 across 224 regions.

We also report what didn't help. On monthly sums, a plain detection-count ratio calibrates about as well as fire-cell-days with k (2.4 % vs 2.5 % globally). We keep fire-cell-days because the unit has a fixed physical meaning, a 1 km cell burning on a day, and stays the same when satellites are added or orbits drift. And no test can prove the 2001–2011 values, because VIIRS didn't exist then. The tests show that k is stable across years and that the record is continuous at the switch. The Methodology page in the app says so.

### The calendar

*[SCREENSHOT: calendar for Chilecito or Argentina, with the At-a-glance panel.]*

- **Pick any area:** draw a rectangle or polygon, enter a point and radius, or pick a country. A country-sized area loads in 0.9–1.5 s.
- **Burning activity calendar:** years (2000–2026) by months, coloured by harmonized activity. Switch to MODIS raw, VIIRS raw, or raw-vs-harmonized side by side to see the 2012 jump and its fix. A 10-day view shows finer seasonality.
- **At a glance:** this month so far against the same 10-day periods in past years, with a percentile and a label (Below normal, Normal, Above normal, Extreme). Also the area's critical period (the shortest run of months holding 60 % of a typical year's activity), the trend (Theil–Sen slope with a Mann–Kendall p-value), the top years and the busiest month on record. Around Chilecito, the busiest month on record is July 2026, the fire in the challenge video.
- **Every number is traceable:** hover any cell to see raw MODIS, raw VIIRS, the factor k used, and where k came from.
- **Map:** global activity density, and individual hotspots coloured by sensor when you zoom in.
- **Export:** the calendar and the hotspots in the area as CSV, a summary as JSON, the calendar as PNG. The hotspot export is capped in size and links to FIRMS above the cap. *[If uploaded: the whole harmonized record as one table, monthly per 1° cell, Parquet or CSV, CC BY 4.0.]*
- **Accessible:** colour ramps are tested in code under simulated protan, deutan and tritan colour vision (Machado et al. 2009). Every chart has a plain-language caption.

There is no server. A pipeline on a Digital Research Alliance of Canada cluster turns the FIRMS archives into 132 MB of compact files. The browser fetches only the tiles an area needs and computes the calendar in a background thread. The Python pipeline and the TypeScript app are checked against the same golden test files, so the browser computes exactly what the pipeline does.

### Rekindle: from "when did it burn" to "what if"

*[GIF: Rekindle, British Columbia 2024. Real hotspots appear by time, the green burned-area outline, then the wind ×2 what-if.]*

The calendar tells you *when* an area burns. Fire managers also ask *how* a fire spreads, and what would have changed under stronger wind or drier fuel. Agencies use spread simulators daily, but they restart them from mapped perimeters and tune them by hand. Testing a simulator against satellites, automatically and anywhere on Earth, is still rare. The harmonized record makes it possible: each hotspot's first detection says when the fire reached that pixel. That is an answer key for any fire in the record.

**What it is.** The Rothermel (1972) surface fire spread model on a level-set fire front, on a 90 m grid with real terrain, fuels and hourly weather. Fuels come from MODIS land cover (MCD12Q1) and vegetation cover (MOD44B), wind and fuel moisture from MERRA-2, water from MOD44W. Each fire starts from its first satellite overpass. The solver passes 10 verification tests, including published Rothermel values (within 0.12 %) and exact circle and ellipse growth. The what-if runs are precomputed on the cluster and shipped as small files.

**How we tested it, failures included.** Before running anything, we wrote down a strict test: the median timing error must be within one satellite overpass interval (about 2–5 h). Every fire failed it. The Chilecito fire missed by 12.0 h against a 3.2 h limit, and blind tests on new fires did no better. Working out why taught us something about the data. Hotspots are a good clock, but a fuzzy map of what burned. NASA's MODIS burned-area product (MCD64A1) agrees with the hotspot footprint at only Sørensen 0.12–0.66 (1 = identical). So Rekindle is now judged against **two satellite references**: burned area for the shape of the fire, hotspots for its timing. What-if scenarios are shown only where the model meets a rule we set before looking.

*[confirm all numbers in this table against the final runs]*

| Fire | Where | Model shape vs most achievable | Status | What-if shown |
|---|---|---|---|---|
| British Columbia 2024 | interior Canada | 72 % | **shape validated** | whole fire: wind ×2 burns 2.9× the area, calm 0.57× |
| Chilecito 2026 | La Rioja, Argentina (challenge video fire) | 46 % | below the bar | one day: day 2 matched the hotspots (2.3 h vs 3.2 h limit) |
| Córdoba 2024 | Sierras, Argentina | 50 % | below the bar | one day (day 5, shape only) |
| N. Saskatchewan 2023 | boreal Canada | 90 % | references disagree too much to judge | whole fire, labelled exploratory |
| La Rioja / San Juan 2025 | Argentina | 28 % | below the bar | none |
| Gran Chaco 2024 | Argentina / Paraguay | not scored (references agree at 0.12) | references disagree too much to judge | none |

Every result is in the app, including the failures. They point to inputs and missing processes, not to the equations: suppression, fuel breaks finer than 500 m, crown fire and local weather aren't in the model. In a pre-screen of 600 candidate fire windows, only 2 spread freely for 6 days. Real fires burst and stall. All runs are logged with their cluster job IDs.

### Built on NASA data

| Dataset | What we use it for |
|---|---|
| [FIRMS](https://firms.modaps.eosdis.nasa.gov/) MODIS C6.1 active fires (Terra, Aqua), 2000–2026 | the MODIS half of the record; calibration |
| FIRMS VIIRS 375 m active fires, Suomi NPP (VNP14IMG) and NOAA-20 (VJ114IMG) | the VIIRS half; calibration reference; Rekindle ignition and timing |
| [MCD64A1](https://doi.org/10.5067/MODIS/MCD64A1.061) v061 burned area | Rekindle's second reference (shape) |
| [MCD12Q1](https://doi.org/10.5067/MODIS/MCD12Q1.061) v061 land cover | Rekindle fuels |
| [MOD44B](https://doi.org/10.5067/MODIS/MOD44B.061) v061 vegetation continuous fields | removing non-burnable ground from fuels |
| [MOD44W](https://doi.org/10.5067/MODIS/MOD44W.061) v061 water mask | water as a fire barrier |
| [MERRA-2](https://doi.org/10.5067/VJAFPLI1CSIV) hourly single-level (M2T1NXSLV) | wind, temperature and humidity for spread and fuel moisture |

Also used: Copernicus DEM GLO-30 (ESA, via AWS Open Data) for slope. The hero fire comes from CONAE's challenge video.

### Who it's for

- **Early-warning and emergency teams:** is this month unusual for this area, and when does the critical season start?
- **Land managers and scientists:** a consistent 25-year baseline for trends and seasonality, exportable to GIS, R or Python, with the method and factors published.
- **Fire planners and educators:** what-if replays of real fires that show how wind and dryness change a fire, with their limits stated.

It works for any area on Earth, needs no account, and costs nothing to run. Next steps: refresh the data daily from FIRMS near-real-time feeds, add the land-cover tier of calibration, and add finer fuel maps and live perimeters to Rekindle, toward a tool that could one day support prediction.

### Limitations

- Hotspots are not fires and not burned area. Cloud, smoke and overpass timing cause gaps. The unit counts activity, not fires.
- One factor per region and month assumes the MODIS–VIIRS relationship stays stable over time. Values before 2012 can't be checked against VIIRS.
- The uncertainty band covers calibration only, not missed detections.
- Rekindle models surface fire only: no crowning, spotting or suppression. Fuels come from 500 m land cover, and weather from one point per fire. Its what-ifs are illustrative, not forecasts.

### Tools

Python 3.12, DuckDB, Polars, NumPy, SciPy, scikit-fmm, rasterio; React, TypeScript, Vite, MapLibre GL JS, ECharts, Turf, Terra Draw; Cloudflare Pages, Hugging Face Datasets; Digital Research Alliance of Canada (Fir cluster, Slurm).

### Use of AI

*[Draft, edit to match the form:]* We used AI coding agents (Claude Code) to write and test code and documentation under our direction. The design, scientific decisions and every reported number were reviewed by the team and come from logged runs.

### References

- Giglio, L. et al. MODIS Collection 6/6.1 Active Fire Product User's Guide.
- Schroeder, W. et al. (2014). The New VIIRS 375 m active fire detection data product. *Remote Sensing of Environment* 143.
- Giglio, L. et al. (2018). The Collection 6 MODIS burned area mapping algorithm. *Remote Sensing of Environment* 217.
- Rothermel, R. C. (1972). USDA Forest Service INT-115. Albini, F. A. (1976). INT-30. Anderson, H. E. (1982). INT-122.
- Osher, S. & Sethian, J. A. (1988). *J. Comput. Phys.* 79. Finney, M. A. (1998). FARSITE, RMRS-RP-4.
- Machado, G. M. et al. (2009). Simulation of color vision deficiency. *IEEE TVCG* 15(6).
- NASA FIRMS acknowledgement: *[use the exact string in `rekindle/credits.py` / the current README]*
