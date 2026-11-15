// Analytics on a harmonized series (HARMONIZATION.md → Analytics). Port of pipeline/analytics.py,
// whose docstring is the spec; tests/golden/analytics_cases.json pins both sides.
import type { Harmonized } from './harmonize';

export type Label = 'below' | 'normal' | 'above' | 'extreme';
export const CRITICAL_SHARE = 0.6;

export interface Climatology {
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  n: number;
}

export interface Assessment {
  percentile: number;
  label: Label | null;
  /** null if fewer than 2 baseline values or zero spread */
  z: number | null;
  clim: Climatology;
}

/** Linear interpolation on sorted xs at (n − 1)·q (numpy "linear"). NaN if empty. */
export function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function climatology(base: readonly number[]): Climatology {
  return {
    median: quantile(base, 0.5),
    p10: quantile(base, 0.1),
    p25: quantile(base, 0.25),
    p75: quantile(base, 0.75),
    p90: quantile(base, 0.9),
    n: base.length,
  };
}

/** Mid-rank percentile: 100·(#below + ½·#equal)/n. */
export function percentile(value: number, base: readonly number[]): number {
  if (!base.length) return NaN;
  let below = 0;
  let eq = 0;
  for (const b of base) {
    if (b < value) below++;
    else if (b === value) eq++;
  }
  return (100 * (below + 0.5 * eq)) / base.length;
}

export function label(value: number, clim: Climatology): Label | null {
  if (clim.n === 0) return null;
  if (value < clim.p25) return 'below';
  if (value <= clim.p75) return 'normal';
  if (value < clim.p90) return 'above';
  return 'extreme';
}

export function zscore(value: number, base: readonly number[]): number | null {
  if (base.length < 2) return null;
  const lb = base.map((b) => Math.log1p(b));
  const mean = lb.reduce((a, b) => a + b, 0) / lb.length;
  const sd = Math.sqrt(lb.reduce((a, b) => a + (b - mean) ** 2, 0) / (lb.length - 1));
  if (sd === 0) return null;
  return (Math.log1p(value) - mean) / sd;
}

export function assess(value: number, base: readonly number[]): Assessment {
  const clim = climatology(base);
  return { percentile: percentile(value, base), label: label(value, clim), z: zscore(value, base), clim };
}

export interface MonthToDate extends Assessment {
  dekads: number;
  value: number;
  /** current / median of the same dekads; null if that median is 0 */
  ratio: number | null;
}

/** current: values of the d dekads observed so far; baseYears: per baseline year, that month's 3 dekads. */
export function monthToDate(current: readonly number[], baseYears: readonly (readonly number[])[]): MonthToDate {
  const d = current.length;
  const cur = current.reduce((a, b) => a + b, 0);
  const base = baseYears.map((v) => v.slice(0, d).reduce((a, b) => a + b, 0));
  const out = assess(cur, base);
  const med = out.clim.median;
  return { ...out, dekads: d, value: cur, ratio: med > 0 ? cur / med : null };
}

export interface CriticalPeriod {
  startMonth: number;
  length: number;
  months: number[];
  /** share of the summed monthly medians */
  share: number;
}

/** Shortest run of consecutive months (wrapping) with ≥ 60 % of the summed medians; ties → larger sum, then earlier start. */
export function criticalPeriod(medians: readonly number[]): CriticalPeriod | null {
  const total = medians.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  for (let length = 1; length <= 12; length++) {
    let best: [number, number] | null = null;
    for (let start = 0; start < 12; start++) {
      let s = 0;
      for (let i = 0; i < length; i++) s += medians[(start + i) % 12];
      if (s >= CRITICAL_SHARE * total - 1e-12 && (best === null || s > best[1])) best = [start, s];
    }
    if (best)
      return {
        startMonth: best[0],
        length,
        months: Array.from({ length }, (_, i) => (best[0] + i) % 12),
        share: best[1] / total,
      };
  }
  return null;
}

