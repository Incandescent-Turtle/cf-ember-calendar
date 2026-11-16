import { useCalendarData } from '../data/hooks';
import { Calendar } from '../calendar/Calendar';
import { DekadCalendar } from '../calendar/DekadCalendar';
import { useStore } from '../store';
import { EXAMPLES, selectExample } from '../map/aoiActions';
import { dekadRange } from '../lib/time';
import { useMemo } from 'react';
import { computeGlance } from '../lib/glance';
import { dataScope } from '../lib/export';
import { AtAGlance } from './AtAGlance';
import { linkTo } from '../route';
import { ExportRow } from './ExportRow';

export function CalendarPanel() {
  const aoi = useStore((s) => s.aoi);
  const { data, isLoading, isStale, error } = useCalendarData(aoi);
  const glance = useMemo(() => {
    if (!data) return null;
    const t1 = data.manifest.dekad_range[1];
    return computeGlance(data.harmonized, data.series, data.manifest, Math.floor(t1 / 36) + 2000);
  }, [data]);

  if (!aoi)
    return (
      <div className="empty">
        <h2>Burning activity calendar</h2>
        <p>
          Draw a rectangle or polygon, enter a point and radius, or pick a country to see its monthly hotspot activity
          from 2000 to today — MODIS and VIIRS combined into one consistent series.
        </p>
        <h3 className="examples-title">Or try an example</h3>
        <ul className="examples">
          {EXAMPLES.map((ex, i) => (
            <li key={ex.id}>
              <button className={i === 0 ? 'primary' : ''} onClick={() => selectExample(ex)}>
                {ex.label}
              </button>
              <span className="dim">{ex.note}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  if (error) return <div className="error">Couldn’t load data: {error.message}</div>;
  if (!data) return <div className="loading">{isLoading ? 'Loading hotspot activity…' : ''}</div>;

  const { series, harmonized, manifest, calibration } = data;
  const [, t1] = manifest.dekad_range;
  const [lastA, lastB] = dekadRange(t1);
  const currentYear = Math.floor(t1 / 36) + 2000;
  const total = harmonized.rows.reduce((a, r) => a + (r?.harmonized ?? 0), 0);
  const strata = new Set(harmonized.kModis.map((k) => k.stratum));
  const scope = dataScope(manifest);

  return (
    <div className="panel-body">
      <header className="panel-head">
        <h2>{aoi.label}</h2>
        <p className="meta">
          resolution {series.level === 1 ? '0.1°' : '1° (large area)'} · {series.nCells.toLocaleString('en-US')} cells ·{' '}
          {series.fetched.length} file{series.fetched.length === 1 ? '' : 's'} · {Math.round(series.ms)} ms · latest dekad {lastA}…{lastB.slice(8)}
          {isLoading && ' · updating…'}
        </p>
        {(manifest.mock || calibration?.mock) && (
          <p className="warn">
            Development data: {manifest.mock ? 'mock cubes' : 'fixture cubes'}
            {calibration?.mock ? ' with mock tile/global calibration' : ''}
            {!calibration ? ' (no calibration file yet: area-specific k only)' : ''}.
          </p>
        )}
        {!scope.global && !manifest.mock && (
          <p className="warn">
            This build holds {scope.text}. Areas outside it show no activity. <a href="/methodology" onClick={linkTo('methodology')}>Methodology</a>
          </p>
        )}
        {strata.has('aoi-sparse') || strata.has('none') ? (
          <p className="warn">Some months have little MODIS–VIIRS overlap in this area; their scaling factor is uncertain (see tooltips).</p>
        ) : null}
      </header>
      {total === 0 && series.tiles.length === 0 ? (
        <p className="empty-note">No hotspot activity recorded in this area.</p>
      ) : (
        <div className={isStale ? 'stale' : ''} aria-busy={isStale}>
          {glance && <AtAGlance g={glance} h={harmonized} />}
          <Calendar h={harmonized} currentYear={currentYear} />
          <DekadCalendar h={harmonized} series={series} />
          {glance && <ExportRow aoi={aoi} data={data} g={glance} currentYear={currentYear} />}
        </div>
      )}
    </div>
  );
}
