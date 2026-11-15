// "At a glance" summary (PRODUCT.md F3). Every number has a tooltip saying where it comes from.
import type { Glance } from '../lib/glance';
import type { Harmonized } from '../lib/harmonize';
import { dayRange, fmtP, k2, LABEL_RULE, LABEL_TEXT, monthRun, n0, ord, yearSpan } from '../lib/format';
import { MONTHS_LONG, MONTHS_SHORT } from '../lib/time';

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
      ? 'no clear trend'
      : tr.slopePerYear > 0
        ? 'a statistically significant increase'
        : 'a statistically significant decrease';
  const b = g.busiest;

  return (
    <section className="glance" aria-label="At a glance">
      <h3>At a glance</h3>
      {g.sparse && (
        <p className="warn">
          Hotspot activity is rare in this area: {Math.round(100 * g.zeroShare)} % of months ({g.zeroMonths} of {g.baseMonths}) have none, so typical
          values are often 0 and the comparisons below are coarse. Draw a larger area for a steadier baseline.
        </p>
      )}
      {mtd && (
        <div className="glance-now" title={mtdTip}>
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
                <strong>{n0(mtd.value)}</strong> FCD vs a median of {n0(mtd.clim.median)}
                {mtd.ratio !== null && <> ({mtd.ratio.toFixed(mtd.ratio < 10 ? 1 : 0)}×)</>}
                {Number.isFinite(mtd.percentile) && <> · {ord(mtd.percentile)} percentile</>}
              </>
            )}
          </div>
          <p className="caption">
            Same {mtd.dekads === 3 ? 'whole month' : `${mtd.dekads} dekad${mtd.dekads > 1 ? 's' : ''} (10-day period${mtd.dekads > 1 ? 's' : ''})`} in{' '}
            {yearSpan(mtd.baseYears)}, so a partly observed month is compared fairly.
            {mtd.droppedIncomplete && ' The latest dekad was still in progress when the data was built and is left out.'}
            {!g.sparse && mtd.clim.median < SMALL_COUNT && mtd.value < 2 * SMALL_COUNT && (mtd.value > 0 || mtd.clim.median > 0) &&
              ' Small numbers: a few fire-cell-days either way would change this label.'}
          </p>
        </div>
      )}
      <dl className="glance-grid">
        <div title={cp ? `Shortest run of consecutive months whose median activity (${base}) sums to ≥ 60 % of the sum of all 12 monthly medians.` : ''}>
          <dt>Critical period</dt>
          <dd>
            {cp ? (
              <>
                <strong>{monthRun(cp.months)}</strong> <span className="dim">{Math.round(100 * cp.share)} % of a typical year</span>
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
                <span className="dim">
                  p = {fmtP(tr.p)}, {trendWords}
                </span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div title={`Annual totals of complete years ${base} (harmonized FCD)`}>
          <dt>Top years</dt>
          <dd>
            {g.topYears.map((y, i) => (
              <span key={y.year}>
                {i > 0 && ' · '}
                <strong>{y.year}</strong> <span className="dim">{n0(y.value)}</span>
              </span>
            ))}
          </dd>
        </div>
        <div title={`Median of each calendar month over ${base} (harmonized FCD)`}>
          <dt>Busiest months of the year</dt>
          <dd>
            {!g.topMonths.length && 'no month with typical activity above 0'}
            {g.topMonths.map((m, i) => (
              <span key={m.month}>
                {i > 0 && ' · '}
                <strong>{MONTHS_SHORT[m.month]}</strong> <span className="dim">median {n0(m.median)}</span>
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
        Harmonized {`VIIRS-equivalent fire-cell-days`}; baseline = complete years {base} ({nBase}), the current year excluded. Hover any number for its source.
      </p>
    </section>
  );
}
