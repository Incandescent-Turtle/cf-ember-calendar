# REKINDLE.md — fire-spread hindcast and counterfactual simulator

**Workflow per fire:** (1) *hindcast* the real fire from its first hotspots with the real weather, terrain and fuels; (2) compare simulated arrival times with the observed hotspots and tune **one** global ROS multiplier; (3) if the baseline passes the quality gate (§5), run the counterfactual grid with the multiplier fixed. Hotspots are never modified or used as model input beyond ignition and the check. The satellite data is the answer key, not the physics.

**Vocabulary:** *hindcast/baseline* = validated against detections. *Counterfactual* = baseline with one input changed (wind, moisture); nothing can validate it, so it is **illustrative**. Not a forecast: no forecast weather, no live perimeter.

**Method (decided):** level-set front propagation, solved with upwind finite differences, with a direction-dependent rate of spread from the **Rothermel (1972) surface fire model** (Albini 1976 revisions), via an **elliptical fire shape**.

Why this, not isotropic FMM: wind and slope make spread direction-dependent (anisotropic). Standard FMM's causality ordering is only valid for isotropic speed, so it gives wrong fronts under wind. Level-set handles anisotropy, merges multiple ignitions automatically, gives perimeters at every timestep, and is the approach used in WRF-SFIRE. ADR and isotropic FMM are post-hackathon comparison methods for the GEOE 443 report. Keep the `Simulator` interface pluggable.

## Scope this weekend

- **The engine accepts any ignition point and time window** (`rekindle.prep` takes lat/lon + dates; nothing in the solver references hotspots). **The shipped product contains only a curated list** in `rekindle/fires.yaml`: `chilecito-2026` first, then one more Argentine and one Canadian fire. Stop at three. An arbitrary point with no hotspots can run, but is labelled `status: "uncalibrated"` (uses the multiplier fitted on the curated fires; no validation).
- **Everything is precomputed offline** (desktop CPU or a cluster job array) over a scenario grid and shipped as static rasters. No solver runs in production; free-drawn firebreaks/ignitions are cut. The GTX 1070 isn't needed.
- Surface fire only. No crown fire, spotting, suppression, or fire–atmosphere feedback. State this in the UI.

## Package layout

```
rekindle/
  rothermel.py     # pure functions, imperial units internally, SI in/out wrappers
  fuels.py         # fuel model table (Anderson 13) + IGBP crosswalk
  ellipse.py       # length-to-breadth, R(θ)
  levelset.py      # solver
  domain.py        # load/prep domain rasters (UTM, dx in metres)
  scenario.py      # dataclasses: Scenario (wind, moisture, ignitions, barriers, multipliers)
  metrics.py       # compare sim vs observed hotspots
  simulators.py    # Simulator protocol + LevelSetRothermel implementation
tests/rekindle/
```

```python
class Simulator(Protocol):
    name: str
    def run(self, domain: Domain, scenario: Scenario) -> SimResult: ...
# SimResult: arrival_time_s (2D float array, inf = unburned), isochrones (list of (t, GeoJSON)),
#            ros_head (2D), metrics (dict), params_hash
```

## 1. Rothermel surface spread

Implement exactly from **Rothermel 1972 (INT-115)** with **Albini 1976 (INT-30)** multi-class weighting, cross-checked against **Andrews 2018 (RMRS-GTR-371)**, which documents BehavePlus's implementation. Work internally in imperial units (ft, lb, Btu, min) as the original equations do; convert at the boundary.

Core chain (single characteristic class shown; implement the full dead/live size-class weighting):

