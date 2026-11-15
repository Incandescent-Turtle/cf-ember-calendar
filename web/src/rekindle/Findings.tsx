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
];

const REFERENCES = [
  'Cruz, M. G. & Alexander, M. E. (2013). Uncertainty associated with model predictions of surface and crown fire rates of spread. Environmental Modelling & Software 47, 16–28. doi:10.1016/j.envsoft.2013.04.004',
  'Price, W. J. & Germino, M. J. (2022). Modeling of fire spread in sagebrush steppe using FARSITE. Fire Ecology 18, 23. doi:10.1186/s42408-022-00147-2',
  'Coen, J. L. & Schroeder, W. (2013). Use of spatially refined satellite remote sensing fire detection data to initialize and evaluate coupled weather-wildfire growth model simulations. Geophysical Research Letters. doi:10.1002/2013GL057868',
  'Benali, A. et al. (2016). Deciphering the impact of uncertainty on the accuracy of large wildfire spread simulations. Science of the Total Environment 569–570, 73–85. doi:10.1016/j.scitotenv.2016.06.112',
];

export function RekindleFindings({ headingLevel = 3 }: { headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const Hs = `h${Math.min(headingLevel + 1, 4)}` as 'h3' | 'h4';
  return (
    <div className="rk-findings">
      <p className="rk-status hindcast" role="note">
        <strong>Status: hindcasts of real fires, calibrated to their detections. Neither passed the quality gate</strong>, so both ship as baseline only and no what-if runs are shown.
      </p>
      <H>What validation showed</H>
      <p>
        <strong>The gate.</strong> A baseline counts as validated only if the median |timing error| between the simulated arrival and each satellite pixel’s first detection is at most the
        mean interval between overpasses (3.2 h for Chilecito, 2.9 h for Córdoba). The only fitted parameter is one rate-of-spread multiplier, swept over ×0.25 to ×4. The gate and the
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
        was proposed after seeing Chilecito fail, so it is exploratory and not a validation.
      </p>
      <Hs>Diagnosis: burst, then stall</Hs>
      <p>
        The inputs check out (no unit, direction or projection error; Rothermel rates are ordinary for grass and shrub). Both real fires <strong>burst and then stalled</strong>: Chilecito
        was seen 5.8 km from its first pixels within 2 h, then moved only ~8 km more in 4.5 days; Córdoba covered 6 km in 12 h, then stalled for about 2 days. A free-spread model keeps
        going, so one multiplier can only trade “too slow early” against “too fast later”. What stops a real fire here (suppression near towns, fuel breaks finer than 250–500 m land cover,
        local weather) is not in the inputs. The chart “distance from ignition vs time” above shows this for the selected fire.
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
