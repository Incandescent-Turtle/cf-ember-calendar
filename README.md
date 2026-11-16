# Ember Calendar 🔥 — with Rekindle

**25 years of fire, one consistent record.**
NASA Space Apps Challenge 2026 · *Harmonization of MODIS and VIIRS Hot Spots*

> Live app: _TBD_ · 30-second demo: _TBD_

Satellites have watched Earth's fires for 25 years, but the record is split between MODIS (2000–2027, now retiring) and VIIRS (2012–present), which see fire differently. Ember Calendar harmonizes NASA FIRMS hotspots from both sensors into one continuous, VIIRS-equivalent record. Draw any area on Earth (or search a place, or pick one of the ready-made examples) and see its **burning activity calendar**: which months and years burn most, its fire season, whether each month was above or below normal, the long-term trend, and how this month compares to the historical median. Everything exports to CSV.

**Rekindle** replays real fires with a level-set front solver driven by the Rothermel surface fire model, using real terrain, vegetation and hourly weather. Each replay is judged against two satellite references: the harmonized hotspots for *when* fire was seen, and MODIS burned area (MCD64A1) for *where* it burned. Where the model matches (a 24-hour stretch of a fire, or a whole fire's shape), you can change the wind or the fuel dryness and see how the fire would have spread. These what-ifs are illustrative, not a forecast. The full evaluation, failures included, is on the Methodology page and in `docs/REKINDLE_RESULTS.md`.

## How it works
1. **Clean**: FIRMS MODIS C6.1 and VIIRS 375 m detections are filtered by type and confidence, with science and near-real-time duplicates removed.
2. **Common unit**: detections become *fire-cell-days*, the distinct 0.01° cells with fire on each day. This removes most of the effects of resolution and overpass count.
3. **Calibrate**: MODIS is scaled to VIIRS-equivalent units using factors fit on the 2013–2021 overlap. Factors are per month and per region, adapt to the selected area, and carry bootstrap uncertainty.
4. **Validate**: the method is tested by leaving one year out at a time and by checking the 2012 seam. Results are on the in-app Methodology page.
5. **Explore**: for any area, the monthly calendar, an *above / below normal* view (each month against that month's typical value), the fire season, busiest years and months, the trend, this month vs normal, and exports (calendar CSV, summary JSON, PNG, hotspot CSV). Draw, search or pick an example; satellite or street basemap.

## Data and credits
- **NASA FIRMS** active fire detections (MODIS C6.1 MCD14ML/MCD14DL; VIIRS 375 m S-NPP VNP14IMG and NOAA-20 VJ114IMG): calendar, and Rekindle ignition/validation. "We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS)."

Rekindle (`rekindle/credits.py` holds the exact strings; each was checked against the dataset's own page, see `docs/DECISIONS.md` S6):
- **MERRA-2** hourly 10 m wind, T2M, QV2M: Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 tavg1_2d_slv_Nx: 2d,1-Hourly,Time-Averaged,Single-Level,Assimilation,Single-Level Diagnostics V5.12.4, Greenbelt, MD, USA, Goddard Earth Sciences Data and Information Services Center (GES DISC), Accessed: 2026-11-15, 10.5067/VJAFPLI1CSIV.
- **MODIS MCD12Q1 v061** land cover (fuels): Friedl, M., & Sulla-Menashe, D. (2022). MODIS/Terra+Aqua Land Cover Type Yearly L3 Global 500m SIN Grid V061 [Data set]. NASA LP DAAC. https://doi.org/10.5067/MODIS/MCD12Q1.061
- **MODIS MOD44W v061** water mask: Carroll, M., et al. (2024). MODIS/Terra Land Water Mask Derived from MODIS and SRTM L3 Global 250m SIN Grid V061 [Data set]. NASA LP DAAC. https://doi.org/10.5067/MODIS/MOD44W.061
- **MODIS MOD44B v061** vegetation continuous fields (fractional cover): DiMiceli, C., Sohlberg, R., & Townshend, J. (2022). MODIS/Terra Vegetation Continuous Fields Yearly L3 Global 250m SIN Grid V061 [Data set]. NASA LP DAAC. https://doi.org/10.5067/MODIS/MOD44B.061
- **MODIS MCD64A1 v061** burned area (second reference for shape): Giglio, L., Justice, C., Boschetti, L., Roy, D. (2021). MODIS/Terra+Aqua Burned Area Monthly L3 Global 500m SIN Grid V061. NASA LP DAAC. https://doi.org/10.5067/MODIS/MCD64A1.061
- **Copernicus DEM GLO-30** (slope and aspect, from AWS Open Data): produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

## Run locally
See `CLAUDE.md` → Commands. The data pipeline runs on an HPC cluster (fixtures run locally); the app is a static site that reads the processed data from object storage (see `docs/ARCHITECTURE.md`).

## Docs
`docs/PRODUCT.md` · `docs/ARCHITECTURE.md` · `docs/CONTRACTS.md` · `docs/DATA.md` · `docs/HARMONIZATION.md` · `docs/REKINDLE.md` · `docs/REKINDLE_RESULTS.md` · `docs/AGENT_BRIEFS.md` · `docs/BUILD_PLAN.md` · `docs/SUBMISSION.md`

## Limitations
Hotspots are not fires or burned area. Calibration assumes the MODIS–VIIRS relationship stays stable over time. Rekindle models surface fire only, with no crowning, spotting or firefighting; its fuels come from 500 m land cover and its wind from a ~50 km reanalysis. It does not reproduce whole fires in time, so what-ifs are shown only where it matches the satellites. Details are on the Methodology page.

## License
MIT
