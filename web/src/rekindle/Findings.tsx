// Rekindle validation summary (docs/DECISIONS.md, S6b): the gate, every Chilecito variant, the Córdoba
// blind test, the burst-and-stall diagnosis and the literature. Numbers are copied from the logged runs
// (docs/report/rekindle/*_calibration.json); shown on the Rekindle tab and the methodology page.

interface Row {
  fire: string;
  variant: string;
  mult: string;
  medAbs: number;
  gate: number;
  label?: 'blind' | 'exploratory';
}

const ROWS: Row[] = [
  { fire: 'Chilecito 2026', variant: 'S6 model (no changes)', mult: '1.41', medAbs: 13.3, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'A: MOD44B non-vegetated > 50 % non-burnable', mult: '1.41', medAbs: 12.87, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'A′: non-vegetated > 80 % (sensitivity)', mult: '1.41', medAbs: 13.35, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'B: hourly time-lag dead fuel moisture', mult: '1.41', medAbs: 12.38, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'A+B (frozen model, shipped)', mult: '1.41', medAbs: 12.04, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'C: MERRA-2 nearest grid point', mult: '2.0', medAbs: 13.3, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'A+B+C', mult: '1.41', medAbs: 12.26, gate: 3.2 },
  { fire: 'Chilecito 2026', variant: 'Seeded start: detections in the first 3 h as ignitions', mult: '0.5', medAbs: 10.24, gate: 3.2, label: 'exploratory' },
  { fire: 'Chilecito 2026', variant: 'A+B with the seeded start', mult: '0.5', medAbs: 9.61, gate: 3.2, label: 'exploratory' },
  { fire: 'Córdoba 2024', variant: 'A+B frozen before any Córdoba run', mult: '0.25 (sweep edge)', medAbs: 15.16, gate: 2.9, label: 'blind' },
  { fire: 'N. Saskatchewan 2023', variant: 'A+B frozen; fire chosen by the free-spread pre-screen', mult: '4.0 (sweep edge)', medAbs: 22.38, gate: 1.7, label: 'blind' },
  { fire: 'Chilecito 2026', variant: 'A+B restarted every 24 h from the detected extent', mult: '2.0', medAbs: 8.13, gate: 3.2, label: 'exploratory' },
  { fire: 'Córdoba 2024', variant: 'A+B restarted every 24 h from the detected extent', mult: '0.5', medAbs: 9.13, gate: 2.9, label: 'exploratory' },
  { fire: 'N. Saskatchewan 2023', variant: 'A+B restarted every 24 h from the detected extent', mult: '4.0 (sweep edge)', medAbs: 12.14, gate: 1.7, label: 'exploratory' },
  { fire: 'C. British Columbia 2024', variant: 'A+B frozen; demo fire from the screen (fails only the plateau rule)', mult: '2.0', medAbs: 41.7, gate: 1.8 },
  { fire: 'La Rioja / San Juan 2025', variant: 'A+B frozen; demo fire, passes every screen rule', mult: '0.25 (sweep edge)', medAbs: 17.1, gate: 3.3 },
  { fire: 'Gran Chaco 2024', variant: 'A+B frozen; demo fire from the screen (sparse detections)', mult: '0.25 (sweep edge)', medAbs: 61.1, gate: 4.9 },
];

// S6c: every 24 h window at its own best multiplier (docs/report/rekindle/<fire>_burst.json).
const WINDOWS = [
  { fire: 'Chilecito 2026', day: 'Day 2', mult: '0.5', medAbs: 2.3, gate: 3.2, sor: 0.46, verdict: 'qualifies: what-ifs shown' },
  { fire: 'Córdoba 2024', day: 'Day 1', mult: '0.35', medAbs: 3.2, gate: 2.9, sor: 0.53, verdict: 'near miss (timing)' },
  { fire: 'N. Saskatchewan 2023', day: 'Day 3', mult: '4.0', medAbs: 1.75, gate: 1.67, sor: 0.82, verdict: 'near miss (timing)' },
  { fire: 'N. Saskatchewan 2023', day: 'Day 6', mult: '2.83', medAbs: 0.1, gate: 1.67, sor: 0.91, verdict: 'excluded: only 2 h long' },
  { fire: 'C. British Columbia 2024', day: 'Day 3', mult: '1.0', medAbs: 8.57, gate: 1.76, sor: 0.67, verdict: 'shape only: what-ifs shown (post-hoc rule)' },
  { fire: 'Córdoba 2024', day: 'Day 5', mult: '0.5', medAbs: 10.4, gate: 2.9, sor: 0.65, verdict: 'shape only: what-ifs shown (post-hoc rule)' },
];

