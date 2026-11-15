# Rekindle engine verification (S5) and Chilecito hindcast (S6) — material for the LaTeX report

Regenerate: `uv run python -m rekindle.verification_report --out docs/report/rekindle`
(~2 min, desktop). Every number is in `results.json`; BibTeX keys in `references.bib`.
Detections: `uv run python -m rekindle.hotspots --fire chilecito-2026` (reads data/processed/points).

| File | What it shows | Cite |
|---|---|---|
| `figures/rothermel_curves.*` | Head ROS vs midflame wind; R0 vs 1-h moisture, FM 1/2/4/8/10 | rothermel1972, albini1976, anderson1982 |
| `figures/length_to_breadth.*` | LB(U): Finney eq 13 (used), Anderson eq 17 (mi/h), and the doc's unit error | anderson1983, finney1998 |
| `figures/test1_circle.*` | No wind: solver isochrones vs exact circles | osher2003 |
| `figures/test2_ellipse.*` | U10 = 9 m/s: solver vs exact ellipse (rear focus) | richards1990, finney1998 |
| `figures/test3_4_merge_barrier.*` | Two ignitions merge; 1-cell non-burnable strip holds | |
| `figures/test5_convergence.*` | Mean relative arrival-time error vs dx, circle and wind case | |
| `figures/test6_7_slope_windshift.*` | Test 6 slope (head upslope at Rothermel R_head, −0.1 %); test 7 wind turning 270°→180° mid-run | rothermel1972 |
| `figures/benchmark_400_{moderate,large}.*` | 24 h on 400 × 400 at 90 m, synthetic hill + mixed fuels | |
| `figures/chilecito-2026_calibration.*` | Shipped baseline (frozen S6b model A+B, since S6b; the S6 version is `*_s6_*`) ROS-multiplier sweep ×0.25–4: median Δ and |Δ|, hit rate, Sørensen, the gate | rothermel1972, merra2_m2t1nxslv, firms |
| `figures/chilecito-2026_baseline_map.*` | Baseline ×1.41 arrival time vs FIRMS detections; GLO-30 elevation; fuels | copernicus_dem_glo30, mcd12q1_v061, mod44w_v061, firms |
| `{chilecito-2026,cordoba-2024}_spread_profile.json`, `figures/*_spread_profile.*` | Burst-and-stall diagnostic: farthest detection per overpass vs the calibrated model's head run (`rekindle.spread_profile`) | firms |
| `cordoba-2024_calibration.json`, `figures/cordoba-2024_{calibration,baseline_map}.*` | Córdoba shipped baseline (A+B, blind test) | firms |
| `chilecito-2026_calibration.json` | Every hindcast number: sweep, gate, moisture estimate (Simard EMC), metrics | simard1968 |
| `chilecito-2026_detections_by_hour.csv` | Hotspots per overpass hour and sensor (FIRMS, fixture) | |
| `chilecito-2026_first_detections.csv` | First overpass = ignition candidates | |

Key results (see docs/DECISIONS.md, S5 handoff, for the full list):
- Rothermel reproduces Andrews 2018 Table 17 rows 1–3 (BehavePlus 6) to ≤ 0.12 %.
- Test 2 shows why the solver uses the Huygens (support-function) normal speed: with the
  polar approximation S = R(θ_n) LB comes out 19–117 % too large; with Huygens ≤ 2 %.
- Convergence: first order (observed 0.8–1.3), as expected for first-order Godunov upwinding.

S6 (regenerate: `uv run python -m rekindle.hindcast --fire chilecito-2026 --workers 3`, ~17 min;
map only: `--figures-only`):
- Tests 6–10: slope head rate −0.1 % vs Rothermel; wind shift 270°→180°: late north rate
  0.456 vs 0.458 m/s expected, late east (flank) 0.171; ×2 multiplier halves arrival times
  exactly (0 s difference on 6,698 cells); FM 1→FM 12 interface rates within 0.1 %.
- Chilecito baseline **fails the quality gate**: best ×1.41, median |Δ| 13.3 h vs gate 3.2 h
  (mean interval between overpasses); hit rate 0.66; Sørensen 0.14 (1,479 km² simulated vs
  112 km² detection footprints). Status `poor_agreement`: baseline only, no counterfactuals.
- Data credits: `rekindle/credits.py` (exact strings) and the data entries in `references.bib`.

S6b additions: `*_spread_profile.*` (all three fires), `sask-2023_*` (blind test of a pre-screened fire), `*_x_win24*_windows.json` (EXPLORATORY 24 h re-initialised windows), `candidates_{argentina,canada}_screen.json` (free-spread pre-screen; thresholds in DECISIONS.md).
