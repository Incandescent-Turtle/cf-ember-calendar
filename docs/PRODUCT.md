# PRODUCT.md — what we're building and why

## The challenge, in one line

MODIS (2000→, retiring 2027) and VIIRS (2012→) hotspot records can't be compared directly, so fire managers lack a consistent 25-year picture. Harmonize them, and build a web app with a **burning activity calendar** for any area: which months/years burn most, and how *now* compares to the historical median. CSV export expected.

Source: `challenge_description.md` and the challenge video (Marina Compagnucci, CONAE). The video's two-part framing: (1) harmonize so the sensor of origin no longer matters, (2) a web app that pours harmonized hotspots into a calendar for a chosen region/date, with analytics.

## Users

- **Emergency managers / early-warning teams** (primary): "Is this month unusual for this region? When is our critical period?"
- **Land managers / scientists**: long-term trends, seasonality shifts, export for GIS/R/Python.
- **Firefighters / planners**: Rekindle — "what if this fire had happened under stronger wind / drier fuels / here instead?"

## Product name & tagline (working)

**Ember Calendar** — *25 years of fire, one consistent record.* Simulator: **Rekindle** — *replay a real fire under a different sky.*

## Hero story for the demo

**Argentina → La Rioja → Chilecito fire, July 2026** (the fire shown in the challenge video). Open the app there: draw the AOI, show the calendar, show July 2026 vs the historical median, then Rekindle it with stronger wind. App is global; the demo is local.

---

## Feature tiers

### Tier 1 — MUST (the challenge; done before anything in Tier 3)