// S6h: docs/report/rekindle/burned_area_check.json (rekindle.burned_area), whole-fire baselines.
const REFS = [
  { fire: 'Chilecito 2026', ceil: 0.66, tMult: '1.41', tMcd: 0.2, tRaw: '12.0 h', sMult: '0.125 (edge)', sMcd: 0.3, ratio: '0.46', status: 'below bar', sRaw: 'median pixel never reached' },
  { fire: 'Córdoba 2024', ceil: 0.59, tMult: '0.25', tMcd: 0.22, tRaw: '15.2 h', sMult: '0.125 (edge)', sMcd: 0.3, ratio: '0.50', status: 'below bar', sRaw: '76.6 h' },
  { fire: 'N. Saskatchewan 2023', ceil: 0.25, tMult: '4.0', tMcd: 0.19, tRaw: '22.4 h', sMult: '2.83', sMcd: 0.22, ratio: '0.90', status: "can't judge (ceiling < 0.3)", sRaw: '27.1 h' },
  { fire: 'C. British Columbia 2024', ceil: 0.53, tMult: '2.0', tMcd: 0.32, tRaw: '41.7 h', sMult: '1.0', sMcd: 0.38, ratio: '0.72', status: 'shape validated', sRaw: '48.2 h' },
  { fire: 'La Rioja / San Juan 2025', ceil: 0.39, tMult: '0.25', tMcd: 0.06, tRaw: '17.1 h', sMult: '0.125 (edge)', sMcd: 0.11, ratio: '0.28', status: 'below bar', sRaw: '46.2 h' },
  { fire: 'Gran Chaco 2024', ceil: 0.12, tMult: '0.25', tMcd: 0.1, tRaw: '61.1 h', sMult: '0.125 (edge)', sMcd: 0.26, ratio: '—', status: "can't judge (ceiling < 0.3)", sRaw: '72.3 h' },
];

const REFERENCES = [
  'Cruz, M. G. & Alexander, M. E. (2013). Uncertainty associated with model predictions of surface and crown fire rates of spread. Environmental Modelling & Software 47, 16–28. doi:10.1016/j.envsoft.2013.04.004',
  'Price, W. J. & Germino, M. J. (2022). Modeling of fire spread in sagebrush steppe using FARSITE. Fire Ecology 18, 23. doi:10.1186/s42408-022-00147-2',
  'Coen, J. L. & Schroeder, W. (2013). Use of spatially refined satellite remote sensing fire detection data to initialize and evaluate coupled weather-wildfire growth model simulations. Geophysical Research Letters. doi:10.1002/2013GL057868',
  'Giglio, L., Boschetti, L., Roy, D. P., Humber, M. L. & Justice, C. O. (2018). The Collection 6 MODIS burned area mapping algorithm and product. Remote Sensing of Environment 217, 72–85. doi:10.1016/j.rse.2018.08.005',
  'Finney, M. A. (1998). FARSITE: Fire Area Simulator — model development and evaluation. Research Paper RMRS-RP-4, USDA Forest Service, Rocky Mountain Research Station.',
  'Tymstra, C., Bryce, R. W., Wotton, B. M., Taylor, S. W. & Armitage, O. B. (2010). Development and structure of Prometheus: the Canadian Wildland Fire Growth Simulation Model. Information Report NOR-X-417, Natural Resources Canada.',
  'Benali, A. et al. (2016). Deciphering the impact of uncertainty on the accuracy of large wildfire spread simulations. Science of the Total Environment 569–570, 73–85. doi:10.1016/j.scitotenv.2016.06.112',
];

