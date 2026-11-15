# Ember Calendar 🔥 — with Rekindle

**25 years of fire, one consistent record.**
NASA Space Apps Challenge 2026 · *Harmonization of MODIS and VIIRS Hot Spots*

> Live app: _TBD_ · 30-second demo: _TBD_

Satellites have watched Earth's fires for 25 years, but the record is split between MODIS (2000–2027, now retiring) and VIIRS (2012–present), which see fire differently. Ember Calendar harmonizes NASA FIRMS hotspots from both sensors into one continuous, VIIRS-equivalent record. Draw any area on Earth and see its **burning activity calendar**: which months and years burn most, its critical period, and how this month compares to the historical median. Everything exports to CSV.

**Rekindle** replays a real fire under different conditions (wind, fuel moisture, firebreaks, ignition point) using a level-set front solver driven by the Rothermel surface fire model. It checks each replay against the fire's own satellite hotspot timestamps.

## How it works
1. **Clean**: FIRMS MODIS C6.1 and VIIRS 375 m detections are filtered by type and confidence, with science and near-real-time duplicates removed.
2. **Common unit**: detections become *fire-cell-days*, the distinct 0.01° cells with fire on each day. This removes most of the effects of resolution and overpass count.
3. **Calibrate**: MODIS is scaled to VIIRS-equivalent units using factors fit on the 2013–2021 overlap. Factors are per month and per region, adapt to the selected area, and carry bootstrap uncertainty.
4. **Validate**: the method is tested by leaving one year out at a time and by checking the 2012 seam. Results are on the in-app Methodology page.
5. **Explore**: calendar, anomalies, seasonality, trends, and export for any area.

## Data and credits
- **NASA FIRMS** active fire detections (MODIS C6.1 MCD14ML/MCD14DL; VIIRS 375 m S-NPP VNP14IMG and NOAA-20 VJ114IMG): calendar, and Rekindle ignition/validation. "We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS)."

Rekindle (`rekindle/credits.py` holds the exact strings; each was checked against the dataset's own page, see `docs/DECISIONS.md` S6):
- **MERRA-2** hourly 10 m wind, T2M, QV2M: Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 tavg1_2d_slv_Nx: 2d,1-Hourly,Time-Averaged,Single-Level,Assimilation,Single-Level Diagnostics V5.12.4, Greenbelt, MD, USA, Goddard Earth Sciences Data and Information Services Center (GES DISC), Accessed: 2026-11-15, 10.5067/VJAFPLI1CSIV.
- **MODIS MCD12Q1 v061** land cover (fuels): Friedl, M., & Sulla-Menashe, D. (2022). MODIS/Terra+Aqua Land Cover Type Yearly L3 Global 500m SIN Grid V061 [Data set]. NASA LP DAAC. https://doi.org/10.5067/MODIS/MCD12Q1.061
- **MODIS MOD44W v061** water mask: Carroll, M., et al. (2024). MODIS/Terra Land Water Mask Derived from MODIS and SRTM L3 Global 250m SIN Grid V061 [Data set]. NASA LP DAAC. https://doi.org/10.5067/MODIS/MOD44W.061
- **Copernicus DEM GLO-30** (slope and aspect, from AWS Open Data): produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

## Run locally
See `CLAUDE.md` → Commands. The data pipeline runs on an HPC cluster (fixtures run locally); the app is a static site that reads the processed data from object storage (see `docs/ARCHITECTURE.md`).

## Docs
`docs/PRODUCT.md` · `docs/ARCHITECTURE.md` · `docs/CONTRACTS.md` · `docs/DATA.md` · `docs/HARMONIZATION.md` · `docs/REKINDLE.md` · `docs/AGENT_BRIEFS.md` · `docs/BUILD_PLAN.md` · `docs/SUBMISSION.md`

## Limitations
Hotspots are not fires or burned area. Calibration assumes the MODIS–VIIRS relationship stays stable over time. Rekindle models surface fire only, with no crowning or spotting, and its fuels come from 500 m land cover. Details are on the Methodology page.

## License
MIT
