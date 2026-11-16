// S6c burst-window what-ifs (EXPLORATORY, post-hoc; docs/DECISIONS.md "Pre-registration — S6c").
// Only 24 h windows where the hindcast, restarted from the detected extent, matched the detections.
import type { BurstIndex, BurstRun, BurstWindow, ShapeWhatIf } from './data';
import { fmtUtc } from './data';
import { TimeBar } from './Controls';
import { linkTo } from '../route';
import { AreaChart } from './AreaChart';

const f1 = (x: number | null | undefined, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
const signed = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;
const windLabel = (s: number) => (s === 0 ? 'calm' : s === 1 ? 'as observed' : `× ${s}`);
const moistLabel = (d: number) => (d === 0 ? 'as observed' : `${d > 0 ? '+' : '−'}${Math.abs(d)} points`);

function burstCaption(w: BurstWindow) {
  return (
    <>
      <strong>A 24-hour simulation of part of this fire.</strong> Restarted from the area satellites had already seen burning, the model{' '}
      {w.basis === 'shape' ? 'matches the shape of what burned in this stretch (its hour-by-hour timing is approximate)' : 'matches where and when the satellites saw new fire in this stretch'}
      . Use the buttons to see how a different wind or drier or damper fuels would have changed it. Illustrative, not a forecast.
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
  return (
    <div className="rk">
      <p className="rk-status illustrative" role="status">
        {burstCaption(win)}
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
        {fmtUtc(win.start, 0)} to {fmtUtc(win.start, win.hours)}. Wind and fuel moisture follow the real hourly weather; the buttons change the wind speed (same direction) or make
        the dead fuels drier or damper.
      </p>

      <div className="rk-sliders rk-params">
        <h3 className="rk-params-title">Try different conditions</h3>
        <p className="meta">Change the wind or the fuel dryness, then press Simulate to see how the fire would have spread.</p>
        <Seg label="Wind speed" axis={burst.axes.wind_scale} value={p.scale} onChange={p.setScale} fmt={windLabel} />
        <Seg label="Dead fuel moisture" axis={burst.axes.dead_delta_pct} value={p.dpp} onChange={p.setDpp} fmt={(d) => (d === 0 ? 'observed' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`)} />
        <label className="rk-check">
          <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} /> Show the outline with the real weather (dashed blue)
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
            vs {f1(base.new_km2, 0)} km² with the real weather (<strong>{signed(run.new_km2_vs_baseline, 0)} km²</strong>, × {f1(run.new_ratio_vs_baseline, 2)})
          </>
        )}
        . Head-fire speed in the main fuel: × {f1(rr?.ratio, 2)} of the real-weather speed.
      </p>
      <AreaChart start={win.start} baseline={base.burned_km2_by_hour} selected={isBase ? null : run.burned_km2_by_hour} t={t} baseLabel="Real weather" xName="hours after the window start" />

      <BurstGrid win={win} scale={p.scale} dpp={p.dpp} />

      <details className="rk-details">
        <summary>Why only part of the fire?</summary>
        <p>
          Real fires burst, stall and are fought. The model knows the terrain, the vegetation and the weather, but not firefighting, small firebreaks or very local winds, so it can’t
          reproduce this whole fire. Restarted from what the satellites had seen, it does track this freely spreading stretch well, so we simulate this part and ask how wind and
          dryness would have changed it. Compare the runs with each other rather than reading exact areas or times.{' '}
          <a href="/methodology" onClick={linkTo('methodology')}>How we test the model</a>.
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


export interface ShapePanelProps extends Omit<BurstPanelProps, 'burst' | 'win' | 'setWin'> {
  shape: ShapeWhatIf;
  fireId: string;
}

/** S6d whole-fire footprint what-ifs: the final footprint matches the detections, the timing does not. */
export function ShapePanel(p: ShapePanelProps) {
  const { shape: w, run, base, t } = p;
  const hours = Math.round(w.hours);
  const isBase = run.key === base.key;
  const dryLabel = (d: number) => (d === 0 ? `${f1(w.dead_1h_pct_baseline, 0)} % (obs.)` : `${d > 0 ? '+' : '−'}${Math.abs(d)}`);
  return (
    <div className="rk">
      <p className="rk-status illustrative" role="status">
        <strong>The whole fire, shape only.</strong> The simulated burn covers roughly the same ground as the satellites saw, but its hour-by-hour timing is approximate, so read
        where the fire could spread, not when. Use the buttons to see how wind and fuel dryness change the final burned area. Illustrative, not a forecast.
      </p>
      <p className="meta">
        {fmtUtc(w.start, 0)} to {fmtUtc(w.start, w.hours)}, from the first satellite detection. Wind and fuel moisture follow the real hourly weather; the buttons change the wind
        speed (same direction) or make the dead fuels drier or damper.
      </p>

      <div className="rk-sliders rk-params">
        <h3 className="rk-params-title">Try different conditions</h3>
        <p className="meta">Change the wind or the fuel dryness, then press Simulate to see how the fire would have spread.</p>
        <Seg label="Wind speed" axis={w.axes.wind_scale} value={p.scale} onChange={p.setScale} fmt={windLabel} />
        <Seg label="Dead fuel moisture (points vs observed)" axis={w.axes.dead_delta_pct} value={p.dpp} onChange={p.setDpp} fmt={dryLabel} />
        <label className="rk-check">
          <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} /> Show the outline with the real weather (dashed blue)
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
            vs {f1(base.end_km2, 0)} km² with the real weather (<strong>{signed(run.end_km2 - base.end_km2, 0)} km²</strong>, × {f1(base.end_km2 > 0 ? run.end_km2 / base.end_km2 : null, 2)})
          </>
        )}
        .
        {run.domain_limited && (
          <>
            {' '}
            <strong>This run reached the edge of the simulated area</strong>, so the real burned area would be larger.
          </>
        )}
      </p>
      <AreaChart start={w.start} baseline={base.burned_km2_by_hour} selected={isBase ? null : run.burned_km2_by_hour} t={t} baseLabel="Real weather" />

      <BurstGrid win={w} scale={p.scale} dpp={p.dpp} caption="Final burned area compared with the real weather (≥ = reached the edge of the simulated area)" />

      <details className="rk-details">
        <summary>What this shows</summary>
        <p>
          {p.fireId === 'sask-2023'
            ? 'The model gets the general shape and the day-by-day growth of this boreal fire, but the satellite records of it disagree with each other, so treat it as a rough picture. Very humid fuels mean damper scenarios stall quickly and drier ones grow fast.'
            : 'The model reproduces where this fire burned closely enough to pass our shape test against MODIS burned area, but not its hour-by-hour timing.'}{' '}
          It shows how wind and fuel dryness push this kind of fire around, not what happened hour by hour. Surface fire only: no crowning or spotting.{' '}
          <a href="/methodology" onClick={linkTo('methodology')}>How we test the model</a>.
        </p>
      </details>
    </div>
  );
}