export function RekindleFindings({ headingLevel = 3 }: { headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const Hs = `h${Math.min(headingLevel + 1, 4)}` as 'h3' | 'h4';
  return (
    <div className="rk-findings">
      <p className="rk-status hindcast" role="note">
        <strong>Status: hindcasts of six real fires, judged against hotspots (timing) and MODIS burned area (shape). None passes the hour-level timing gate; one (British Columbia) is
        shape validated</strong> and carries whole-fire footprint what-ifs. One 24 h window (Chilecito, day 2) matched the hotspots in timing and carries <strong>exploratory, post-hoc</strong>{' '}
        what-ifs. Shape-only views: British Columbia day 3 and Córdoba day 5 (best-matching windows), and Saskatchewan (whole fire, a developer exception). La Rioja and Gran Chaco ship as
        hindcasts only.
      </p>
      <H>What validation showed</H>
      <p>
        <strong>The gate.</strong> A baseline counts as validated only if the median |timing error| between the simulated arrival and each satellite pixel’s first detection is at most the
        mean interval between overpasses (3.2 h for Chilecito, 2.9 h for Córdoba, 1.7 h for Saskatchewan). The only fitted parameter is one rate-of-spread multiplier, swept over ×0.25 to ×4. The gate and the
        metrics were fixed before any of the runs below.
      </p>
      <div className="table-wrap">
        <table className="rk-variants">
          <caption>Every run, failures included: best multiplier and median |timing error| (hours)</caption>
          <thead>
            <tr>
              <th scope="col">Fire</th>
              <th scope="col">Model change</th>
              <th scope="col">Best ×ROS</th>
              <th scope="col">Median |Δ|</th>
              <th scope="col">Gate</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.fire + r.variant}>
                <td>{r.fire}</td>
                <td>
                  {r.variant}
                  {r.label && <span className={`rk-tag ${r.label}`}>{r.label === 'blind' ? 'BLIND TEST' : 'EXPLORATORY'}</span>}
                </td>
                <td>{r.mult}</td>
                <td>{r.medAbs.toFixed(1)} h</td>
                <td>
                  ≤ {r.gate.toFixed(1)} h: <strong>fail</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>Chilecito:</strong> seven pre-registered variants (finer fuel cover, hourly fuel moisture, nearer weather grid point, and combinations) each moved the error by less than
        1.3 h. The best, A+B, was frozen as the model. <strong>Córdoba</strong> was then run blind with A+B: 15.2 h, with the best multiplier at the slow edge of the sweep. The seeded start
        was proposed after seeing Chilecito fail, so it is exploratory and not a validation. Restarting the model every 24 h from the detected extent (as Coen &amp; Schroeder 2013
        do every 12 h) cuts the error to 8–9 h, still above the gate; part of the remaining error is the wait until the next overpass sees new fire. Those 8–9 h come at a cost the timing
        score hides: at the timing-best multiplier the Argentine runs burn 2.5–9× the area the detections cover (Sørensen 0.20–0.49). At ×0.25 the overlap is 0.55–0.62, which is in the
        range published for operational models, but the timing is worse.
      </p>
      <p>
        <strong>A third, blind test on a fire chosen to suit the model.</strong> Before simulating anything we screened 600 candidate fires (Argentina and Canada south of 60°N,
        2023–2026) with fixed rules: one compact start, no early burst, no 48 h plateau, no yearly recurrence. Only 2 passed; most real fires stall for days. The best, in northern
        Saskatchewan (May 2023), grows in daily steps, and the model reproduces that shape, but even at ×4 (the fast edge of the sweep) it runs behind: 22.4 h median |timing error|
        vs a 1.7 h gate (overpasses are frequent at 56°N). MERRA-2 humidity was high (median 81 %), so the surface model sees moist fuels; spring boreal fires often run in the
        conifer crowns, which the model omits.
      </p>
      <Hs>Diagnosis: burst, then stall</Hs>
      <p>
        The inputs check out (no unit, direction or projection error; Rothermel rates are ordinary for grass and shrub). Both real fires <strong>burst and then stalled</strong>: Chilecito
        was seen 5.8 km from its first pixels within 2 h, then moved only ~8 km more in 4.5 days; Córdoba covered 6 km in 12 h, then stalled for about 2 days. A free-spread model keeps
        going, so one multiplier can only trade “too slow early” against “too fast later”. What stops a real fire here (suppression near towns, fuel breaks finer than 250–500 m land cover,
        local weather) is not in the inputs. The chart “distance from ignition vs time” above shows this for the selected fire.
      </p>
      <Hs>Two references, not one answer key</Hs>
      <p>
        Hotspots record <em>where something hot was seen at overpass time</em>. That is good evidence for when a fire was active and is why we harmonized MODIS and VIIRS. It is a weaker
        outline of what burned: pixels are 375 m–1 km and grow toward the swath edge, cloud and smoke hide fire, and cool or fast grass fronts can burn between passes unseen. So we also
        compare against MODIS MCD64A1 burned area (500 m, burn date from surface darkening). It is a product of the same MODIS instrument and partly guided by its active
        fires, so it is a second, partly independent reference, not ground truth. Shape is judged against both, timing against the hotspots with a fair interval (an arrival
        anywhere between the previous overpass and the detection counts as on time). Added after the runs above; the earlier numbers are unchanged.
      </p>
      <div className="table-wrap">
        <table className="rk-variants">
          <caption>
            Whole simulation domain, against MCD64A1 burn patches connected to the fire’s hotspots. Sørensen overlap; ceiling = hotspots vs burned area (how well the two references agree)
          </caption>
          <thead>
            <tr>
              <th scope="col">Fire</th>
              <th scope="col">Ceiling</th>
              <th scope="col">Timing-calibrated: ×ROS, shape, timing</th>
              <th scope="col">Shape-calibrated: ×ROS, shape, share of ceiling</th>
              <th scope="col">Shape status</th>
              <th scope="col">Timing at shape ×</th>
            </tr>
          </thead>
          <tbody>
            {REFS.map((r) => (
              <tr key={r.fire}>
                <td>{r.fire}</td>
                <td>{r.ceil.toFixed(2)}</td>
                <td>
                  ×{r.tMult}, {r.tMcd.toFixed(2)}, {r.tRaw}
                </td>
                <td>
                  ×{r.sMult}, {r.sMcd.toFixed(2)}, {r.ratio}
                </td>
                <td>{r.status === 'shape validated' ? <strong>{r.status}</strong> : r.status}</td>
                <td>{r.sRaw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>What this changes.</strong> The two references agree only at Sørensen 0.25–0.66 (0.12 for the tiny Chaco fire), and the hotspot first-detection day matches the
        burned-area day within ±1 day for only 30–74 % of pixels, so no model should be expected to beat that. We then recalibrated the single spread multiplier to burned-area shape
        (pre-registered: “shape validated” if the model reaches 70 % of the ceiling and the ceiling is at least 0.3). A first version scored only inside each fire’s box. That hid
        over-burn, so the final score uses the whole domain, against burned patches connected to the fire’s hotspots. Result: <strong>one of six fires, British Columbia, is shape
        validated</strong> (0.38 against a 0.53 ceiling). All four Argentine fires want the slowest multiplier allowed (an eighth of the Rothermel rate) and still over-burn, which
        points to fuels and missing stalls rather than calibration. Fitting shape also makes timing much worse (Córdoba 15 → 77 h; Chilecito’s median pixel is never reached), so one
        multiplier cannot fit both. Crediting every arrival between overpasses cuts timing errors by only 0.5–8 h. An hour-level gate was stricter than these references can
        support, but they do not show the model was right. British Columbia gets whole-fire footprint what-ifs; its timing is still about two days off.
      </p>
      <Hs>Equations or data?</Hs>
      <p>
        The spread equations pass 10 verification tests against published Rothermel values and analytic shapes, and their rates are ordinary for these fuels and winds. What fails is everything
        around them: a 500 m land-cover map standing in for fuels, one ~50 km weather point for a whole fire, and no suppression. In Saskatchewan the model gets the shape of each day’s growth
        (Sørensen 0.55–0.91 per window) but runs behind, with humid MERRA-2 fuels near their moisture of extinction. That points to inputs and missing processes (suppression, crowning), not an
        error in the equations. But it is a diagnosis: the model has not been shown to work over a whole fire. The clearest example is Chilecito. With the MERRA-2 wind from the
        south-west (~245°), the simulated fire runs north-east of the ignition, while the mapped burn and the hotspots lie to the south-west. The wind at the fire was probably
        different from the ~50 km reanalysis (terrain winds at the foot of the Famatina range), and no multiplier can fix a wrong direction.
      </p>
      <Hs>Burst-window what-ifs (exploratory, post-hoc)</Hs>
      <p>
        After the failures, we asked a narrower question. Restart the model from the extent the satellites saw at the start of each day and fit that day’s own multiplier. Does any 24 h window
        match the detections? A window qualifies if its median |timing error| is within the fire’s gate, its Sørensen overlap is at least 0.4, and at least 50 pixels are scored. The rule
        was written after seeing the Chilecito and Córdoba windows and before checking Saskatchewan. One later deviation: a 2 h tail window, clipped by the end of the detections, is excluded.
        Only the qualifying window carries what-ifs: wind speed × 0–2 and dead fuel moisture −2 to +4 points. They show how this model responds while the fire was spreading freely. They are not
        a reconstruction of the fire, and the window was chosen with hindsight.
      </p>
      <div className="table-wrap">
        <table className="rk-variants">
          <caption>Best 24 h windows, each at its own fitted multiplier (all windows: “24 h window check” on the Rekindle tab)</caption>
          <thead>
            <tr>
              <th scope="col">Fire</th>
              <th scope="col">Window</th>
              <th scope="col">×ROS</th>
              <th scope="col">Median |Δ|</th>
              <th scope="col">Gate</th>
              <th scope="col">Sørensen</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {WINDOWS.map((w) => (
              <tr key={w.fire + w.day}>
                <td>{w.fire}</td>
                <td>{w.day}</td>
                <td>{w.mult}</td>
                <td>{w.medAbs.toFixed(w.medAbs < 2 ? 2 : 1)} h</td>
                <td>≤ {w.gate.toFixed(w.gate < 2 ? 2 : 1)} h</td>
                <td>{w.sor.toFixed(2)}</td>
                <td>{w.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>Footprint what-ifs for Saskatchewan (exploratory, shape only).</strong> Saskatchewan has no qualifying window, but its whole-fire footprint matches the detections well (Sørensen 0.72),
        so on the Rekindle tab it also has whole-fire what-ifs for wind and fuel dryness. Its timing failed the gate by a wide margin (22.4 h vs 1.7 h), so they show where this kind of fire
        could go under other weather, not when. This view was added at the developer’s request, outside the pre-registered rule, and is labelled that way.
      </p>
      <p>
        <strong>Three more demo fires, and shape-only windows.</strong> We ran the frozen model on three more fires from the screen (British Columbia 2024, La Rioja 2025, Gran Chaco 2024).
        None passed the gate, a timing window or the footprint rule. Restarting each day from the detected extent improves the shape much more than the timing: British Columbia goes
        from Sørensen 0.47 over the whole fire to 0.67 on day 3, but stays 6–9 h off in time. So a fire with no other what-if view gets one <em>shape-only window</em>: the full 24 h window
        with the best footprint match (Sørensen ≥ 0.6, ≥ 50 pixels). This rule was written after the timing rules had failed, so treat these views as demonstrations of the tool, not as
        evidence that it works. La Rioja floods its domain (11× the detected area) and Gran Chaco has too few detections per day, so neither has a usable window.
      </p>
      <Hs>What the literature says</Hs>
      <ul>
        <li>Rate-of-spread models typically err by 20–310 % even during active spread; ±35 % is a proposed benchmark (Cruz &amp; Alexander 2013).</li>
        <li>Fuel maps built from vegetation cover raised FARSITE’s Sørensen overlap from 0.38 to 0.70 in sparse steppe (Price &amp; Germino 2022).</li>
        <li>
          Even a coupled weather–fire model is re-initialised from VIIRS every 12 h and stays good for 12–24 h after each restart (Coen &amp; Schroeder 2013). A 5-day run from one ignition
          asks more than the state of the art delivers.
        </li>
        <li>Wind, fuel-model assignment and ignition location/timing dominate the error of large-fire simulations (Benali et al. 2016).</li>
        <li>
          Operational simulators such as FARSITE and Prometheus are typically run a day or a few days ahead from the latest mapped perimeter, with analysts adjusting spread rates by fuel type
          (Finney 1998; Tymstra et al. 2010). Our whole-fire test (one ignition, one multiplier, 5 days, timing within the overpass interval) is stricter than that practice.
        </li>
      </ul>
      <details>
        <summary>References</summary>
        <ul className="rk-refs">
          {REFERENCES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