```
ρ_b = w_0 / δ                         bulk density
β   = ρ_b / ρ_p                       packing ratio (ρ_p = 32 lb/ft³)
β_op = 3.348 σ^-0.8189                optimum packing ratio
Γ'_max = σ^1.5 / (495 + 0.0594 σ^1.5)
A   = 133 σ^-0.7913                   (Albini 1976 revision, as in BehavePlus / Andrews 2018 Table 6c; Rothermel 1972 eq 39 original: A = 1 / (4.774 σ^0.1 − 7.27))
Γ'  = Γ'_max (β/β_op)^A exp[A(1 − β/β_op)]
η_M = 1 − 2.59 r_M + 5.11 r_M² − 3.52 r_M³,   r_M = min(M_f / M_x, 1)
η_s = 0.174 S_e^-0.19, max 1          (S_e = 0.010 effective mineral content; the cap is Albini's)
I_R = Γ' w_n h η_M η_s                reaction intensity   (w_n = w_0(1 − S_T), S_T = 0.0555, h = 8000 Btu/lb)
ξ   = exp[(0.792 + 0.681 σ^0.5)(β + 0.1)] / (192 + 0.2595 σ)
ε   = exp(−138 / σ)
Q_ig = 250 + 1116 M_f
φ_w = C U^B (β/β_op)^-E,  C = 7.47 exp(−0.133 σ^0.55), B = 0.02526 σ^0.54, E = 0.715 exp(−3.59e-4 σ)   (U = midflame wind, ft/min)
φ_s = 5.275 β^-0.3 tan²(slope)
R   = I_R ξ (1 + φ_w + φ_s) / (ρ_b ε Q_ig)          (ft/min)
```

**Wind + slope direction:** treat φ_w (along wind direction) and φ_s (upslope direction) as vectors, sum them → φ_E magnitude and head direction. Effective wind speed U_E = [φ_E (β/β_op)^E / C]^(1/B). Head ROS: R_head = R_0 (1 + φ_E). Optional wind limit U_E ≤ 0.9 I_R (make it a flag, default off, note it).

**Fuel models:** Anderson (1982, INT-122) 13 models — transcribe loads (1-h, 10-h, 100-h, live), SAV ratios, depth, moisture of extinction from the published table into `rekindle/data/anderson13.csv` with a citation row. Double-check every value.

**IGBP → fuel model crosswalk (assumption — user-overridable, state it):**

| IGBP class | Fuel model |
|---|---|
| 1–5 forests | FM 9 (hardwood/long-needle litter) default; FM 10 for evergreen needleleaf |
| 6 closed shrubland | FM 4 |
| 7 open shrubland | FM 6 |
| 8 woody savanna, 9 savanna | FM 2 |
| 10 grassland | FM 1 (FM 3 "tall grass" via override) |
| 12 cropland | FM 1 |
| 14 cropland/natural mosaic | FM 2 |
| 11 wetland, 13 urban, 15 snow/ice, 16 barren, 17 water | non-burnable (R = 0) |

Plus MOD44W water → non-burnable.

**Moisture defaults (sliders):** 1-h 6%, 10-h 7%, 100-h 8%, live herbaceous 60%, live woody 90% (a dry-summer scenario). Optional: estimate 1-h moisture from MERRA-2 T2M/RH via a simple equilibrium moisture content formula — stretch only.

**Wind:** MERRA-2 hourly U10M/V10M at the domain centre (or bilinear per cell — single value is fine for v1), linear in time. 10 m → 20 ft: ÷1.15. Midflame = WAF × U_20ft, WAF default 0.4 (slider). Direction: wind "from" → spread "toward" = from + 180°.

**Unit tests:** reproduce published reference values (find a worked example in Andrews 2018 or a BehavePlus run table for FM 1 / FM 4 at stated moisture/wind/slope) to within 1%. Monotonicity tests: R increases with wind and slope; decreases with moisture; R = 0 when M_f ≥ M_x.

## 2. Elliptical spread

Length-to-breadth ratio (Anderson 1983 eq 17 converted to m/s, offset to LB(0) = 1: Finney 1998 eq 13), U_E = effective midflame wind in **m/s** (verified S5; mi/h was wrong):
```
LB = 0.936 e^(0.2566 U) + 0.461 e^(−0.1548 U) − 0.397      (clamp 1 ≤ LB ≤ 8)
e  = sqrt(LB² − 1) / LB
R(θ) = R_head (1 − e) / (1 − e cos θ)       θ = angle between spread direction and head direction
```
(ignition at the rear focus: backing rate R_head(1 − e)/(1 + e)).

## 3. Level-set solver

Grid: domain reprojected to local UTM, square cells **dx = 60–120 m** (default 90 m; 30 m "hi-res" mode precomputed only). φ < 0 burned, φ > 0 unburned, front = {φ = 0}.

