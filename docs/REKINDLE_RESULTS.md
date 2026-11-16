# Rekindle — results and story (for the presentation and project page)

Status 2026-11-15 ~19:30 Toronto. Items marked **⏳ S6i** are being recomputed after the shape recalibration (DECISIONS.md "Pre-registration — S6i") and will be filled in here. Everything else is final. Full history with every run: `docs/DECISIONS.md` (S6b → S6i).

## The story in one paragraph

Rekindle replays real wildfires with a physics model (Rothermel surface spread on a level-set front, real terrain, fuels and hourly weather) and asks *what if the wind or fuel dryness had been different?* We built it to be judged against our harmonized MODIS + VIIRS hotspots: every satellite pixel's first detection gives an "answer key" for when the fire arrived. The strict test we fixed before running (median timing error within one overpass interval, about 2–5 h) failed on every fire, and we report that. Digging into why taught us something about the data itself. Hotspots record **when** something hot was seen at overpass time, a good timing signal, but they are a fuzzy outline of **what burned**. NASA's independent MODIS burned-area product (MCD64A1) agrees with the hotspot footprint only at Sørensen 0.3–0.66. So Rekindle is now judged against **two satellite references**: burned area for shape, hotspots for timing. The model is recalibrated to shape, and what-if scenarios are shown only where the model earns them, with every limit labelled.

**On independence:** MCD64A1 is a *product* made from the MODIS *instrument* (Terra and Aqua), the same sensor as the MODIS half of the hotspots. It measures something different: a burn scar (surface reflectance change over days), not heat at overpass time. Its algorithm is also guided in part by MODIS active fires (Giglio et al. 2018). So call it a **second, partly independent reference**, not a fully independent one. VIIRS (Suomi NPP, NOAA-20/21) is a separate instrument. Shared inputs should make the two references agree *more*, so their low agreement (0.24–0.66) is, if anything, an optimistic ceiling.

## Motivation (why this matters)

- Fire agencies use spread simulators (FARSITE, Prometheus, Phoenix) daily, but they re-initialise from mapped perimeters every day and adjust rates by hand (Finney 1998; Tymstra et al. 2010). Testing a simulator against satellites, automatically and globally, is still rare.
- The harmonized hotspot record (2000→, MODIS + VIIRS) is what makes an automatic timing check possible anywhere on Earth. Rekindle shows that use, and its limits.
- What-if replays of real fires (more wind, drier fuels) are an intuitive way to communicate fire risk and to motivate prevention, *if* their limits are honest.

## What Rekindle is

- **Physics:** Rothermel (1972) surface rate of spread, with Albini/Anderson 13 fuel models and an elliptical wind and slope shape on a level-set front (scikit-fmm reinitialisation), on a 90 m grid. It passes 10 verification tests (published Rothermel values, analytic circle and ellipse growth).
- **Inputs (all global, all NASA or open):**
  - fuels from MODIS MCD12Q1 land cover (IGBP → Anderson), with MOD44B non-vegetated cover removed above 50 %;
  - Copernicus/NASADEM terrain;
  - MERRA-2 hourly 10 m wind, with dead fuel moisture from humidity on a time-lag model.
- **Ignition:** the fire's first satellite overpass. One free parameter: a rate-of-spread multiplier.
- **Precomputed:** no live solver; the what-if grids are run on the Alliance cluster (Fir) and shipped as small rasters.

## How it was evaluated, in order (nothing hidden)