**F1. Area of interest (AOI) selection**
- Draw rectangle or polygon on the map; OR enter lat/lon + radius (km); OR pick a preset (country list + a few named fire regions).
- AOI shown on map; area in km² displayed.
- *As shipped:* rectangle (press-and-drag or two clicks), polygon, point + radius (drag from the centre, or type lat/lon/km), country list, **place search** (Photon/OpenStreetMap geocoder; "Select area" uses the place's box), and **six examples** (the four Rekindle fires, NSW Black Summer Dec 2019, Rondônia) that also jump to the fire month. Map panning is locked while drawing; Esc cancels. **Satellite imagery** basemap (EOX Sentinel-2 cloudless 2020, desaturated) is the default, with a street-map toggle.
- *Accept:* from the deployed static site, a country-size AOI returns a calendar in < 6 s on broadband (Chilecito-size < 2 s); any AOI on Earth works (very large AOIs fall back to the 1° level and say so).

**F2. Burning activity calendar**
- Grid: rows = years (2001 → current), columns = Jan–Dec. Cell colour = harmonized monthly activity (VIIRS-equivalent fire-cell-days), log-scaled, sequential perceptually uniform CVD-safe ramp (`inferno` or `YlOrRd`-like; validate).
- Toggle: **Harmonized** (default) / **Above / below normal** (anomaly, F6) / **MODIS raw** / **VIIRS raw** / **Side-by-side** (shows why harmonization matters — the 2012 jump).
- Marginal bars: per-year total (right), per-month median (bottom).
- Hover tooltip: month, harmonized value + uncertainty band, raw MODIS FCD, raw VIIRS FCD, calibration factor + stratum it came from, percentile vs that calendar month's history.
- Click a cell → map filters to that month's hotspots; stats panel updates.
- Optional sub-view: dekad-of-year × year heatmap (36 columns) for finer seasonality.
- *Accept:* for Argentina, the harmonized calendar has no visible step at 2012 while the MODIS-raw/VIIRS-raw views do.

**F3. Summary panel ("At a glance")**
- Current month (month-to-date, compared to the *same dekads* of that month in prior years — fair comparison) vs historical median: ratio, percentile, label (Below normal / Normal / Above normal / Extreme ≥ P90).
- Top 3 years, top 3 months-of-year, busiest single month on record.
- **Critical period**: smallest set of consecutive calendar months containing ≥ 60% of median annual activity (e.g., "Jul–Oct").
- Trend: Theil–Sen slope of annual totals with Mann–Kendall p-value (one line: "+3.1%/yr, p=0.02").
- *Accept:* all numbers reproducible from the exported CSV.
- *As shipped:* plain-language wording ("4 fire-cell-days so far, vs a usual 1 for these days (about 3.9× normal). Busier than 92 % of past years."; trend as rising / falling / no clear trend), with fire-cell-day defined inline; percentiles, p-values and k stay in the hover tooltips.

**F4. Map**
- Basemap + hotspot points for the selected time window (cluster/heatmap when zoomed out; points when zoomed in), coloured by sensor or by FRP.
- "All time" density layer from the global 1° cube (`cube/l10/global.bin.gz`) for the world view, with a month/year filter.
- *Accept:* smooth at world zoom (aggregates only), points only below a zoom threshold or for windows ≤ 1 year.

**F5. Export**
- `Download hotspots (CSV)`: raw cleaned detections in AOI + date range, with sensor column (columns in CONTRACTS.md). Generated in the browser from hosted point files; capped (≈ 200 MB fetched / ≈ 3M rows) — above the cap, show a message and deep-link to the FIRMS Archive Download page.
- `Download calendar (CSV)`: year, month, harmonized, harmonized_lo, harmonized_hi, modis_fcd, viirs_fcd, k, k_stratum, percentile.
- `Download summary (JSON)`.
- Also export the calendar as PNG.
- *Accept:* CSV opens in Excel/QGIS without fixes (UTF-8, header row, lon/lat columns).

### Tier 2 — SHOULD

**F6. Anomaly view** — calendar re-coloured as anomaly (diverging CVD-safe ramp, centred at the month's median): z-score of log1p(activity) per calendar month. Flags on cells ≥ P90 / ≤ P10.
- *As shipped ("Above / below normal"):* each month coloured by log₂((value + 1) / (that calendar month's median + 1)), the median taken over complete years with the current year excluded, clipped at ±3 (⅛× … 8×); ColorBrewer RdBu (blue = below normal, white ≈ normal, red = above). The tooltip adds "N× the typical <month> (median …)". Ratios instead of z-scores: easier to read, and robust where many months are zero.

**F7. Seasonality chart** — median monthly curve with IQR band across baseline years; overlay current year and a user-chosen year.

**F8. Methodology & validation page** — the seam chart (raw MODIS vs raw VIIRS vs harmonized, monthly, 2008–2016, for global + the AOI), the calibration-factor map, leave-one-year-out metrics, limitations. Written for judges.

**F9. Recent days** — a build-time snapshot (`recent.json`, last ≤ 10 days of NRT NOAA-20/21 from the FIRMS area API, taken Sunday afternoon) appended and marked "provisional" (hatched). No live fetching.

### Tier 3 — Rekindle (the differentiator)

**F10. Rekindle** on a curated list of precomputed real fires (Chilecito 2026 first, then one more Argentine and one Canadian fire; max three). The engine takes any point, the product ships only these.
- Shows the real fire: hotspots animated by acquisition time.
- **Hindcast** (baseline): simulated arrival-time field and perimeters every N hours from the fire's real weather; overlay observed hotspots; show agreement metrics. Caption: "Hindcast of a real fire, calibrated to its satellite detections."
- **Counterfactuals** carry the caption "Illustrative what-if: surface fire only, coarse fuels. Not a forecast." Emphasise differences from the baseline over absolute times. If a fire's `status` is `poor_agreement`, show the baseline only.
- Counterfactual controls (sliders **snap to a precomputed grid**, see CONTRACTS.md): wind speed (0–15 m/s), wind direction (8 compass points), dead fuel moisture (4/6/10/14 %). Optional named scenarios: weather swapped from another real fire; a fixed firebreak. Free-drawn firebreaks, moving the ignition point and fuel overrides are cut.
- Side-by-side or toggle: baseline vs counterfactual (area burned, time to reach a chosen point).
- *Accept:* moving a slider loads the matching precomputed run in < 1 s; the uniform-fuel no-wind solver test is a circle (see REKINDLE.md).
- *As shipped (S6–S6i):* what-ifs only where a rule passes (24 h windows; the shape-validated BC fire). The tab shows the animation and a plain explanation; the evaluation against hotspots and MODIS burned area, failures included, lives on /methodology and in `docs/REKINDLE_RESULTS.md`.

**F11. Statistical counterfactuals** (cheap, pitch-worthy): "What if this year had followed the median season?" overlay on the seasonality chart; "MODIS-continuity series": the harmonized record continues the MODIS-era baseline after MODIS ends.

### How we differ from FIRMS (for the pitch; verify against the live FIRMS map before claiming)
FIRMS shows *where fire is burning*, mostly recent days, one layer per sensor, with archive downloads you must combine yourself. We answer *is this area's fire activity unusual, and when does it matter*: a 25-year calendar for any drawn area, one calibrated MODIS+VIIRS series with uncertainty and a 2012 seam test, anomalies vs the area's own median, critical periods, a harmonized CSV with methods, plus Rekindle hindcasts and what-ifs. The demo must *show* the raw MODIS vs VIIRS mismatch and its fix; do not say "first" or "better than FIRMS".

### Cut (do not build this weekend)
Any server/API/database, live solver, queue / stop / restart, accounts, auto-ingest, arbitrary-fire Rekindle, free-drawn firebreaks and ignitions, weather/humidity overlays, ADR & FMM simulators (post-hackathon, for the GEOE 443 report).

---

## UX layout

- **Left:** map (≈60% width). AOI tools top-left. Time window slider bottom.
- **Right:** tabbed panel — *Calendar* (default) | *Trends* | *Export* | *Rekindle*.
- **Top bar:** title, sensor toggle, "Methodology" link, "About."
- First load: world view with all-time density + example buttons (Chilecito first) that select an area and jump to its fire month (originally a single "Try: Chilecito" button).
- Every chart has a one-line plain-language caption ("Darker = more fire activity. July–September is this area's critical period.").

## Accessibility

- CVD-safe ramps only; never encode meaning by red/green alone; numbers available in tooltips and a table toggle under the calendar.
- Contrast AA for text; keyboard-navigable calendar cells.
- Units always labelled; "provisional" data visually distinct (hatched).
