// Methodology Part 2: how Rekindle works and how it is judged, before the results (RekindleFindings).
import { linkTo } from '../route';

const DATA = [
  {
    name: 'NASA FIRMS active fires (MODIS C6.1, VIIRS 375 m)',
    use: 'Ignition (the first overpass that sees the fire) and the timing reference: when each pixel was first seen burning.',
    doi: 'https://earthdata.nasa.gov/firms',
  },
  {
    name: 'MERRA-2 hourly single-level diagnostics (GMAO)',
    use: '10 m wind speed and direction, 2 m temperature and humidity at the fire, hour by hour. Humidity and temperature drive dead fuel moisture.',
    doi: 'https://doi.org/10.5067/VJAFPLI1CSIV',
  },
  {
    name: 'MODIS MCD12Q1 v061 land cover',
    use: 'Vegetation class (IGBP) → one of the 13 standard Anderson fuel models, at 500 m, resampled to the 90 m grid.',
    doi: 'https://doi.org/10.5067/MODIS/MCD12Q1.061',
  },
  {
    name: 'MODIS MOD44B v061 vegetation continuous fields',
    use: 'Cells that are mostly bare ground (> 50 % non-vegetated) cannot burn.',
    doi: 'https://doi.org/10.5067/MODIS/MOD44B.061',
  },
  {
    name: 'MODIS MOD44W v061 water mask',
    use: 'Water cannot burn.',
    doi: 'https://doi.org/10.5067/MODIS/MOD44W.061',
  },
  {
    name: 'Copernicus DEM GLO-30',
    use: 'Elevation, slope and aspect: fire runs faster uphill.',
    doi: 'https://registry.opendata.aws/copernicus-dem/',
  },
  {
    name: 'MODIS MCD64A1 v061 burned area',
    use: 'The shape reference: which 500 m cells burned and on what day. A second, partly independent check (same MODIS instrument, but a burn-scar measurement rather than heat).',
    doi: 'https://doi.org/10.5067/MODIS/MCD64A1.061',
  },
];

