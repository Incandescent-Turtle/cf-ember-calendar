// What each calendar view shows, and the tooltip text (every number traceable: CLAUDE.md conventions).
import { monthPercentile, type Harmonized, type MonthRow } from '../lib/harmonize';
import { MONTHS_LONG } from '../lib/time';
import type { ViewMode } from '../store';

export type Metric = 'harmonized' | 'modis' | 'viirs' | 'spliced';

export const METRIC_LABEL: Record<Metric, string> = {
  harmonized: 'Harmonized (VIIRS-equivalent)',
  modis: 'MODIS raw',
  viirs: 'VIIRS raw',
  spliced: 'Raw, spliced (MODIS → VIIRS in Feb 2012)',
};

export const metricsFor = (mode: ViewMode): Metric[] =>
  mode === 'split' ? ['spliced', 'harmonized'] : mode === 'anomaly' ? ['harmonized'] : [mode];

/** Value of a metric; NaN when not observed (VIIRS before 2012, harmonized without k). */
export function valueOf(r: MonthRow, m: Metric): number {
  switch (m) {
    case 'harmonized':
      return r.harmonized;
    case 'modis':
      return r.modis;
    case 'viirs':
      return r.year < 2012 || (r.year === 2012 && r.month === 0 && r.snpp === 0) ? NaN : r.viirs;
    case 'spliced':
      return r.spliced;
  }
}

const n0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—');
const k2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const ord = (p: number) => {
  const n = Math.round(p);
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
};

export function tooltipHtml(r: MonthRow, h: Harmonized, currentYear: number): string {
  const title = `${MONTHS_LONG[r.month]} ${r.year}`;
  const partial = r.partial ? ` <span class="tt-flag">partial: ${r.nDekads} of 3 dekads</span>` : '';
  const band = r.era === 'snpp' ? '' : ` <span class="tt-dim">(band ${n0(r.lo)}–${n0(r.hi)})</span>`;
  const viirsRaw =
    r.era === 'n20' || r.year >= 2018
      ? `VIIRS S-NPP ${n0(r.snpp)} · NOAA-20 ${n0(r.n20)}`
      : `VIIRS S-NPP ${r.year < 2012 ? '—' : n0(r.snpp)}`;
  let kLine: string;
  if (r.era === 'snpp') kLine = 'k = 1 (VIIRS S-NPP is the reference series)';
  else if (!r.kUsed || !Number.isFinite(r.kUsed.k)) kLine = 'k unavailable — no calibration for this month';
  else {
    const from = r.era === 'modis' ? 'MODIS → VIIRS' : 'NOAA-20 → S-NPP';
    kLine = `${from} k = ${k2(r.kUsed.k)} (${k2(r.kUsed.lo)}–${k2(r.kUsed.hi)}), stratum: ${r.kUsed.detail}`;
  }
  const pct = monthPercentile(h, r.month, r.harmonized, currentYear);
  const pctLine = Number.isFinite(pct)
    ? `${ord(pct)} percentile vs other ${MONTHS_LONG[r.month]}s${r.partial ? ' (partial month vs full months)' : ''}`
    : '';
  return [
    `<b>${title}</b>${partial}`,
    `Harmonized: <b>${n0(r.harmonized)}</b> FCD${band}`,
    `Raw: MODIS ${n0(r.modis)} · ${viirsRaw}`,
    `<span class="tt-dim">${kLine}</span>`,
    pctLine,
  ]
    .filter(Boolean)
    .join('<br/>');
}
