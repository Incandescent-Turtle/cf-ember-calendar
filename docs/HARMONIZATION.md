# HARMONIZATION.md — making MODIS and VIIRS one record

Goal (from the challenge): *"by the end of that phase the sensor of origin no longer matters."* Output: one continuous series, 2000-11 → present, in **VIIRS-equivalent fire-cell-days (FCD)**, with uncertainty, for any AOI.

## Why raw counts can't be compared

| | MODIS (Terra/Aqua) | VIIRS I-band (S-NPP / NOAA-20) |
|---|---|---|
| Pixel at nadir | ~1 km | ~375 m (≈ 7 VIIRS pixels per MODIS pixel) |
| Pixel growth toward swath edge | large (up to ~10× area) | much smaller (aggregation scheme) |
| Sensitivity | misses small/cool fires | detects much smaller fires |
| Overpasses | Terra ~10:30/22:30 (drifting since ~2020), Aqua ~13:30/01:30 | S-NPP ~13:30/01:30; NOAA-20 same orbit, ~50 min offset |
| Record | 2000-11 → 2027 (ending) | 2012-01 → present |

A single fire produces many more VIIRS detections than MODIS detections. Raw counts jump at 2012 for reasons that are about the instrument, not the fire.

## Pipeline

### Step 1 — Clean
- Keep `type == 0` (vegetation fire) where `type` exists. Where it's missing (some NRT rows), drop detections within 1 km of a known static source (build a static-source mask from cells flagged `type in (1,2)` in SP data, or detections present on > 50% of days in a year).
- Confidence: MODIS keep `confidence >= 30`; VIIRS keep `n` and `h` (drop `l`). Make thresholds config values — expose "include low confidence" as an advanced toggle only if time allows.
- Dedupe SP vs NRT: if SP exists for a (sensor, date), drop NRT rows for that sensor-date.
- Dedupe exact duplicates (same sensor, lat, lon, datetime).

### Step 2 — Common unit: fire-cell-days (FCD)
- For each sensor group (MODIS = Terra ∪ Aqua; VIIRS = the active VIIRS satellite, see Step 4), assign each detection to a **0.01° cell** (`cell01`).
- **FCD = number of distinct (cell01, UTC date) pairs with ≥ 1 detection.**
- Why: collapses (a) multiple VIIRS pixels inside one ~1 km area, (b) multiple overpasses per day (Terra + Aqua, day + night). What remains is mainly the sensitivity difference, which Step 3 calibrates.
- Compute per 0.01° cell per day, then **sum into 0.1° and 1° cells per dekad** (days 1–10, 11–20, 21–end) — the cube files in CONTRACTS.md. Summation is exact, so any AOI is a sum over coarse cells; the calendar sums three dekads into a month, and month-to-date compares aligned dekads.

### Step 3 — Calibrate MODIS → VIIRS-equivalent
Fit on the overlap **2013-01 → 2021-12** (full years of both S-NPP and stable-ish Terra/Aqua; excludes the 2012 ramp-up and post-2022 Terra orbital drift).

For a stratum *s* and calendar month *m*:

```
k[s,m] = Σ_years Σ_cells∈s VIIRS_FCD  /  Σ_years Σ_cells∈s MODIS_FCD      (ratio-of-sums, robust to zeros)
```

Uncertainty: bootstrap over years (resample the 9 overlap years with replacement, 200×) → `k_lo`, `k_hi` = 5th/95th percentiles.

**Strata hierarchy** (use the most specific with enough data; threshold `MIN_MODIS_FCD = 200` in the overlap for that month, else fall back):
1. **AOI-specific** — computed in the browser from the AOI's own overlap-era cells (sums over 2013–2021 from the same cubes).
2. **10° tile × month** — precomputed.
3. **Land-cover class × hemisphere × month** — precomputed from MCD12C1 dominant IGBP per 0.1° cell (Tier 2; skip if short on time).
4. **Global × month** — precomputed; always available.

Optional smoothing: shrink a sparse stratum's k toward its parent: `k = (n·k_s + n0·k_parent)/(n + n0)`, n0 = 200.

