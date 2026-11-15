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

## NASA data
FIRMS MODIS (MCD14ML/MCD14DL), FIRMS VIIRS S-NPP (VNP14IMG) and NOAA-20 (VJ114IMG), NASADEM/SRTM, MODIS MCD12Q1, MODIS MOD44W, MERRA-2.

## Run locally
See `CLAUDE.md` → Commands. The data pipeline runs on an HPC cluster (fixtures run locally); the app is a static site that reads the processed data from object storage (see `docs/ARCHITECTURE.md`).

## Docs
`docs/PRODUCT.md` · `docs/ARCHITECTURE.md` · `docs/CONTRACTS.md` · `docs/DATA.md` · `docs/HARMONIZATION.md` · `docs/REKINDLE.md` · `docs/AGENT_BRIEFS.md` · `docs/BUILD_PLAN.md` · `docs/SUBMISSION.md`

## Limitations
Hotspots are not fires or burned area. Calibration assumes the MODIS–VIIRS relationship stays stable over time. Rekindle models surface fire only, with no crowning or spotting, and its fuels come from 500 m land cover. Details are on the Methodology page.

## License
MIT
