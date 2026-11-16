// "At a glance" summary (PRODUCT.md F3). Every number has a tooltip saying where it comes from.
import type { Glance } from '../lib/glance';
import type { Harmonized } from '../lib/harmonize';
import { dayRange, fmtP, k2, LABEL_RULE, LABEL_TEXT, monthRun, n0, yearSpan } from '../lib/format';
import { MONTHS_LONG, MONTHS_SHORT } from '../lib/time';
import { climatology, label as labelOf, percentile } from '../lib/analytics';
import { ratioText, rowAt } from '../calendar/option';
import { useStore } from '../store';

/** Below this median (FCD) the month-to-date label rests on a handful of cell-days. */
const SMALL_COUNT = 5;

export function AtAGlance({ g, h }: { g: Glance; h: Harmonized }) {
  const { summary: s, mtd } = g;
  const base = yearSpan(s.baselineYears);
  const nBase = s.baselineYears.length;
  if (nBase < 3)
    return (
      <section className="glance" aria-label="At a glance">
        <h3>At a glance</h3>
        <p className="caption">Not enough complete years with harmonized values in this area for a summary.</p>
      </section>
    );

  const mtdK = !mtd ? null : mtd.tFirst >= h.tN20 ? h.kN20[mtd.month] : mtd.tLast < h.tSwitch ? h.kModis[mtd.month] : null;
  const mtdKFrom = mtd && mtd.tFirst >= h.tN20 ? 'NOAA-20 → S-NPP' : 'MODIS → VIIRS';
  const mtdTip = mtd
    ? [
        `${dayRange(mtd.tFirst, mtd.tLast)} ${mtd.year}: ${mtd.currentDekads.map(n0).join(' + ')} FCD by dekad (harmonized)`,
        `Raw: MODIS ${n0(mtd.raw.modis)} · VIIRS S-NPP ${n0(mtd.raw.snpp)} · NOAA-20 ${n0(mtd.raw.n20)}`,
        mtdK ? `${mtdKFrom} k =${k2(mtdK.k)} (${k2(mtdK.lo)}–${k2(mtdK.hi)}), stratum: ${mtdK.detail}` : '',
        `Compared with the same ${mtd.dekads} dekad${mtd.dekads > 1 ? 's' : ''} of ${MONTHS_LONG[mtd.month]} in ${mtd.baseYears.length} complete years (${yearSpan(mtd.baseYears)}): median ${n0(mtd.clim.median)}, 25th–75th ${n0(mtd.clim.p25)}–${n0(mtd.clim.p75)}, 90th ${n0(mtd.clim.p90)}`,
        LABEL_RULE,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const cp = s.criticalPeriod;
  const tr = s.trend;
  const signif = tr && tr.p < 0.05;
  const trendWords = !tr
    ? ''
    : !signif
      ? 'no clear trend (could be chance)'
      : tr.slopePerYear > 0
        ? 'rising (statistically significant)'
        : 'falling (statistically significant)';
  const b = g.busiest;

  return (
    <section className="glance" aria-label="At a glance">
      <h3>At a glance</h3>
      <p className="caption glance-unit">
        Hotspot activity is counted in <strong>fire-cell-days</strong>: one ~1 km square with at least one satellite hotspot on one day. Hover any number for its source.
      </p>
      {g.sparse && (
        <p className="warn">
          Hotspot activity is rare in this area: {Math.round(100 * g.zeroShare)} % of months ({g.zeroMonths} of {g.baseMonths}) have none, so typical
          values are often 0 and the comparisons below are coarse. Draw a larger area for a steadier baseline.
        </p>
      )}
      {mtd && (
        <div className="glance-now" title={mtdTip}>
          <h4 className="glance-h">Right now</h4>
          <div className="glance-k">
            {MONTHS_LONG[mtd.month]} {mtd.year} so far ({dayRange(mtd.tFirst, mtd.tLast)})
          </div>
          <div className="glance-v">
            {mtd.label && <span className={`chip chip-${mtd.label}`}>{LABEL_TEXT[mtd.label]}</span>}{' '}
            {mtd.value === 0 && mtd.clim.median === 0 ? (
              <>
                <strong>No activity</strong> so far, like {mtd.baseDekads.filter((d) => d.slice(0, mtd.dekads).every((x) => x === 0)).length} of{' '}
                {mtd.baseYears.length} past years at this time
              </>
            ) : (
              <>
                <strong>{n0(mtd.value)}</strong> fire-cell-days so far, vs a usual <strong>{n0(mtd.clim.median)}</strong> for these days
                {mtd.ratio !== null && <> (about {mtd.ratio.toFixed(mtd.ratio < 10 ? 1 : 0)}× normal)</>}
                {Number.isFinite(mtd.percentile) && <>. Busier than {Math.round(mtd.percentile)} % of past years.</>}
              </>
            )}
          </div>
          <p className="caption">
            Compared with the same {mtd.dekads === 3 ? 'whole month' : `first ${mtd.dekads * 10} days`} in {yearSpan(mtd.baseYears)}, so a month that has only just started is
            compared fairly.
            {mtd.droppedIncomplete && ' The latest dekad was still in progress when the data was built and is left out.'}
            {!g.sparse && mtd.clim.median < SMALL_COUNT && mtd.value < 2 * SMALL_COUNT && (mtd.value > 0 || mtd.clim.median > 0) &&
              ' Small numbers: a few fire-cell-days either way would change this label.'}
          </p>
        </div>
      )}
      <SelectionGlance h={h} baseYears={s.baselineYears} />
      <h4 className="glance-h">The usual pattern here ({base})</h4>
      <dl className="glance-grid">
        <div title={cp ? `Shortest run of consecutive months whose median activity (${base}) sums to ≥ 60 % of the sum of all 12 monthly medians.` : ''}>
          <dt>Fire season (critical period)</dt>
          <dd>
            {cp ? (
              <>
                <strong>{monthRun(cp.months)}</strong> <span className="dim">{Math.round(100 * cp.share)} % of a typical year’s activity</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div
          title={
            tr
              ? `Theil–Sen slope of annual totals ${base}: ${n0(tr.slopePerYear)} FCD/yr (${tr.pctPerYear === null ? '—' : tr.pctPerYear.toFixed(2)} % of the median year, ${n0(tr.medianAnnual)} FCD). Mann–Kendall S = ${tr.s}, z = ${tr.z.toFixed(2)}, two-sided p = ${fmtP(tr.p)}, n = ${tr.n} years.`
              : ''
          }
        >
          <dt>Trend {base}</dt>
          <dd>
            {tr && tr.pctPerYear !== null ? (
              <>
                <strong>
                  {tr.pctPerYear >= 0 ? '+' : '−'}
                  {Math.abs(tr.pctPerYear).toFixed(1)} %/yr
                </strong>{' '}
                <span className="dim">{trendWords}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div title={`Annual totals of complete years ${base} (harmonized FCD)`}>
          <dt>Busiest years</dt>
          <dd>
            {g.topYears.map((y, i) => (
              <span key={y.year}>
                {i > 0 && ' · '}
                <strong>{y.year}</strong> <span className="dim">{n0(y.value)} FCD</span>
              </span>
            ))}
          </dd>
        </div>
        <div title={`Median of each calendar month over ${base} (harmonized FCD)`}>
          <dt>Months that usually burn most</dt>
          <dd>
            {!g.topMonths.length && 'no month with typical activity above 0'}
            {g.topMonths.map((m, i) => (
              <span key={m.month}>
                {i > 0 && ' · '}
                <strong>{MONTHS_SHORT[m.month]}</strong> <span className="dim">typically {n0(m.median)}</span>
              </span>
            ))}
          </dd>
        </div>
        {b && (
          <div
            title={`Harmonized ${n0(b.harmonized)} FCD. Raw: MODIS ${n0(b.modis)} · VIIRS S-NPP ${n0(b.snpp)} · NOAA-20 ${n0(b.n20)}. ${
              b.kUsed ? `k = ${k2(b.kUsed.k)} (${k2(b.kUsed.lo)}–${k2(b.kUsed.hi)}), stratum: ${b.kUsed.detail}` : 'k = 1 (VIIRS S-NPP is the reference)'
            }`}
          >
            <dt>Busiest month on record</dt>
            <dd>
              <strong>
                {MONTHS_SHORT[b.month]} {b.year}
              </strong>{' '}
              <span className="dim">{n0(b.harmonized)} FCD</span>
            </dd>
          </div>
        )}
      </dl>
      <p className="caption">
        “Usual” and “typically” = the median over the complete years {base} ({nBase} years; the current year is left out). Values are harmonized: MODIS years are converted to
        what VIIRS would have seen.
      </p>
    </section>
  );
}

/** "Your selection": the year / month picked on the map or in the calendar, against this area's normal. */
function SelectionGlance({ h, baseYears }: { h: Harmonized; baseYears: number[] }) {
  const win = useStore((st) => st.window);
  const val = (y: number, m: number) => {
    const r = rowAt(h, y, m);
    return r && Number.isFinite(r.harmonized) ? r.harmonized : NaN;
  };
  const head = <h4 className="glance-h">Your selection</h4>;
  if (win.year === null && win.month === null)
    return (
      <div className="glance-sel">
        {head}
        <p className="caption">Pick a year or month on the map (or click a square in the calendar) to see whether it was unusual for this area.</p>
      </div>
    );

  // one month of one year
  if (win.year !== null && win.month !== null) {
    const y = win.year;
    const m = win.month;
    const v = val(y, m);
    const r = rowAt(h, y, m);
    const base = baseYears.filter((b) => b !== y).map((b) => val(b, m)).filter(Number.isFinite);
    if (!Number.isFinite(v) || base.length < 3) return <div className="glance-sel">{head}<p className="caption">No harmonized value for {MONTHS_LONG[m]} {y}.</p></div>;
    const clim = climatology(base);
    const lab = labelOf(v, clim);
    const all = h.years.map((yy) => ({ yy, v: val(yy, m), partial: rowAt(h, yy, m)?.partial })).filter((x) => Number.isFinite(x.v) && (!x.partial || x.yy === y));
    const rank = all.filter((x) => x.v > v).length + 1;
    return (
      <div className="glance-sel" title={`Compared with ${MONTHS_LONG[m]} in ${base.length} complete years (${yearSpan(baseYears.filter((b) => b !== y))}): median ${n0(clim.median)}, 25th–75th ${n0(clim.p25)}–${n0(clim.p75)}, 90th ${n0(clim.p90)}. ${Math.round(percentile(v, base))}th percentile. ${LABEL_RULE}`}>
        {head}
        <div className="glance-v">
          {lab && <span className={`chip chip-${lab}`}>{LABEL_TEXT[lab]}</span>} <strong>{MONTHS_LONG[m]} {y}</strong>: <strong>{n0(v)}</strong> fire-cell-days,{' '}
          <strong>{ratioText(v, clim.median).replace('About the same as', 'about the same as')}</strong> the typical {MONTHS_LONG[m]} ({n0(clim.median)}).
        </div>
        <p className="caption">
          {rank === 1 ? `The busiest ${MONTHS_LONG[m]} of ${all.length} years on record.` : `${ordinal(rank)} busiest ${MONTHS_LONG[m]} of ${all.length} years.`}
          {r?.partial && ' This month is not finished yet, so it may still grow.'}
        </p>
      </div>
    );
  }

  // a whole year (the current year: the same months so far)
  if (win.year !== null) {
    const y = win.year;
    const months = Array.from({ length: 12 }, (_, m) => m).filter((m) => Number.isFinite(val(y, m)));
    const sum = (yy: number) => months.reduce((a, m) => a + val(yy, m), 0);
    const v = sum(y);
    const full = months.length === 12 && !months.some((m) => rowAt(h, y, m)?.partial);
    const base = baseYears.filter((b) => b !== y).map(sum).filter(Number.isFinite);
    if (!months.length || base.length < 3) return <div className="glance-sel">{head}<p className="caption">No harmonized values for {y}.</p></div>;
    const clim = climatology(base);
    const lab = labelOf(v, clim);
    const others = h.years.filter((yy) => yy !== y && months.every((m) => Number.isFinite(val(yy, m)) && !rowAt(h, yy, m)?.partial));
    const rank = others.filter((yy) => sum(yy) > v).length + 1;
    const span = full ? '' : ` (${MONTHS_SHORT[months[0]]}–${MONTHS_SHORT[months[months.length - 1]]}${months.some((m) => rowAt(h, y, m)?.partial) ? ' so far' : ''})`;
    return (
      <div className="glance-sel" title={`Total over the same months in ${base.length} complete years: median ${n0(clim.median)}, 25th–75th ${n0(clim.p25)}–${n0(clim.p75)}, 90th ${n0(clim.p90)}. ${LABEL_RULE}`}>
        {head}
        <div className="glance-v">
          {lab && <span className={`chip chip-${lab}`}>{LABEL_TEXT[lab]}</span>} <strong>{y}{span}</strong>: <strong>{n0(v)}</strong> fire-cell-days,{' '}
          <strong>{ratioText(v, clim.median).replace('About the same as', 'about the same as')}</strong> {full ? 'a typical year' : 'a typical year over the same months'} ({n0(clim.median)}).
        </div>
        <p className="caption">
          {rank === 1 ? `The busiest of ${others.length + 1} years` : `${ordinal(rank)} busiest of ${others.length + 1} years`}
          {full ? '.' : ' for these months. Compared month for month, so an unfinished year is not penalised.'}
        </p>
      </div>
    );
  }

  // one calendar month across all years
  const m = win.month!;
  const all = h.years.map((yy) => ({ yy, v: val(yy, m), partial: rowAt(h, yy, m)?.partial })).filter((x) => Number.isFinite(x.v) && !x.partial);
  if (all.length < 3) return <div className="glance-sel">{head}<p className="caption">Not enough years of {MONTHS_LONG[m]} data.</p></div>;
  const base = baseYears.map((b) => val(b, m)).filter(Number.isFinite);
  const med = climatology(base).median;
  const hi = all.reduce((a, b) => (b.v > a.v ? b : a));
  const lo = all.reduce((a, b) => (b.v < a.v ? b : a));
  return (
    <div className="glance-sel">
      {head}
      <div className="glance-v">
        <strong>Every {MONTHS_LONG[m]}</strong>: typically <strong>{n0(med)}</strong> fire-cell-days. Busiest: <strong>{hi.yy}</strong> ({n0(hi.v)}); quietest: {lo.yy} ({n0(lo.v)}).
      </div>
      <p className="caption">Pick a year too to see whether that {MONTHS_LONG[m]} was unusual.</p>
    </div>
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
