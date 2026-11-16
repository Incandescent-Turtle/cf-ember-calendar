// Map time picker (top-left panel) and the map legend (bottom-left).
import { useStore, ALL_TIME } from '../store';
import { useManifest } from '../data/hooks';
import { MONTHS_SHORT } from '../lib/time';
import { RAMP } from '../calendar/option';
import { UNIT_TIP } from '../calendar/Calendar';
import { SENSOR_GROUPS, windowLabel, type DensityLayerData } from './layers';
import type { PointsResult } from '../data/points';
import { MAX_MAP_POINTS } from '../data/points';

const fmtTick = (lv: number) => {
  const v = 10 ** lv - 1;
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v >= 10 ? Math.round(v).toString() : v.toFixed(1);
};

function useYears(): number[] {
  const manifest = useManifest();
  const [t0, t1] = manifest.data?.dekad_range ?? [0, 0];
  const years: number[] = [];
  for (let y = 2000 + Math.floor(t0 / 36); y <= 2000 + Math.floor(t1 / 36); y++) years.push(y);
  return years;
}

/** Year / month shown on the map (also set by clicking a calendar square). */
export function MapTimePicker() {
  const { window: w, setWindow } = useStore();
  const years = useYears();
  return (
    <div className="time-pick">
      <div className="tc-row">
        <select aria-label="Year" value={w.year ?? ''} onChange={(e) => setWindow({ ...w, year: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select aria-label="Month" value={w.month ?? ''} onChange={(e) => setWindow({ ...w, month: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">All months</option>
          {MONTHS_SHORT.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        {w.year !== null || w.month !== null ? (
          <button className="link" onClick={() => setWindow(ALL_TIME)}>
            all time
          </button>
        ) : (
          years.length > 0 && (
            <button className="link" onClick={() => setWindow({ ...w, year: years[years.length - 1] })}>
              latest year
            </button>
          )
        )}
      </div>
      <p className="hint">Or click a month in the calendar.</p>
    </div>
  );
}

interface Props {
  density: DensityLayerData | null;
  densityLoading: boolean;
  level: 1 | 10 | null;
  points: PointsResult | undefined;
  pointsLoading: boolean;
  pointsWhy: string | null;
  pointsError: Error | null;
}

/** Map legend: what the colours mean, and the individual-hotspot layer. */
export function TimeControl({ density, densityLoading, level, points, pointsLoading, pointsWhy, pointsError }: Props) {
  const { window: w, showPoints, setShowPoints, aoi } = useStore();

  let pointsLine = '';
  if (pointsWhy) pointsLine = pointsWhy;
  else if (pointsError) pointsLine = `Couldn’t load hotspots: ${pointsError.message}`;
  else if (pointsLoading) pointsLine = 'Loading hotspots…';
  else if (points)
    pointsLine =
      points.total > MAX_MAP_POINTS
        ? `A sample of ${MAX_MAP_POINTS.toLocaleString('en-US')} of ${points.total.toLocaleString('en-US')} hotspots.`
        : `${points.total.toLocaleString('en-US')} hotspots ${aoi ? 'in this area' : 'in view'}.`;

  const tip = `${UNIT_TIP} Squares are ${level === 1 ? '0.1°' : '1°'} cells; click one for raw MODIS / VIIRS and the k used. The colour scale fits the current view, so colours aren't comparable between views.`;

  return (
    <div className="time-control map-legend" aria-label="Map legend">
      <div className="legend-title">
        Hotspot activity <span className="dim">· {windowLabel(w)}</span>
      </div>
      {density && density.nCells > 0 ? (
        <>
          <div className="tc-ramp" style={{ background: `linear-gradient(to right, ${RAMP.join(', ')})` }} />
          <div className="tc-ticks">
            <span>{fmtTick(density.vmin)}</span>
            <span>{fmtTick((density.vmin + density.vmax) / 2)}</span>
            <span>{fmtTick(density.vmax)}</span>
          </div>
          <div className="tc-note" title={tip}>
            fire-cell-days per {level === 1 ? '0.1°' : '1°'} square, log scale <span aria-hidden>ⓘ</span>
            {densityLoading ? ' · updating…' : ''}
          </div>
        </>
      ) : (
        <div className="tc-note">{densityLoading ? 'Loading…' : 'No hotspot activity here for this time.'}</div>
      )}
      <label className="tc-points">
        <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /> Individual hotspots
      </label>
      {showPoints && (
        <>
          {!pointsWhy && points && points.total > 0 && (
            <div className="tc-sensors">
              {SENSOR_GROUPS.map((g) => (
                <span key={g.id}>
                  <i style={{ background: g.color }} /> {g.label}
                </span>
              ))}
            </div>
          )}
          {pointsLine && <div className="tc-note">{pointsLine}</div>}
        </>
      )}
    </div>
  );
}
