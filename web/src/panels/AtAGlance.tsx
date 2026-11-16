// "At a glance" summary (PRODUCT.md F3). Every number has a tooltip saying where it comes from.
import type { Glance } from '../lib/glance';
import type { Harmonized } from '../lib/harmonize';
import { dayRange, fmtP, k2, LABEL_RULE, LABEL_TEXT, monthRun, n0, yearSpan } from '../lib/format';
import { MONTHS_LONG, MONTHS_SHORT } from '../lib/time';
import { climatology, label as labelOf, percentile } from '../lib/analytics';
import { ratioText, rowAt } from '../calendar/option';
import { useStore } from '../store';
import type { ReactNode } from 'react';

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

  const smallNumbers = !!mtd && !g.sparse && mtd.clim.median < SMALL_COUNT && mtd.value < 2 * SMALL_COUNT && (mtd.value > 0 || mtd.clim.median > 0);
  const x = (r: number | null) => (r === null ? '' : `${r.toFixed(r < 10 ? 1 : 0)}×`);

  return (
    <section className="glance" aria-label="At a glance">
      <h3>At a glance</h3>
      {g.sparse && <p className="warn">Fire is rare here ({Math.round(100 * g.zeroShare)} % of months have none), so comparisons are rough. A larger area helps.</p>}
      <div className="glance-rows">
        {mtd && (
          <div className="glance-row" title={mtdTip}>
            <span className="glance-h">Now</span>
            <span>
              {mtd.label && <span className={`chip chip-${mtd.label}`}>{LABEL_TEXT[mtd.label]}</span>} <strong>{MONTHS_SHORT[mtd.month]} {mtd.year} so far</strong>:{' '}
              {mtd.value === 0 && mtd.clim.median === 0 ? (
                'no activity, as usual for this time'
              ) : (
                <>
                  <strong>{n0(mtd.value)}</strong> FCD{mtd.ratio !== null && <> · <strong>{x(mtd.ratio)}</strong> normal</>}
                </>
              )}
            </span>
          </div>
        )}
        <SelectionGlance h={h} baseYears={s.baselineYears} />
      </div>
      <dl className="glance-grid">
        <div title={cp ? `Shortest run of consecutive months whose median activity (${base}) sums to ≥ 60 % of the sum of all 12 monthly medians (${Math.round(100 * cp.share)} %).` : ''}>
          <dt>Fire season</dt>
          <dd>{cp ? <strong>{monthRun(cp.months)}</strong> : '—'}</dd>
        </div>
        <div
          title={
            tr
              ? `Theil–Sen slope of annual totals ${base}: ${n0(tr.slopePerYear)} FCD/yr (${tr.pctPerYear === null ? '—' : tr.pctPerYear.toFixed(2)} % of the median year, ${n0(tr.medianAnnual)} FCD). Mann–Kendall S = ${tr.s}, z = ${tr.z.toFixed(2)}, two-sided p = ${fmtP(tr.p)}, n = ${tr.n} years. ${trendWords}.`
              : ''
          }
        >
          <dt>Trend</dt>
          <dd>
            {tr && tr.pctPerYear !== null ? (
              signif ? (
                <strong>
                  {tr.pctPerYear >= 0 ? '↑ +' : '↓ −'}
                  {Math.abs(tr.pctPerYear).toFixed(1)} %/yr
                </strong>
              ) : (
                <span>no clear trend</span>
              )
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div title={`Annual totals of complete years ${base} (harmonized FCD): ${g.topYears.map((y) => `${y.year} ${n0(y.value)}`).join(', ')}`}>
          <dt>Busiest years</dt>
          <dd>
            <strong>{g.topYears.map((y) => y.year).join(' · ')}</strong>
          </dd>
        </div>
        <div title={`Median of each calendar month over ${base} (harmonized FCD): ${g.topMonths.map((m) => `${MONTHS_SHORT[m.month]} ${n0(m.median)}`).join(', ')}`}>
          <dt>Busiest months</dt>
          <dd>
            <strong>{g.topMonths.length ? g.topMonths.map((m) => MONTHS_SHORT[m.month]).join(' · ') : '—'}</strong>
          </dd>
        </div>
        {b && (
          <div
            title={`Harmonized ${n0(b.harmonized)} FCD. Raw: MODIS ${n0(b.modis)} · VIIRS S-NPP ${n0(b.snpp)} · NOAA-20 ${n0(b.n20)}. ${
              b.kUsed ? `k = ${k2(b.kUsed.k)} (${k2(b.kUsed.lo)}–${k2(b.kUsed.hi)}), stratum: ${b.kUsed.detail}` : 'k = 1 (VIIRS S-NPP is the reference)'
            }`}
          >
            <dt>Record month</dt>
            <dd>
              <strong>
                {MONTHS_SHORT[b.month]} {b.year}
              </strong>{' '}
              <span className="dim">{n0(b.harmonized)} FCD</span>
            </dd>
          </div>
        )}
      </dl>
      <details className="glance-defs">
        <summary>What these numbers mean</summary>
        <ul>
          <li>
            <strong>FCD (fire-cell-day):</strong> one ~1 km square with at least one satellite hotspot on one day. Values are harmonized: MODIS years are converted to what VIIRS
            would have seen.
          </li>
          <li>
            <strong>Normal / typical:</strong> the median over the complete years {base} ({nBase} years; the current year is left out).
          </li>
          {mtd && (
            <li>
              <strong>Now:</strong> {MONTHS_LONG[mtd.month]} {mtd.year} so far ({dayRange(mtd.tFirst, mtd.tLast)}), compared with the same{' '}
              {mtd.dekads === 3 ? 'whole month' : `first ${mtd.dekads * 10} days`} in past years, so an unfinished month is compared fairly.
              {mtd.droppedIncomplete && ' The latest 10-day period was still in progress when the data was built and is left out.'}
              {smallNumbers && ' Small numbers: a few FCD either way would change the label.'}
            </li>
          )}
          <li>
            <strong>Labels:</strong> Below normal (under the 25th percentile of past years), Normal (25th–75th), Above normal (75th–90th), Extreme (90th or above).
          </li>
          <li>
            <strong>Selected:</strong> the year or month picked on the map or in the calendar; “#3 of 26” is its rank. An unfinished year is compared month for month.
          </li>
          <li>
            <strong>Fire season:</strong> the shortest run of months holding at least 60 % of a typical year’s activity. <strong>Trend:</strong> Theil–Sen slope of yearly
            totals, shown only when statistically significant (Mann–Kendall p &lt; 0.05).
          </li>
          <li>Hover any number for its exact inputs.</li>
        </ul>
      </details>
    </section>
  );
}

/** "Selected": the year / month picked on the map or in the calendar, against this area's normal. */
function SelectionGlance({ h, baseYears }: { h: Harmonized; baseYears: number[] }) {
  const win = useStore((st) => st.window);
  const val = (y: number, m: number) => {
    const r = rowAt(h, y, m);
    return r && Number.isFinite(r.harmonized) ? r.harmonized : NaN;
  };
  const xx = (v: number, med: number) => ratioText(v, med).replace('About the same as', '≈ 1×');
  const row = (body: ReactNode, title = '') => (
    <div className="glance-row glance-sel" title={title}>
      <span className="glance-h">Selected</span>
      <span>{body}</span>
    </div>
  );
  if (win.year === null && win.month === null) return row(<span className="dim">pick a year or month on the map or in the calendar</span>);

  if (win.year !== null && win.month !== null) {
    const y = win.year;
    const m = win.month;
    const v = val(y, m);
    const partial = rowAt(h, y, m)?.partial;
    const base = baseYears.filter((b) => b !== y).map((b) => val(b, m)).filter(Number.isFinite);
    if (!Number.isFinite(v) || base.length < 3) return row(<span className="dim">no harmonized value for {MONTHS_SHORT[m]} {y}</span>);
    const clim = climatology(base);
    const lab = labelOf(v, clim);
    const all = h.years.map((yy) => ({ yy, v: val(yy, m), p: rowAt(h, yy, m)?.partial })).filter((q) => Number.isFinite(q.v) && (!q.p || q.yy === y));
    const rank = all.filter((q) => q.v > v).length + 1;
    return row(
      <>
        {lab && <span className={`chip chip-${lab}`}>{LABEL_TEXT[lab]}</span>} <strong>{MONTHS_SHORT[m]} {y}</strong>: <strong>{n0(v)}</strong> FCD ·{' '}
        <strong>{xx(v, clim.median)}</strong> typical · #{rank} of {all.length}
        {partial && <span className="dim"> (unfinished)</span>}
      </>,
      `${MONTHS_LONG[m]} ${y} vs ${MONTHS_LONG[m]} in ${base.length} complete years: median ${n0(clim.median)}, 25th–75th ${n0(clim.p25)}–${n0(clim.p75)}, 90th ${n0(clim.p90)}; ${Math.round(percentile(v, base))}th percentile. Rank among ${all.length} ${MONTHS_LONG[m]}s.`,
    );
  }

  if (win.year !== null) {
    const y = win.year;
    const months = Array.from({ length: 12 }, (_, m) => m).filter((m) => Number.isFinite(val(y, m)));
    const sum = (yy: number) => months.reduce((a, m) => a + val(yy, m), 0);
    const v = sum(y);
    const full = months.length === 12 && !months.some((m) => rowAt(h, y, m)?.partial);
    const base = baseYears.filter((b) => b !== y).map(sum).filter(Number.isFinite);
    if (!months.length || base.length < 3) return row(<span className="dim">no harmonized values for {y}</span>);
    const clim = climatology(base);
    const lab = labelOf(v, clim);
    const others = h.years.filter((yy) => yy !== y && months.every((m) => Number.isFinite(val(yy, m)) && !rowAt(h, yy, m)?.partial));
    const rank = others.filter((yy) => sum(yy) > v).length + 1;
    const span = full ? '' : ` ${MONTHS_SHORT[months[0]]}–${MONTHS_SHORT[months[months.length - 1]]}`;
    return row(
      <>
        {lab && <span className={`chip chip-${lab}`}>{LABEL_TEXT[lab]}</span>} <strong>{y}{span}</strong>: <strong>{n0(v)}</strong> FCD · <strong>{xx(v, clim.median)}</strong>{' '}
        typical · #{rank} of {others.length + 1}
      </>,
      `${full ? 'Year total' : 'Total over the same months'} vs ${base.length} complete years: median ${n0(clim.median)}, 25th–75th ${n0(clim.p25)}–${n0(clim.p75)}, 90th ${n0(clim.p90)}.`,
    );
  }

  const m = win.month!;
  const all = h.years.map((yy) => ({ yy, v: val(yy, m), p: rowAt(h, yy, m)?.partial })).filter((q) => Number.isFinite(q.v) && !q.p);
  if (all.length < 3) return row(<span className="dim">not enough years of {MONTHS_SHORT[m]}</span>);
  const med = climatology(baseYears.map((b) => val(b, m)).filter(Number.isFinite)).median;
  const hi = all.reduce((a, q) => (q.v > a.v ? q : a));
  return row(
    <>
      <strong>Every {MONTHS_SHORT[m]}</strong>: typically <strong>{n0(med)}</strong> FCD · busiest <strong>{hi.yy}</strong> ({n0(hi.v)})
    </>,
    `Median ${MONTHS_LONG[m]} over the baseline years; busiest of ${all.length} complete ${MONTHS_LONG[m]}s.`,
  );
}