1. **Pre-registered timing gate** (S6): median |simulated arrival − first detection| ≤ the fire's mean overpass interval. Chilecito failed (12.0 h vs 3.2 h); 7 pre-registered model variants moved it by under 1.3 h.
2. **Blind tests** with the model frozen: Córdoba (15.2 h vs 2.9 h), then Saskatchewan, picked by a pre-registered free-spread screen (22.4 h vs 1.7 h). The screen itself found that **only 2 of 600 candidate fire windows** spread freely for 6 days. Real fires burst and stall, and a free-spread model can't stall.
3. **Diagnosis:** inputs are sane (rates ordinary for the fuels), but stalls come from suppression, fuel breaks finer than 500 m and local weather, none of which is a model input.
4. **24 h windows**, restarted each day from the detected extent: timing error 8–12 h; still fails.
5. **Burst-window what-if** (S6c, rule written down before the third fire): Chilecito day 2 matched (2.3 h ≤ 3.2 h, Sørensen 0.46).
6. **Footprint what-if** (S6d): Saskatchewan's footprint matched the hotspots well (0.72), but its timing didn't.
7. **Three more fires** (S6e: BC 2024, La Rioja 2025, Chaco 2024): none passed. Shape-only windows (S6f) for fires with no other view: BC day 3, Córdoba day 5.
8. **Is the answer key right?** (S6g): overpass waits explain only 0.5–8 h of the error (a fair interval error). MCD64A1 burned area shows the hotspot footprint itself is uncertain (Sørensen 0.3–0.66), and first-detection days match burn days within ±1 day for only 30–74 % of pixels.
9. **Two references** (S6h): shape judged against burned area plus the inter-reference ceiling; timing against hotspots with the fair interval.
10. **Shape recalibration** (S6i, pre-registered): multiplier chosen by Sørensen vs MCD64A1 over ×0.125–8. "Shape validated" if the model reaches ≥ 70 % of the ceiling and the ceiling is ≥ 0.3.
11. **Correction (S6i-b):** the first version scored shape only inside the fire box, and that hid over-burn. Chilecito's box was completely burned at any multiplier above ×0.71 while the model burned 770 km² in the domain, against 135 km² mapped. Final scoring uses the **whole domain** against **MCD64A1 patches connected to this fire's hotspots** (± 1 km), so neighbouring fires don't count and over-burn anywhere does. The in-box numbers are kept in DECISIONS.md as a lesson.

## Final per-fire status

Whole domain, fire-connected MCD64A1 (S6i-b). Ceiling = Sørensen(hotspots, burned area): the most a model can be expected to reach. **All ⏳ S6i-b**; the rows below are the superseded in-box run and will be replaced.

| Fire | Region | Ceiling | Shape-calibrated multiplier | Model vs burned area | Ratio | Shape status | Timing (raw → fair) at shape multiplier | What-if view |
|---|---|---|---|---|---|---|---|---|
| Chilecito 2026 | La Rioja, AR (challenge video fire) | 0.66 | ⏳ S6i | ⏳ | ⏳ | ⏳ | ⏳ | Burst window, day 2 (timing rule) |
| Córdoba 2024 | Sierras, AR | 0.59 | ×0.25 | 0.32 | 0.54 | below bar | ⏳ | Shape-only window, day 5 |
| N. Saskatchewan 2023 | boreal CA | 0.31 | ×2.83 | 0.31 | 0.99 | validated (weak: low ceiling) | ⏳ | Footprint what-if, whole fire (⏳ rerun on new baseline) |
| C. British Columbia 2024 | interior CA | 0.52 | ×1.0 | 0.39 | 0.75 | validated | ⏳ | Shape-only window, day 3; ⏳ footprint what-if |
| La Rioja / San Juan 2025 | AR | 0.40 | ×0.125 (edge) | 0.11 | 0.28 | below bar | ⏳ | none |
| Gran Chaco 2024 | AR/PY | 0.12 | ×0.125 (edge) | 0.24 | — | can't judge (references disagree) | ⏳ | none |

No fire passes the hour-level timing gate under any calibration. That result stands.

## What-if headline numbers (current views)

| View | Wind ×2 | Calm | Drier fuels | Damper fuels |
|---|---|---|---|---|
| Chilecito day 2 (new area in 24 h) | ×1.60 | ×0.74 | −2 pts: ×1.09 | +4 pts: ×0.73 |
| BC day 3 (new area in 24 h) | ×2.23 | ×0.52 | −2 pts: ×1.27 | +4 pts: ×0.43 |
| Córdoba day 5 (new area in 24 h) | ×2.56 | ×0.49 | −2 pts: ×1.19 | +4 pts: ×0.63 |
| Saskatchewan whole fire (final footprint) | ≥ ×3.9 | ×0.26 | −4 pts: ≥ ×3.5 | +2 pts: ×0.39 |

"≥" = the run reached the edge of the simulated area, so the true value is larger. ⏳ Saskatchewan/BC footprint numbers change with S6i.

## Key numbers for slides

