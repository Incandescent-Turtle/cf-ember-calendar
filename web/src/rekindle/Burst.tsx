// S6c burst-window what-ifs (EXPLORATORY, post-hoc; docs/DECISIONS.md "Pre-registration — S6c").
// Only 24 h windows where the hindcast, restarted from the detected extent, matched the detections.
import type { BurstIndex, BurstRun, BurstWindow, BurstWindowEval } from './data';
import { fmtUtc, rampCss } from './data';
import { AreaChart } from './AreaChart';

const f1 = (x: number | null | undefined, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
const signed = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;
const windLabel = (s: number) => (s === 0 ? 'calm' : s === 1 ? 'as observed' : `× ${s}`);
const moistLabel = (d: number) => (d === 0 ? 'as observed' : `${d > 0 ? '+' : '−'}${Math.abs(d)} points`);

function burstCaption(w: BurstWindow, gate: number) {
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

      <div className="rk-time">
        <button onClick={() => (t >= hours ? (p.setT(0), p.setPlaying(true)) : p.setPlaying(!p.playing))} aria-label={p.playing ? 'Pause' : 'Play'}>
          {p.playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={hours} step={1} value={t} onChange={(e) => (p.setPlaying(false), p.setT(Number(e.target.value)))} aria-label="Time since the window start" />
        <span className="rk-clock">
          {fmtUtc(win.start, t)} <span className="meta">(+{t} h)</span>
        </span>
      </div>
      <div className="rk-legend">
        <span>0 h</span>
        <span className="rk-ramp" style={{ background: rampCss() }} aria-hidden="true" />
        <span>{hours} h after the window start</span>
      </div>
      <p className="meta">
        Colour = simulated arrival time in the window (the darkest cells are the detected extent the run restarts from); white dots = FIRMS detections up to the clock time. {p.loading && 'Loading run…'}
      </p>

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

      <details className="rk-details" open>
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
          Rule for a window to qualify, written down before the third fire was checked: {burst.rule}. Other windows did not qualify (table below).
        </p>
      </details>
      <WindowScreen burst={burst} />
    </div>
  );
}

function BurstGrid({ win, scale, dpp }: { win: BurstWindow; scale: number; dpp: number }) {
  const scales = [...new Set(win.runs.map((r) => r.wind_scale))];
  const dpps = [...new Set(win.runs.map((r) => r.dead_delta_pct))];
  const get = (s: number, d: number) => win.runs.find((r) => r.wind_scale === s && r.dead_delta_pct === d);
  return (
    <div className="table-wrap">
      <table className="rk-variants rk-burst-grid">
        <caption>Newly burned area in the window vs the window baseline (wind as observed, moisture as observed)</caption>
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
                    {r ? `× ${f1(r.new_ratio_vs_baseline, 2)}` : '—'}
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