```
∂φ/∂t + S(x, n) |∇φ| = 0,     n = ∇φ / |∇φ|  (outward normal),   S = R(θ_n) from the ellipse at that cell
```

- **Normal direction**: n from central differences of φ (guard |∇φ| → 0).
- **Speed in normal direction** (changed in S5): S = support function of the elliptical wavelet, S = c cos θ + sqrt(a² cos² θ + b² sin² θ) with a = (R_h + R_b)/2, c = (R_h − R_b)/2, b = a/LB (Huygens; Richards 1990), so a point ignition grows exactly the ellipse. The approximation S = R(θ_n) over-elongates fronts (LB 19–117 % too large in test 2) and is kept only as `normal_speed="polar"` for the course-report comparison.
- **|∇φ| (Godunov upwind, S ≥ 0):**
  `|∇φ|² ≈ max(D⁻ₓφ,0)² + min(D⁺ₓφ,0)² + max(D⁻ᵧφ,0)² + min(D⁺ᵧφ,0)²`
  (one-sided differences D⁻, D⁺ — the forward/backward differences from GEOE 443 FD lectures).
- **Time stepping:** Heun (RK2). Adaptive Δt = CFL · dx / max(S over the narrow band), CFL = 0.5. Cap Δt ≤ 60 s so hourly wind updates are honoured.
- **Arrival time:** when a cell's φ changes sign (+ → −) between t and t + Δt, set T = t + Δt·φ_old/(φ_old − φ_new).
- **Reinitialization:** every 20 steps, `φ = skfmm.distance(φ, dx=dx)` to keep φ a signed distance (sign preserved).
- **Initial condition:** signed distance to ignition circles (radius = 1.5 dx) at each ignition point; multiple ignitions allowed.
- **Barriers / non-burnable:** S = 0. Drawn firebreak lines are rasterized to non-burnable cells (width ≥ 1 cell).
- **Boundaries:** zero-gradient (copy edge values); stop if the front reaches the edge and flag it.
- **Performance:** vectorized NumPy on a narrow band (|φ| < 6 dx) — target < 30 s for a 24 h simulation on a ~400 × 400 grid. If too slow, `numba.njit` the stencil.

**Solver tests (write first):**
1. Uniform fuel, no wind, no slope → circular front; radius at time t = R_0·t within 2 dx; check circularity (no axis/diagonal bias beyond 5%).
2. Uniform wind → ellipse with the expected LB (±10%) and head rate R_head.
3. Two ignitions → fronts merge, single connected burned region.
4. Non-burnable strip → front stops; no leakage.
5. Halve dx → arrival times converge (report the order of convergence — good for the course report).

## 4. Demo domain prep (offline script)

`uv run python -m rekindle.prep --fire chilecito-2026 --bbox W,S,E,N --start YYYY-MM-DD --end YYYY-MM-DD`

1. Pull this fire's hotspots for the bbox/window (all VIIRS + MODIS). The desktop doesn't have the global table: read the relevant `points/<tile>/<year>.parquet` files from the data host, or export a small bbox extract from the cluster (`pipeline` provides `--extract-bbox`). Find the cluster; ignition = earliest detection(s) (allow up to 3 if several appear in the first overpass).
2. Clip NASADEM, MCD12Q1 (year before the fire), MOD44W to bbox + 5 km buffer; reproject to UTM at dx; compute slope/aspect.
3. MERRA-2 hourly U10M/V10M (+T2M, QV2M) for the window.
4. Save `data/rekindle/<fire_id>/domain.npz` (elevation, slope, aspect, fuel_model, nonburnable, transform) + `meta.json` (bbox, crs, dx, window, ignitions, wind series, observed detections with times and pixel footprints).

**Choosing curated fires** by inspecting the data: (1) the July 2026 cluster near Chilecito, La Rioja; (2) one more Argentine fire; (3) one Canadian fire. Prefer fires with several days of burning and many overpasses (VIIRS + MODIS), since sparse detections cannot constrain the spread. Check DEM coverage: NASADEM/SRTM covers 60°N–56°S, so **northern Canada needs another DEM** (Copernicus GLO-30 or CDEM); pick a Canadian fire south of 60°N unless you have time. Fuels everywhere come from the same global land-cover crosswalk (one code path). Canada and Argentina have no US-style fuel maps; that is a known limitation, listed below.

