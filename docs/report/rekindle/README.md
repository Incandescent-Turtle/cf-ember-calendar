# Rekindle engine verification (S5) — material for the LaTeX report

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
| `chilecito-2026_detections_by_hour.csv` | Hotspots per overpass hour and sensor (FIRMS, fixture) | |
| `chilecito-2026_first_detections.csv` | First overpass = ignition candidates | |

Key results (see docs/DECISIONS.md, S5 handoff, for the full list):
- Rothermel reproduces Andrews 2018 Table 17 rows 1–3 (BehavePlus 6) to ≤ 0.12 %.
- Test 2 shows why the solver uses the Huygens (support-function) normal speed: with the
  polar approximation S = R(θ_n) LB comes out 19–117 % too large; with Huygens ≤ 2 %.
- Convergence: first order (observed 0.8–1.3), as expected for first-order Godunov upwinding.