Stretch (only if Tier 1 is done): replace ratio with **quantile mapping** of daily cell-level FCD distributions per stratum (maps MODIS distribution onto VIIRS's, preserves extremes better). Keep ratio as the default and report both on the methodology page.

### Step 4 — Assemble the harmonized series

```
H(t) = k[s, month(t)] · MODIS_FCD(t)                 for t < 2012-02  (MODIS-only era)
H(t) = VIIRS_SNPP_FCD(t)                              for 2012-02 ≤ t < 2026-11-02
H(t) = k_N20[s, month] · VIIRS_NOAA20_FCD(t)          for t ≥ 2026-11-02
```

- All switches happen on **dekad boundaries**: the MODIS→S-NPP switch at the first dekad of 2012-02; the S-NPP→NOAA-20 switch at the first dekad after 2026-10 (the Nov 1–10 dekad uses NOAA-20 only; S-NPP's two days in it are ignored).
- `k_N20` cross-calibrates NOAA-20 to S-NPP on 2020-06 → 2026-10 (same method; expected close to 1 — report it).
- Uncertainty band: MODIS era uses k_lo/k_hi; VIIRS era band = 0 (it's the reference), NOAA-20 era uses k_N20 band.
- Also compute the **"MODIS-continuity" view** (`H / k` — the series in MODIS-equivalent units), which lets users compare against old MODIS-based reports. This is one of Rekindle's "statistical counterfactuals" (PRODUCT F11).
- Keep raw series alongside (MODIS FCD, VIIRS FCD) — the UI's raw toggles and the export depend on them.

### Step 5 — Validate (this is the Validity score — do not skip)

1. **Leave-one-year-out (LOYO)** within 2013–2021: for each held-out year y, fit k on the other years, predict VIIRS monthly FCD from MODIS for y. Report per stratum level and globally:
   - Pearson r on log1p(monthly FCD)
   - median absolute percentage error on months with VIIRS FCD ≥ 10
   - bias (mean log ratio)
   Compare against the **no-calibration baseline** (k = 1) and the **naive detection-count ratio** (raw counts instead of FCD). The table "raw counts → FCD → FCD + calibrated k" shows each step's contribution — this is the methodology page's core table.
2. **Seam test**: plot monthly global + hero-AOI series 2008–2016: MODIS raw, VIIRS raw, harmonized. The harmonized line should be continuous through 2012; test statistically: compare the mean of log(H) for the 24 months either side of 2012-02 against the same window in the MODIS-only series (difference should be ~0 after calibration).
3. **Seasonality preservation**: correlation of the median monthly cycle from MODIS-era (2001–2011, harmonized) vs VIIRS-era (2013–2025) per tile — should be high where fire regimes haven't changed; disagreements are interesting, not necessarily errors.

Write all of this to `data/processed/validation.json`; the methodology page renders it.

## Analytics on the harmonized series (TypeScript in the browser; Python reference for validation)

Both implementations must agree to within floating-point tolerance; `tests/golden/*.json` (generated by Python, consumed by the web tests) enforces it. Percentile/label thresholds, critical-period search and the trend test are specified once, here.

- **Baseline** = all complete years in the record except the current year (configurable range).
- **Monthly climatology** per calendar month: median, P10, P25, P75, P90 of H.
- **Percentile** of a given month vs its calendar-month history; label: < P25 Below normal, P25–P75 Normal, P75–P90 Above normal, ≥ P90 Extreme.
- **Anomaly z** = (log1p(H) − mean_log) / sd_log per calendar month.
- **Current month (month-to-date)**: compare the dekads observed so far this month against the **same dekads** of that month in baseline years (not full months). Dekads from `recent.json` are provisional.
- **Critical period** = shortest run of consecutive calendar months (wrapping Dec→Jan) whose median activity sums to ≥ 60% of the median annual total.
- **Trend** = Theil–Sen slope of annual totals (as %/yr of the median annual) + Mann–Kendall p.

## Limitations (say these on the methodology page)

- Hotspots ≠ fires and ≠ burned area; clouds, smoke and overpass timing cause omissions; one fire spans many FCDs.
- A single k per stratum-month assumes the MODIS/VIIRS relationship is stationary in time; fire-size distribution shifts would bias it.
- FCD drops intensity (FRP), the number of detections per cell-day and fire identity: it counts activity, not fires. Burned-area products measure something different (the scar, not heat at overpass time).
- **Pre-2012 values cannot be validated against VIIRS** (it didn't exist). Leave-one-year-out checks that k is stable across overlap years; the seam test checks continuity. Neither proves the 2001–2011 values. State this plainly.
- Bands (bootstrap over ~9 overlap years) cover calibration uncertainty only, not omission, cloud or detection changes. Label them "calibration uncertainty".
- Terra orbit drift after ~2020 makes recent MODIS less comparable; we don't use it for fitting.
- 0.01° cells shrink in longitude at high latitude; affects both sensors equally, so k absorbs most of it.
- Literature context: recent work fuses MODIS/VIIRS FRP at footprint scale (Remote Sensing 18(10):1650, 2026) and harmonizes burned area (GFED5NRT, MRBA60). Our approach is deliberately simpler, transparent and AOI-adaptive; cite these as directions for future work.
