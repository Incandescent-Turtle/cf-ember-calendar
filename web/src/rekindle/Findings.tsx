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
];

// S6c: every 24 h window at its own best multiplier (docs/report/rekindle/<fire>_burst.json).
const WINDOWS = [
  { fire: 'Chilecito 2026', day: 'Day 2', mult: '0.5', medAbs: 2.3, gate: 3.2, sor: 0.46, verdict: 'qualifies: what-ifs shown' },
  { fire: 'Córdoba 2024', day: 'Day 1', mult: '0.35', medAbs: 3.2, gate: 2.9, sor: 0.53, verdict: 'near miss (timing)' },
  { fire: 'N. Saskatchewan 2023', day: 'Day 3', mult: '4.0', medAbs: 1.75, gate: 1.67, sor: 0.82, verdict: 'near miss (timing)' },
  { fire: 'N. Saskatchewan 2023', day: 'Day 6', mult: '2.83', medAbs: 0.1, gate: 1.67, sor: 0.91, verdict: 'excluded: only 2 h long' },
];

const REFERENCES = [
  'Cruz, M. G. & Alexander, M. E. (2013). Uncertainty associated with model predictions of surface and crown fire rates of spread. Environmental Modelling & Software 47, 16–28. doi:10.1016/j.envsoft.2013.04.004',
  'Price, W. J. & Germino, M. J. (2022). Modeling of fire spread in sagebrush steppe using FARSITE. Fire Ecology 18, 23. doi:10.1186/s42408-022-00147-2',
  'Coen, J. L. & Schroeder, W. (2013). Use of spatially refined satellite remote sensing fire detection data to initialize and evaluate coupled weather-wildfire growth model simulations. Geophysical Research Letters. doi:10.1002/2013GL057868',
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
        <strong>Status: hindcasts of real fires, calibrated to their detections. None passed the whole-fire quality gate</strong>, so no whole-fire what-ifs are shown. One 24 h
        window (Chilecito, day 2) matched the detections and carries <strong>exploratory, post-hoc</strong> what-ifs (below).
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
      <Hs>Equations or data?</Hs>
      <p>
        The spread equations pass 10 verification tests against published Rothermel values and analytic shapes, and their rates are ordinary for these fuels and winds. What fails is everything
        around them: a 500 m land-cover map standing in for fuels, one ~50 km weather point for a whole fire, and no suppression. In Saskatchewan the model gets the shape of each day’s growth
        (Sørensen 0.55–0.91 per window) but runs behind, with humid MERRA-2 fuels near their moisture of extinction. That points to inputs and missing processes (suppression, crowning), not an
        error in the equations. But it is a diagnosis: the model has not been shown to work over a whole fire.
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
