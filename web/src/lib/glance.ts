// "At a glance" (PRODUCT.md F3): month-to-date vs the same dekads in baseline years, top years and
// months, busiest month, critical period, trend. Rules from lib/analytics.ts (pipeline/analytics.py).
import { monthToDate, summarize, type MonthToDate, type SeriesSummary } from './analytics';
import { totalSeries, type Harmonized, type MonthRow } from './harmonize';
import { dekadMonth, dekadRange, dekadYear } from './time';
import type { AoiSeries, Manifest } from '../data/types';
import { S_MODIS, S_N20, S_SNPP } from '../data/types';

export interface MtdResult extends MonthToDate {
  year: number;
  month: number;
  /** first and last dekad compared */
  tFirst: number;
  tLast: number;
  /** the record's last dekad was still in progress at build time and was left out */
  droppedIncomplete: boolean;
  /** dekads of the current month, harmonized and raw (traceability) */
  currentDekads: number[];
  raw: { modis: number; snpp: number; n20: number };
  baseYears: number[];
  /** per base year, that month's 3 harmonized dekads */
  baseDekads: number[][];
}

export interface Glance {
  summary: SeriesSummary;
  mtd: MtdResult | null;
  topYears: { year: number; value: number }[];
  topMonths: { month: number; median: number }[];
  busiest: MonthRow | null;
}

/**
 * Last dekad to use for month-to-date: the record's last dekad, unless it ends after the build date
 * (it was still in progress, so it holds only a few days and would compare unfairly with full dekads).
 */
export function lastCompleteDekad(manifest: Manifest): { t: number; dropped: boolean } {
  const t1 = manifest.dekad_range[1];
  const built = manifest.built_at?.slice(0, 10);
  if (built && built < dekadRange(t1)[1] && t1 - 1 >= manifest.dekad_range[0]) return { t: t1 - 1, dropped: true };
  return { t: t1, dropped: false };
}

export function computeGlance(h: Harmonized, series: AoiSeries, manifest: Manifest, currentYear: number): Glance {
  const summary = summarize(h, currentYear);
  const at = (t: number) => h.dekadal[t - h.t0];

  let mtd: MtdResult | null = null;
  const { t: tLast, dropped } = lastCompleteDekad(manifest);
  const month = dekadMonth(tLast);
  const year = dekadYear(tLast);
  const tFirst = tLast - (tLast % 3);
  const cur: number[] = [];
  for (let t = tFirst; t <= tLast; t++) cur.push(at(t));
  // baseline = complete years other than the year being assessed
  const baseYears = summary.baselineYears.filter((y) => y !== year);
  if (cur.every(Number.isFinite) && baseYears.length) {
    const baseDekads = baseYears.map((y) => {
      const t0m = (y - 2000) * 36 + month * 3;
      return [at(t0m), at(t0m + 1), at(t0m + 2)];
    });
    const tot = totalSeries(series);
    const nT = series.nT;
    const raw = { modis: 0, snpp: 0, n20: 0 };
    for (let t = tFirst; t <= tLast; t++) {
      const i = t - series.t0;
      raw.modis += tot[S_MODIS * nT + i];
      raw.snpp += tot[S_SNPP * nT + i];
      raw.n20 += tot[S_N20 * nT + i];
    }
    mtd = { ...monthToDate(cur, baseDekads), year, month, tFirst, tLast, droppedIncomplete: dropped, currentDekads: cur, raw, baseYears, baseDekads };
  }

  const topYears = summary.baselineYears
    .map((y, i) => ({ year: y, value: summary.annual[i] }))
    .sort((a, b) => b.value - a.value || a.year - b.year)
    .slice(0, 3);
  const topMonths = summary.climatology
    .map((c, m) => ({ month: m, median: c.median }))
    .filter((x) => Number.isFinite(x.median))
    .sort((a, b) => b.median - a.median || a.month - b.month)
    .slice(0, 3);
  let busiest: MonthRow | null = null;
  for (const r of h.rows) if (r && !r.partial && Number.isFinite(r.harmonized) && (!busiest || r.harmonized > busiest.harmonized)) busiest = r;
  return { summary, mtd, topYears, topMonths, busiest };
}
