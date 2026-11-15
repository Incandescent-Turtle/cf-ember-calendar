# SUBMISSION.md — judging and the demo

## Judging criteria → what proves each one

Global judging uses five criteria (score 1–5 each): **Impact, Creativity, Validity, Relevance, Presentation**. The text below paraphrases the guide's "score of 5" descriptions and maps each to concrete evidence in our project.

| Criterion | "5" looks like | Our evidence (must be visible in the demo or project page) |
|---|---|---|
| **Impact** | Significant problem, broad reach, benefits many | MODIS ends in 2027 (Terra ~Jan 2027, Aqua ~Sep 2027); S-NPP's FIRMS stream already stopped 2026-11-02. Without harmonization, ~25 years of baseline become incomparable exactly when fire weather is intensifying. Tool works for **any AOI on Earth**, free and open, CSV export for responders' GIS. |
| **Creativity** | Novel concept or meaningful improvement | (1) AOI-adaptive calibration with a transparent strata fallback and an uncertainty band; (2) **Rekindle**: counterfactual replay of real fires, **validated against the fire's own hotspot timestamps**; (3) the "MODIS-continuity" counterfactual series. |
| **Validity** | Scientifically sound, feasible, complete, usable | Methodology page: FCD unit rationale, 2013–2021 calibration, leave-one-year-out metrics vs baselines, seam test, limitations. Rekindle: Rothermel + Albini, published fuel models, solver convergence tests, measured timing error. Live deployed app. |
| **Relevance** | Directly addresses the challenge; NASA data integral | Exactly the two-part brief: harmonization → calendar web app with region selection, historical comparison, critical periods, anomalies vs median, accessible colour ramps, CSV download. NASA data: FIRMS MODIS + VIIRS (core), NASADEM/SRTM, MCD12Q1, MOD44W, MERRA-2 (Rekindle). Hero region is the challenge video's own fire (Chilecito, La Rioja, Jul 2026). |
| **Presentation** | Clear, engaging, structured storytelling | 30 s video with one story; clean README with screenshots; methodology page readable by a non-specialist. |

## Demo format: 30-second video (hard limit — over 30 s = ineligible for Global Judging)

Alternative is ≤ 7 slides; video is the stronger choice for an interactive app. Record screen at 1080p, voice-over, burned-in captions, no music needed.

### Script (≈ 75 words spoken; rehearse with a timer)

| Time | Visual | Voice-over |
|---|---|---|
| 0:00–0:02 | Title card: name, "Team: <name>" | "I'm Rory Macdonald, team <name>." |
| 0:02–0:05 | FIRMS raw counts jumping at 2012 (raw MODIS vs VIIRS chart) | "MODIS is retiring. Its 25-year fire record doesn't match VIIRS." |
| 0:05–0:10 | Logo + tagline; calendar morphs raw → harmonized | "Ember Calendar harmonizes them into one consistent record, worldwide." |
| 0:10–0:20 | Draw AOI around Chilecito → calendar → "July 2026: <Nth> percentile" badge → critical period → CSV export click | "Draw any area: see its fire calendar, critical months, and how this month compares to 25 years. Export it all." |
| 0:20–0:30 | Rekindle: real hotspots animate; wind slider up; counterfactual front overtakes | "Rekindle replays a real fire, then asks what stronger wind would have changed: an illustrative tool toward planning and prevention." |

(Fill real numbers from the app before recording; never show invented values.)

### Claims we make and don't make
- **Make:** harmonized, validated series (show LOYO and the seam test); Rekindle *reproduces* a past fire to a measured timing error and hit rate (say it is calibrated on that fire); counterfactuals are *illustrative*; with better fuel maps, forecast weather and a live perimeter the same engine could support prediction (roadmap, one sentence).
- **Don't make:** "predicts fires", "forecast", "better than FIRMS", "first", or absolute spread times as fact. Validity is a scored criterion; over-claiming costs more than modesty.
- **FIRMS comparison (one line for the page):** "FIRMS shows you the fire; we show whether it's unusual, and what it would have done under different conditions."

### Recording checklist
- [ ] Hero AOI pre-warmed (no spinners on camera); browser zoom 110%; hide bookmarks bar; dark or light theme consistently.
- [ ] Captions burned in; final length ≤ 0:29 to be safe.
- [ ] Upload (YouTube unlisted or as required by the submission form); test link from incognito.

## Project page checklist (spaceappschallenge.org)

Check the 2026 Project Submission Guide for exact required fields before writing — it was released Nov 13.
- [ ] Project title + one-line summary.
- [ ] Demo link (video ≤ 30 s or slides ≤ 7).
- [ ] **Final project link: public GitHub repo** + live app URL.
- [ ] Description: problem → harmonization method (FCD, calibration, validation) → app features → Rekindle → impact → limitations.
- [ ] **NASA data used** (list each dataset with link); any Space Agency Partner resources used.
- [ ] Tools/languages/software list.
- [ ] Use of AI: disclose coding agents if the form/guide asks (check the guide).
- [ ] Team member names; challenge selected: *Harmonization of MODIS and VIIRS Hot Spots*.

## README must contain
Live link (top), 30 s video embed/link, 3 screenshots (calendar, methodology seam chart, Rekindle), "How it works" (5 bullets), NASA data table, run locally, limitations, references, license (MIT or Apache-2.0).

## References to cite
- Giglio et al. — MODIS Collection 6/6.1 active fire product (MCD14) user guide.
- Schroeder et al. 2014 — VIIRS 375 m active fire detection algorithm.
- Rothermel 1972 (INT-115); Albini 1976 (INT-30); Anderson 1982 (INT-122); Anderson 1983 (length-to-breadth); Andrews 2018 (RMRS-GTR-371).
- Osher & Sethian 1988 (level-set); Mandel et al. 2011 (WRF-SFIRE).
- Remote Sensing 18(10):1650 (2026) — MODIS/VIIRS FRP fusion; GFED5NRT (ESSD 2026); MRBA60 (Plinius 2026).
- NASA FIRMS, NASADEM, MCD12Q1, MOD44W, MERRA-2 dataset DOIs.