## 5. Validation against the fire's own hotspots

Hotspot timestamps give **observed arrival times** (upper bounds: the fire reached that pixel no later than the overpass that saw it). For a baseline (actual-conditions) run:

- **Timing error:** for each observed detection's first-detection cell, Δ = T_sim − t_obs. Report median and IQR (hours). Negative = sim arrives earlier than first observation (expected, since observation is an upper bound).
- **Hit rate:** fraction of observed detections whose location is inside the simulated burned area at t_obs + 1 overpass interval.
- **Overlap:** Sørensen index between the simulated burned area at end time and the observed footprint union (detection pixels using scan × track), and the false-alarm area.
- **Global ROS multiplier calibration:** sweep the multiplier over [0.25, 4] on the baseline run, pick the value minimizing median |Δ|; report it honestly ("we needed ×1.8, consistent with the known underprediction of Rothermel at coarse resolution").

Show these numbers in the Rekindle panel next to the run.

**Honesty rules.** The multiplier is fitted on the baseline, so a match on the fitted fire is *calibrated*, not a blind test. If ≥ 2 fires exist, fit on one and score the others with the multiplier **unchanged**, and report that. **Quality gate:** ship counterfactuals for a fire only if its baseline hit rate and timing error are reported and the median |Δ| is no worse than ~one overpass interval after calibration; otherwise ship the baseline only, marked "poor agreement". Absolute arrival times are less reliable than baseline-vs-counterfactual *differences* (shared fuel error largely cancels), so UI emphasis goes on differences.

## 6. Scenario grid (offline) and the UI

Because nothing runs live, counterfactuals are a **precomputed grid** around the baseline. File formats: `CONTRACTS.md` → "Rekindle files".

**Grid (per demo fire):**
- wind speed at 10 m: 0, 3, 6, 9, 12, 15 m/s
- wind direction (from): 0, 45, …, 315° (8 compass points)
- dead fuel moisture (1-h value; 10-h = +1, 100-h = +2 points): 4, 6, 10, 14 %
- Live moisture, fuel map, ignitions, ROS multiplier: fixed at baseline.
- = 6 × 8 × 4 = **192 runs + the baseline run** (observed weather). At ~0.5–2 min per run that is a few hours on one core or tens of minutes with `multiprocessing` on the desktop; trivially parallel as a cluster job array.

**Optional named scenarios** (cheap extras, only if ahead): the other demo fire's weather applied to this fire's terrain (and vice versa — a weather-swap "transplant"); one fixed firebreak across the head of the fire.

**Pipeline:** `scenario_grid.py` runs the grid and writes each arrival-time field; `export.py` converts to the EPSG:3857-aligned `u16.gz` rasters, computes `burned_km2_by_hour`, and writes `runs/index.json` with the baseline's validation metrics (section 5).

**UI:** three sliders snapping to the grid axes; the matching run loads (≈ 80 KB). Show: the arrival-time layer (sequential ramp, hours), isochrones every 1–3 h derived client-side (`d3-contour`), observed hotspots by time, burned area vs time (baseline vs selected), and the baseline's measured timing error and hit rate. Label clearly: "precomputed scenarios, surface fire only."

## 7. Output files

See `CONTRACTS.md`. Everything lands in `web/public/rekindle/` and ships with the SPA (budget ≈ 15–20 MB per fire; Pages allows 25 MiB per file and 20,000 files).

## Intended use and limits (show in UI and methodology)
**Intended use:** explore how wind and fuel dryness change the spread of a real past fire; a step toward planning tools. **Not** a forecast. Roadmap (say it as roadmap only): better fuel maps (LANDFIRE-class, Canadian fuel-type layer), forecast weather, starting from a current perimeter.

Limitations: surface fire only; no spotting/crowning; fuel map from 500 m land cover with a coarse crosswalk is the largest error source; single-point wind; moisture is a user scenario, not measured; normal-speed approximation for the ellipse; hotspot arrival times are upper bounds limited by overpass frequency.