/** Median of pairwise slopes (per year). */
export function theilSen(years: readonly number[], values: readonly number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < years.length; i++)
    for (let j = i + 1; j < years.length; j++)
      if (years[j] !== years[i]) slopes.push((values[j] - values[i]) / (years[j] - years[i]));
  return quantile(slopes, 0.5);
}

/** Complementary error function: the Chebyshev fit from Numerical Recipes (erfcc), fractional error
 * < 1.2e-7 everywhere. Python uses math.erfc; the golden tolerance for p is 1e-6 absolute. */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

export interface MannKendall {
  s: number;
  varS: number;
  z: number;
  p: number;
}

export function mannKendall(values: readonly number[]): MannKendall {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) s += Number(values[j] > values[i]) - Number(values[j] < values[i]);
  const ties = new Map<number, number>();
  for (const v of values) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  let z = 0;
  if (varS > 0) {
    if (s > 0) z = (s - 1) / Math.sqrt(varS);
    else if (s < 0) z = (s + 1) / Math.sqrt(varS);
  }
  return { s, varS, z, p: erfc(Math.abs(z) / Math.SQRT2) };
}

export interface Trend extends MannKendall {
  slopePerYear: number;
  /** slope as % of the median annual total per year; null if that median is 0 */
  pctPerYear: number | null;
  medianAnnual: number;
  n: number;
}

export function trend(years: readonly number[], annual: readonly number[]): Trend | null {
  if (annual.length < 3) return null;
  const slope = theilSen(years, annual);
  const med = quantile(annual, 0.5);
  return { slopePerYear: slope, pctPerYear: med > 0 ? (100 * slope) / med : null, medianAnnual: med, ...mannKendall(annual), n: annual.length };
}

// ------------------------------------------------------------------ on a harmonized series

export interface MonthAssessment extends Assessment {
  month: number;
  value: number;
}

export interface SeriesSummary {
  currentYear: number;
  /** complete years (12 full months with a harmonized value), excluding the current year */
  baselineYears: number[];
  /** per calendar month, over full months of every year except the current one */
  climatology: Climatology[];
  /** the current year's full months, each vs its calendar-month history */
  currentMonths: MonthAssessment[];
  criticalPeriod: CriticalPeriod | null;
  /** annual totals of the baseline years */
  annual: number[];
  trend: Trend | null;
}

const ok = (r: Harmonized['rows'][number]): r is NonNullable<typeof r> => !!r && !r.partial && Number.isFinite(r.harmonized);

/** Values of calendar month m in full months of every year except `exclude` (the climatology base). */
export function monthBase(h: Harmonized, m: number, exclude: number): number[] {
  const out: number[] = [];
  for (const y of h.years) {
    if (y === exclude) continue;
    const r = h.rows[(y - h.years[0]) * 12 + m];
    if (ok(r)) out.push(r.harmonized);
  }
  return out;
}

/** The golden "fromSeries" recipe (pipeline/make_golden.py): baseline = complete years except the current one. */
export function summarize(h: Harmonized, currentYear: number): SeriesSummary {
  const y0 = h.years[0];
  const row = (y: number, m: number) => h.rows[(y - y0) * 12 + m];
  const bases = Array.from({ length: 12 }, (_, m) => monthBase(h, m, currentYear));
  const clim = bases.map(climatology);
  const currentMonths: MonthAssessment[] = [];
  for (let m = 0; m < 12; m++) {
    const r = h.years.includes(currentYear) ? row(currentYear, m) : null;
    if (ok(r)) currentMonths.push({ month: m, value: r.harmonized, ...assess(r.harmonized, bases[m]) });
  }
  const baselineYears = h.years.filter((y) => y !== currentYear && Array.from({ length: 12 }, (_, m) => ok(row(y, m))).every(Boolean));
  const annual = baselineYears.map((y) => {
    let s = 0;
    for (let m = 0; m < 12; m++) s += row(y, m)!.harmonized;
    return s;
  });
  const medians = clim.map((c) => c.median);
  return {
    currentYear,
    baselineYears,
    climatology: clim,
    currentMonths,
    criticalPeriod: medians.every(Number.isFinite) ? criticalPeriod(medians) : null,
    annual,
    trend: trend(baselineYears, annual),
  };
}
