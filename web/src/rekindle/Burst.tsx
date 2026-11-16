// S6c burst-window what-ifs (EXPLORATORY, post-hoc; docs/DECISIONS.md "Pre-registration — S6c").
// Only 24 h windows where the hindcast, restarted from the detected extent, matched the detections.
import type { BurstIndex, BurstRun, BurstWindow, BurstWindowEval, ShapeWhatIf } from './data';
import { fmtUtc } from './data';
import { TimeBar } from './Controls';
import { AreaChart } from './AreaChart';

const f1 = (x: number | null | undefined, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
const signed = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;
const windLabel = (s: number) => (s === 0 ? 'calm' : s === 1 ? 'as observed' : `× ${s}`);
const moistLabel = (d: number) => (d === 0 ? 'as observed' : `${d > 0 ? '+' : '−'}${Math.abs(d)} points`);

function burstCaption(w: BurstWindow, gate: number) {
  if (w.basis === 'shape')
    return (
      <>
        <strong>Exploratory what-if (post-hoc), one 24 h window, shape only.</strong> Restarted from the satellite-detected extent, the simulated footprint in this window
        matches the detections (Sørensen {f1(w.sorensen, 2)}), but the timing does not: median |timing error| {f1(w.median_abs_timing_error_h)} h against a {f1(gate)} h gate. The window
        was chosen with hindsight, as the best-matching shape. Read where the fire could have spread, not when. Illustrative, not a reconstruction.
      </>
    );
  return (
    <>
      <strong>Exploratory what-if (post-hoc), one 24 h window.</strong> In this window the hindcast, restarted from the satellite-detected extent, matched the detections: median
      |timing error| {f1(w.median_abs_timing_error_h)} h (gate ≤ {f1(gate)} h), Sørensen {f1(w.sorensen, 2)}. The window was chosen with hindsight, and the whole-fire hindcast failed
      the pre-registered gate. Illustrative: compare runs with each other, not with real times.
    </>
  );
}

function Seg<T extends number>({ label, axis, value, onChange, fmt }: { label: string; axis: T[]; value: T; onChange: (v: T) => void; fmt: (v: T) => string }) {
  return (
    <div className="rk-burst-axis">
      <span className="meta">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {axis.map((v) => (
          <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)} role="radio" aria-checked={v === value}>
            {fmt(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface BurstPanelProps {
  burst: BurstIndex;
  win: BurstWindow;
  setWin: (i: number) => void;
  run: BurstRun;
  base: BurstRun;
  scale: number;
  setScale: (v: number) => void;
  dpp: number;
  setDpp: (v: number) => void;
  compare: boolean;
  setCompare: (b: boolean) => void;
  t: number;
  setT: (h: number) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
  loading: boolean;
}

export function BurstPanel(p: BurstPanelProps) {
  const { burst, win, run, base, t } = p;
  const hours = Math.round(win.hours);
  const isBase = run.key === base.key;
  const rr = win.rothermel.rows.find((r) => r.wind_scale === p.scale && r.dead_delta_pct === p.dpp);
  const overburn = win.observed_footprint_km2 > 0 ? win.area_km2 / win.observed_footprint_km2 : null;
  return (
    <div className="rk">
      <p className="rk-status illustrative" role="status">
        {burstCaption(win, burst.gate_h)}
      </p>

      {burst.windows.length > 1 && (
        <Seg
          label="Window"
          axis={burst.windows.map((_, i) => i)}
          value={burst.windows.indexOf(win)}
          onChange={p.setWin}
          fmt={(i) => fmtUtc(burst.windows[i].start, 0).replace(/, \d\d:\d\d UTC/, '')}
        />
      )}
      <p className="meta">
        Window: {fmtUtc(win.start, 0)} to {fmtUtc(win.start, win.hours)}, restarted from {win.n_ignitions} detected fire pixels, ROS × {win.ros_multiplier} fitted on this window’s own
        detections. Wind and fuel moisture follow MERRA-2 hour by hour; the what-ifs scale the wind speed (direction unchanged) and shift the dead fuel moisture.
      </p>

      <div className="rk-sliders">
        <Seg label="Wind speed" axis={burst.axes.wind_scale} value={p.scale} onChange={p.setScale} fmt={windLabel} />
        <Seg label="Dead fuel moisture" axis={burst.axes.dead_delta_pct} value={p.dpp} onChange={p.setDpp} fmt={(d) => (d === 0 ? 'observed' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`)} />
        <label className="rk-check">
          <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} /> Show the window baseline’s burned outline (dashed blue)
        </label>
      </div>

      <TimeBar t={t} setT={p.setT} hours={hours} playing={p.playing} setPlaying={p.setPlaying} clock={fmtUtc(win.start, t)} label="Time since the window start" />
      {p.loading && <p className="meta">Loading run…</p>}

      <h3>Effect of this what-if</h3>
      <p className="caption">
        Wind {windLabel(p.scale)}, dead fuel moisture {moistLabel(p.dpp)}: <strong>{f1(run.new_km2, 0)} km²</strong> newly burned in 24 h
        {!isBase && (
          <>
            {' '}
            vs {f1(base.new_km2, 0)} km² in the window baseline (<strong>{signed(run.new_km2_vs_baseline, 0)} km²</strong>, × {f1(run.new_ratio_vs_baseline, 2)})
          </>
        )}
        . Rothermel head-fire rate in the main fuel (Anderson {win.rothermel.fuel_model}) at the window’s median wind ({f1(win.rothermel.wind_10m_ms_median)} m/s) and moisture (
        {f1(win.rothermel.dead_1h_pct_median)} %): × {f1(rr?.ratio, 2)} of the observed-weather rate.
      </p>
      <AreaChart start={win.start} baseline={base.burned_km2_by_hour} selected={isBase ? null : run.burned_km2_by_hour} t={t} baseLabel="Window baseline (observed weather)" xName="hours after the window start" />

      <BurstGrid win={win} scale={p.scale} dpp={p.dpp} />

      <details className="rk-details">
        <summary>What this is, and why only this window</summary>
        <p>
          The spread equations are verified against published Rothermel values and analytic shapes, and their rates are ordinary for these fuels and winds. Over the whole fire the model fails
          because the real fire burst and then stalled for reasons that are not in its inputs (suppression, fuel breaks finer than the 500 m land-cover map, local weather). That is a data
          limit, not an error in the equations, but the model has not been shown to work outside windows like this one.
        </p>
        <p>
          While the fire ran freely, restarted from what the satellites saw, the model matched the detection times within the overpass interval. So in this window we ask a narrower question:
          how much more or less would have burned in these 24 hours with a different wind or drier or damper fuels? The differences between runs are more trustworthy than the absolute areas:
          {overburn !== null && (
            <>
              {' '}
              even the window baseline burns about {f1(overburn)}× the area covered by detection pixels ({f1(win.area_km2, 0)} vs {f1(win.observed_footprint_km2, 0)} km²).
            </>
          )}{' '}
          {win.basis === 'shape' ? (
            <>No window of this fire passed the timing rule. This one was picked by a later, looser rule: {burst.shape_rule}.</>
          ) : (
            <>Rule for a window to qualify, written down before the third fire was checked: {burst.rule}. Other windows did not qualify (table below).</>
          )}
        </p>
      </details>
    </div>
  );
}

function BurstGrid({
  win, scale, dpp, caption = 'Newly burned area in the window vs the window baseline (wind as observed, moisture as observed)',
}: { win: BurstWindow; scale: number; dpp: number; caption?: string }) {
  const scales = [...new Set(win.runs.map((r) => r.wind_scale))];
  const dpps = [...new Set(win.runs.map((r) => r.dead_delta_pct))];
  const get = (s: number, d: number) => win.runs.find((r) => r.wind_scale === s && r.dead_delta_pct === d);
  return (
    <div className="table-wrap">
      <table className="rk-variants rk-burst-grid">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Wind speed</th>
            {dpps.map((d) => (
              <th key={d} scope="col">
                Moisture {d === 0 ? 'obs.' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scales.map((s) => (
            <tr key={s}>
              <th scope="row">{windLabel(s)}</th>
              {dpps.map((d) => {
                const r = get(s, d);
                return (
                  <td key={d} className={s === scale && d === dpp ? 'on' : ''}>
                    {r ? `${r.domain_limited ? '≥ ' : ''}× ${f1(r.new_ratio_vs_baseline, 2)}` : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every 24 h window of the fire with the qualification verdict (shown on both views). */
export function WindowScreen({ burst }: { burst: BurstIndex }) {
  return (
    <details className="rk-details">
      <summary>24 h window check: which windows can carry a what-if</summary>
      <p className="meta">
        Each window restarts the model from the detected extent at its start and fits its own multiplier. A window qualifies if {burst.rule}.
      </p>
      <div className="table-wrap">
        <table className="rk-variants">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Best ×ROS</th>
              <th scope="col">Median |Δ|</th>
              <th scope="col">Sørensen</th>
              <th scope="col">Pixels</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {burst.all_windows.map((w: BurstWindowEval) => (
              <tr key={w.index}>
                <td>{w.index + 1}</td>
                <td>{w.ros_multiplier}</td>
                <td>{f1(w.median_abs_timing_error_h)} h</td>
                <td>{f1(w.sorensen, 2)}</td>
                <td>{w.n_pixels}</td>
                <td>{w.qualifies ? <strong>qualifies</strong> : w.reasons.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta">Gate for this fire: ≤ {f1(burst.gate_h)} h (the mean interval between overpasses).</p>
    </details>
  );
}

export interface ShapePanelProps extends Omit<BurstPanelProps, 'burst' | 'win' | 'setWin'> {
  shape: ShapeWhatIf;
  fireId: string;
}

/** S6d whole-fire footprint what-ifs: the final footprint matches the detections, the timing does not. */
export function ShapePanel(p: ShapePanelProps) {
  const { shape: w, run, base, t } = p;
  const hours = Math.round(w.hours);
  const isBase = run.key === base.key;
  const ratio = w.observed_footprint_km2 > 0 ? w.area_km2 / w.observed_footprint_km2 : null;
  const dryLabel = (d: number) => (d === 0 ? `${f1(w.dead_1h_pct_baseline, 0)} % (obs.)` : `${d > 0 ? '+' : '−'}${Math.abs(d)}`);
  return (
    <div className="rk">
      <p className="rk-status illustrative" role="status">
        <strong>Footprint what-if (exploratory, shape only).</strong> The baseline’s final burned footprint matches the satellite detections well (Sørensen {f1(w.sorensen, 2)};{' '}
        {f1(w.area_km2, 0)} km² simulated vs {f1(w.observed_footprint_km2, 0)} km² of detection pixels), but its timing does not: median |timing error| {f1(w.median_abs_timing_error_h)} h
        against a {f1(w.gate_h)} h gate. Read where the fire could have gone, not when. Illustrative, not a reconstruction.
      </p>
      <p className="meta">
        Whole fire, {fmtUtc(w.start, 0)} to {fmtUtc(w.start, w.hours)}, from the first-overpass detections, ROS × {w.ros_multiplier}{w.ros_multiplier >= 4 ? ' (the fast edge of the calibration sweep)' : ''}. Wind and fuel
        moisture follow MERRA-2 hour by hour; the what-ifs scale the wind speed (direction unchanged) and shift the dead fuel moisture.
      </p>

      <div className="rk-sliders">
        <Seg label="Wind speed" axis={w.axes.wind_scale} value={p.scale} onChange={p.setScale} fmt={windLabel} />
        <Seg label="Dead fuel moisture (points vs observed)" axis={w.axes.dead_delta_pct} value={p.dpp} onChange={p.setDpp} fmt={dryLabel} />
        <label className="rk-check">
          <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} /> Show the baseline’s burned outline (dashed blue)
        </label>
      </div>

      <TimeBar t={t} setT={p.setT} hours={hours} playing={p.playing} setPlaying={p.setPlaying} clock={fmtUtc(w.start, t)} label="Time since the first detection" />
      {p.loading && <p className="meta">Loading run…</p>}

      <h3>Effect of this what-if</h3>
      <p className="caption">
        Wind {windLabel(p.scale)}, dead fuel moisture {moistLabel(p.dpp)}: final footprint <strong>{run.domain_limited ? '≥ ' : ''}{f1(run.end_km2, 0)} km²</strong>
        {!isBase && (
          <>
            {' '}
            vs {f1(base.end_km2, 0)} km² in the baseline (<strong>{signed(run.end_km2 - base.end_km2, 0)} km²</strong>, × {f1(base.end_km2 > 0 ? run.end_km2 / base.end_km2 : null, 2)})
          </>
        )}
        .
        {run.domain_limited && (
          <>
            {' '}
            <strong>This run reached the edge of the simulation domain</strong> (about 50 × 50 km, {f1(w.domain_burnable_km2, 0)} km² burnable), so the real footprint would be larger: read
            it as a lower bound.
          </>
        )}
      </p>
      <AreaChart start={w.start} baseline={base.burned_km2_by_hour} selected={isBase ? null : run.burned_km2_by_hour} t={t} baseLabel="Baseline (observed weather)" />

      <BurstGrid win={w} scale={p.scale} dpp={p.dpp} caption="Burned area after the whole run vs the baseline (wind as observed, moisture as observed); ≥ = reached the domain edge, a lower bound" />

      <details className="rk-details">
        <summary>What this is, and what it is not</summary>
        {p.fireId === 'sask-2023' ? (
          <>
            <p>
              This fire was picked by a pre-screen for fires that spread steadily. The model reproduces its footprint against the hotspots and its day-by-day growth pattern
              {ratio !== null && <> (it burns {f1(ratio)}× the detection-pixel area)</>}, but not its timing: median timing error {f1(w.median_abs_timing_error_h)} h (signed median{' '}
              {f1(w.median_timing_error_h)} h, negative = before the satellites saw fire), at the fastest multiplier we allowed then. Against MODIS burned area the two references
              themselves disagree too much to judge (ceiling 0.25), so this view was added at the developer’s request, outside the rules. It shows how wind and dryness push this kind of
              fire around, not what happened hour by hour.
            </p>
            <p>
              MERRA-2 humidity was high (median 81 %), so the observed-weather fuels sit near the moisture at which this grass fuel model stops spreading. Damper scenarios stall almost at
              once, and drier ones grow quickly. The model also leaves out crown fire, which matters in boreal spring fires.
            </p>
          </>
        ) : (
          <p>
            The spread multiplier was fitted to this fire’s MODIS burned-area shape, and the footprint reaches the pre-registered bar: at least 70 % of how well the two satellite
            references agree with each other. It is the only one of six fires that does. Its timing is not validated: median timing error {f1(w.median_abs_timing_error_h)} h against a{' '}
            {f1(w.gate_h)} h gate. So these runs show where this fire could have spread under other wind and fuel dryness, not when. Surface fire only: no crowning or spotting, which
            matter in conifer forest.
          </p>
        )}
      </details>
    </div>
  );
}