export function RekindleMethod() {
  return (
    <>
      <section>
        <h2>What Rekindle does</h2>
        <p>
          Rekindle replays real wildfires with a physics model of how fire spreads across the ground, using each fire’s real terrain, vegetation and hourly weather. It starts from the
          first satellite detection and simulates the fire hour by hour. Where the simulation matches what the satellites saw, it then asks a what-if question: how would this fire have
          spread with a different wind or drier or damper fuels? All runs are computed in advance; nothing is simulated in your browser. It is an illustrative tool, not a forecast.
        </p>
      </section>

      <section>
        <h2>The model</h2>
        <p>
          <strong>How fast fire spreads: the Rothermel (1972) equation.</strong> At every point, the forward rate of spread of a surface fire is
        </p>
        <p className="equation" aria-label="R equals I R times xi times one plus phi w plus phi s, divided by rho b times epsilon times Q ig">
          R = I<sub>R</sub> ξ (1 + φ<sub>w</sub> + φ<sub>s</sub>) / (ρ<sub>b</sub> ε Q<sub>ig</sub>)
        </p>
        <ul className="defs">
          <li>
            <strong>I<sub>R</sub></strong>: reaction intensity, the heat released by the burning fuel per unit area. It falls as the fuel gets wetter.
          </li>
          <li>
            <strong>ξ</strong>: the share of that heat that reaches the unburned fuel ahead.
          </li>
          <li>
            <strong>φ<sub>w</sub>, φ<sub>s</sub></strong>: how much wind and slope speed the fire up (zero on flat ground with no wind).
          </li>
          <li>
            <strong>ρ<sub>b</sub> ε Q<sub>ig</sub></strong>: the heat needed to bring the fuel ahead to ignition (fuel bed density × the part that gets heated × the heat of
            pre-ignition, which grows with moisture).
          </li>
        </ul>
        <p>
          Fuel properties come from the 13 standard fuel models (Anderson 1982) with Albini’s (1976) revisions. Wind at mid-flame height is the 10 m wind × 0.4.
        </p>
        <p>
          <strong>Which direction: an elliptical fire.</strong> A fire in wind grows as an ellipse that is longer the stronger the wind (length-to-breadth ratio from Anderson 1983,
          as used in FARSITE, Finney 1998). The head runs downwind and uphill; the flanks and back spread more slowly.
        </p>
        <p>
          <strong>Moving the edge: a level-set solver.</strong> The fire edge is the zero line of a smooth field on a 90 m grid, moved at the local elliptical spread rate (Osher &amp;
          Sethian 1988; the approach used in WRF-SFIRE). It handles several ignition points merging and gives the arrival time at every cell.
        </p>
        <p>
          <strong>Fuel moisture.</strong> Dead fuel moisture follows the hourly MERRA-2 humidity and temperature (equilibrium moisture, Simard 1968), with 1-, 10- and 100-hour
          fuels responding at their own speeds. Live fuel moisture is fixed.
        </p>
        <p>
          <strong>Checked against known answers.</strong> The code passes 10 verification tests: published Rothermel spread rates, a circle growing at the right speed with no wind,
          the exact ellipse in steady wind, and faster spread upslope.
        </p>
      </section>

      <section>
        <h2>Data used</h2>
        <div className="table-wrap">
          <table className="rk-variants">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Used for</th>
              </tr>
            </thead>
            <tbody>
              {DATA.map((d) => (
                <tr key={d.name}>
                  <td>
                    <a href={d.doi} target="_blank" rel="noreferrer">
                      {d.name}
                    </a>
                  </td>
                  <td>{d.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Full citations are under “Model and data” on the Rekindle tab and in the README.</p>
      </section>

      <section>
        <h2>How a fire is run</h2>
        <ul>
          <li>
            <strong>Start:</strong> the pixels seen burning on the first satellite overpass.
          </li>
          <li>
            <strong>One tuning knob:</strong> a spread-rate multiplier (×0.125 to ×8) that speeds up or slows down the Rothermel rate everywhere. It absorbs what the coarse inputs get
            wrong. It is chosen per fire, so a match on that fire is <em>calibrated</em>, not a blind test.
          </li>
          <li>
            <strong>24-hour windows:</strong> a run can also be restarted each day from the area the satellites had already seen burning, and simulate only the next 24 hours.
          </li>
          <li>
            <strong>What-ifs:</strong> the same run with the wind speed scaled (calm to ×2, same direction) or the dead fuels made drier or damper. Everything else stays the same.
          </li>
        </ul>
      </section>

      <section>
        <h2>How we judge a simulation</h2>
        <p>There is no perfect record of how a fire spread, so we compare the model with two satellite references, each used for what it measures best.</p>
        <ul className="defs">
          <li>
            <strong>Timing, against the hotspots.</strong> For each satellite pixel, the timing error is the simulated arrival time minus the time that pixel was first seen burning. We
            report the median of the absolute errors. A pixel can only be seen when a satellite passes, so we also report a <em>fair interval</em> error: zero if the simulated arrival
            falls between the previous overpass and the detection.
          </li>
          <li>
            <strong>Shape, against burned area.</strong> The overlap between the simulated burned area and the MCD64A1 burned area connected to this fire, as a Sørensen score: 2 ×
            the shared area ÷ (the two areas added). 1 = identical, 0 = no overlap.
          </li>
          <li>
            <strong>The ceiling.</strong> The same overlap between the two satellite references themselves. No model should be expected to agree with a reference better than the
            references agree with each other.
          </li>
          <li>
            <strong>Pass marks, written down before the runs:</strong> timing passes if the median timing error is within the fire’s average gap between overpasses (about 2–5 h).
            Shape passes if the model reaches at least 70 % of the ceiling, and the ceiling is at least 0.3 (otherwise the references disagree too much to judge). A what-if is shown
            only where one of these rules passes.
          </li>
        </ul>
        <p className="meta">
          The results below follow the order in which we ran the tests, failures included. The maps are on the <a href="/rekindle" onClick={linkTo('rekindle')}>Rekindle tab</a>.
        </p>
      </section>
    </>
  );
}

export function RekindleLimits() {
  return (
    <section>
      <h2>Rekindle limitations</h2>
      <ul className="limits">
        <li>Surface fire only: no crown fire, ember spotting or firefighting, which all matter in real fires.</li>
        <li>Fuels come from 500 m land cover through a coarse class-to-fuel-model table; small firebreaks (roads, rock, creeks) are invisible.</li>
        <li>Wind comes from one ~50 km reanalysis point, so valley and slope winds are missed. At Chilecito the simulated fire runs the opposite way to the real burn.</li>
        <li>Both satellite references are imperfect (pixel size, cloud, smoke, burn dates that lag), so neither is ground truth.</li>
        <li>Not a forecast: past weather, precomputed scenarios, no live fire perimeter.</li>
      </ul>
    </section>
  );
}