- 6 real fires on 3 continents' worth of fuels (Andes foothills, Chaco savanna, Canadian boreal/interior), 2023–2026.
- 2 of 600 candidate fire windows spread freely for 6 days → stalls are the norm.
- Two NASA satellite products agree on burned shape at only Sørensen **0.24–0.66** (fire-connected, whole domain; Chaco 0.12); first-detection day matches burn day within ±1 day for only **30–74 %** of pixels.
- Satellite overpass gaps explain only **0.5–8 h** of the timing error.
- ⏳ S6i: how many fires are shape validated (provisionally 2–3 of 6).
- Every number traceable: `docs/report/rekindle/*.json`, logged runs in DECISIONS.md, Fir job ids.

## Claims we make / don't make (wording rules)

- **Make:**
  - "hindcast of a real fire, calibrated to its satellite-mapped burned area" (shape) or "…to its detections" (old timing calibration);
  - what-ifs are "illustrative" and shown only where the model matched a reference, with the rule stated;
  - "judged against two satellite references";
  - "the equations are verified; the failures point to inputs and missing processes (suppression, crown fire, coarse fuels), not to the equations".
- **Don't make:**
  - "forecast", "predicts", "prediction" as a present capability ("toward prediction" only as roadmap);
  - "validated" without saying *shape*;
  - "the physics is right" (too strong).
- **Update `docs/SUBMISSION.md`:** its judging table still says Rekindle is "validated against the fire's own hotspot timestamps", and the claims list says it reproduces a fire "to a measured timing error". Replace these with the two-reference framing above.

## Judging criteria angle

- **Creativity:** using the harmonized hotspot record as an automatic answer key for a fire model; a second NASA product (MCD64A1, a different measurement from the MODIS instrument) as a partly independent check of that answer key; what-ifs gated by rules, not by eye.
- **Validity:** pre-registered gates; blind tests; every failure published; a ceiling from two partly independent references; verification tests of the solver.
- **Relevance:** NASA FIRMS MODIS + VIIRS (core), MCD64A1, MCD12Q1, MOD44B, MOD44W, MERRA-2, NASADEM; hero fire = the challenge video's Chilecito fire.
- **Impact:** a transparent, global, open way to test fire-spread tools against satellites, and to communicate how wind and dryness change real fires.

## Limits (put on the page)

- Surface fire only: no crowning, spotting, suppression or fire–atmosphere feedback.
- Fuels from 500 m land cover through a coarse crosswalk; one ~50 km weather point per fire.
- Both references are imperfect (pixel size, cloud, smoke, burn-date lag). Shape is scored over the whole simulation domain (40–50 km), so a model spreading past the domain edge is under-penalised (flagged "≥" in the what-ifs).
- The shape calibration and the shape-only windows were defined after the timing tests failed (labelled post-hoc); the timing gate was pre-registered and failed.

## References (verified in the code base or standard)

- Rothermel 1972 (USDA INT-115); Anderson 1982; Albini 1976.
- Cruz & Alexander 2013, Environ. Model. Softw. 47; Price & Germino 2022, Fire Ecology 18; Coen & Schroeder 2013, GRL; Benali et al. 2016, Sci. Total Environ.
- Finney 1998 (FARSITE, RMRS-RP-4); Tymstra et al. 2010 (Prometheus, NOR-X-417).
- Giglio et al. 2018, Remote Sens. Environ. 217 (MCD64A1 C6 algorithm); MCD64A1 v061 doi:10.5067/MODIS/MCD64A1.061.
- Full list with DOIs: `docs/report/rekindle/references.bib` and the app's Rekindle credits.

## Where things are

- Code:
  - `rekindle/hindcast.py` (timing calibration, windows);
  - `burst.py` (window what-ifs);
  - `shape_whatif.py` (footprint what-ifs);
  - `burned_area.py` (MCD64A1 check);
  - `calibrate_shape.py` and `promote_shape.py` (S6i).
- Results: `docs/report/rekindle/` (`*_calibration.json`, `*_windows.json`, `*_burst.json`, `*_shape_whatif.json`, `burned_area_check.json`, `*_shape_calibration.json`).
- App: `/rekindle` tab (fire picker, three what-if views, green MCD64A1 outline) and `/methodology`.
