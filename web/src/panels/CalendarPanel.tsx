import { useCalendarData } from '../data/hooks';
import { Calendar } from '../calendar/Calendar';
import { useStore } from '../store';
import { HERO, setCircleAoi } from '../map/AoiTools';
import { dekadRange } from '../lib/time';

export function CalendarPanel() {
  const aoi = useStore((s) => s.aoi);
  const { data, isLoading, error } = useCalendarData(aoi);

  if (!aoi)
    return (
      <div className="empty">
        <h2>Burning activity calendar</h2>
        <p>
          Draw a rectangle or polygon, enter a point and radius, or pick a country to see its monthly hotspot activity
          from 2000 to today — MODIS and VIIRS combined into one consistent series.
        </p>
        <button className="primary" onClick={() => setCircleAoi(HERO.lon, HERO.lat, HERO.radiusKm, HERO.label, 'preset')}>
          Try: Chilecito, Argentina (Jul 2026)
        </button>
      </div>
    );
  if (error) return <div className="error">Couldn’t load data: {error.message}</div>;
  if (!data) return <div className="loading">{isLoading ? 'Loading hotspot activity…' : ''}</div>;

  const { series, harmonized, manifest, calibration } = data;
  const [, t1] = manifest.dekad_range;
  const lastDay = dekadRange(t1)[1];
  const currentYear = Math.floor(t1 / 36) + 2000;
  const total = harmonized.rows.reduce((a, r) => a + (r?.harmonized ?? 0), 0);
  const strata = new Set(harmonized.kModis.map((k) => k.stratum));

  return (
    <div className="panel-body">
      <header className="panel-head">
        <h2>{aoi.label}</h2>
        <p className="meta">
          resolution {series.level === 1 ? '0.1°' : '1° (large area)'} · {series.nCells.toLocaleString('en-US')} cells ·{' '}
          {series.fetched.length} file{series.fetched.length === 1 ? '' : 's'} · {Math.round(series.ms)} ms · data to {lastDay}
          {isLoading && ' · updating…'}
        </p>
        {(manifest.mock || calibration?.mock) && (
          <p className="warn">
            Development data: {manifest.mock ? 'mock cubes' : 'fixture cubes'}
            {calibration?.mock ? ' with mock tile/global calibration' : ''}
            {!calibration ? ' (no calibration file yet: area-specific k only)' : ''}.
          </p>
        )}
        {strata.has('aoi-sparse') || strata.has('none') ? (
          <p className="warn">Some months have little MODIS–VIIRS overlap in this area; their scaling factor is uncertain (see tooltips).</p>
        ) : null}
      </header>
      {total === 0 && series.tiles.length === 0 ? (
        <p className="empty-note">No hotspot activity recorded in this area.</p>
      ) : (
        <Calendar h={harmonized} currentYear={currentYear} />
      )}
    </div>
  );
}
