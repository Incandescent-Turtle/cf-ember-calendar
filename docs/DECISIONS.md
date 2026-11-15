# DECISIONS.md — deviations, discrepancies, handoffs

Format: date — what — why — who is affected.

## Discrepancies found in the data (S1, 2026-11-14)

- 2026-11-14 — **NOAA-20 SP starts 2018-04-01**, not 2020-01-01 (country zips and Archive Download agree). — Seen with `pipeline.inspect`. — Track A (the `k_N20` fit window can start earlier than 2020-06 if wanted; left at 2020-06 for now), DATA.md updated.
- 2026-11-14 — **MODIS starts 2000-11-01**, not 2000-11-11. So the first dekad is `t = 30`, not 31. — Data. — CONTRACTS.md `manifest.dekad_range` example note updated; the web track must read `dekad_range` from the manifest, never hard-code it.
- 2026-11-14 — Archive Download VIIRS files use `brightness`/`bright_t31` (not `bright_ti4`/`bright_ti5`); S-NPP Archive Download has `instrument = SNPP`; NRT files have no `type` column. — Data. — Ingest handles both name sets; DATA.md updated.
- 2026-11-14 — Global set on disk lacks S-NPP 2022 and NOAA-20 2024. — Download gap. — Must be fetched before the global build, or 2022 will be MODIS/NOAA-20 only (S-NPP 2022 lies outside the 2013–2021 fit window, but it is inside the harmonized VIIRS era).
- 2026-11-14 — The Argentina fixtures are full Argentina 2000→2026-11-14 (≈ 6.5 M rows, ~530 MB CSV), not "one month per sensor". — It is what was downloaded; a fixture build takes about a minute, which is fine. Unit tests use tiny synthetic CSVs instead.
- 2026-11-14 — Chilecito cluster confirmed: 2026-07-27 → 08-01, lat −29.05…−29.24, lon −67.62…−67.78, peak Jul 28 (167 NOAA-20, 78 S-NPP, 19 MODIS detections). VIIRS SP ends Jul 31, so Aug 1 is NRT only. — Track C (prep.py).
