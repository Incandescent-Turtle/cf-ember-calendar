// Numbers for the methodology page, read from validation.json / calibration.json / manifest.json.
// Nothing here is hard-coded: the text follows whatever the current build measured.
import { quantile } from '../lib/analytics';
import type { Calibration } from '../data/types';
import type { LoyoLevel, LoyoMetrics, Validation } from './types';

export interface KStats {
  global: { min: number; max: number; minMonth: number; maxMonth: number } | null;
  tile: { p5: number; p50: number; p95: number; n: number; nTiles: number } | null;
  n20: { min: number; max: number; median: number } | null;
}

/** Okabe–Ito: blue, near-black, vermillion (+ line styles in the chart). */
export const SEAM_COLORS = { modis: '#0072B2', viirs: '#1a1a1a', harmonized: '#D55E00', band: 'rgba(213, 94, 0, 0.18)' };

const finite = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

export function kStats(cal: Calibration | null, minModis: number): KStats {
  if (!cal) return { global: null, tile: null, n20: null };
  const gk = cal.global.k.map((x) => (typeof x === 'number' ? x : NaN));
  const gf = finite(gk);
  const global = gf.length
    ? { min: Math.min(...gf), max: Math.max(...gf), minMonth: gk.indexOf(Math.min(...gf)), maxMonth: gk.indexOf(Math.max(...gf)) }
    : null;
  const tileKs: number[] = [];
  for (const b of Object.values(cal.tile ?? {}))
    b.k.forEach((k, m) => {
      if (typeof k === 'number' && Number.isFinite(k) && (b.n_modis?.[m] ?? minModis) >= minModis) tileKs.push(k);
    });
  const tile = tileKs.length
    ? { p5: quantile(tileKs, 0.05), p50: quantile(tileKs, 0.5), p95: quantile(tileKs, 0.95), n: tileKs.length, nTiles: Object.keys(cal.tile ?? {}).length }
    : null;
  const nf = finite(cal.n20?.global?.k ?? []);
  const n20 = nf.length ? { min: Math.min(...nf), max: Math.max(...nf), median: quantile(nf, 0.5) } : null;
  return { global, tile, n20 };
}

export const METHODS: { key: keyof Omit<LoyoLevel, 'level' | 'n_series'>; label: string; what: string }[] = [
  { key: 'calibrated', label: 'Fire-cell-days, calibrated k (ours)', what: 'MODIS FCD × k fitted on the other years' },
  { key: 'fcd_uncalibrated', label: 'Fire-cell-days, k = 1', what: 'MODIS FCD used as if it were VIIRS' },
  { key: 'raw_counts', label: 'Detection counts, calibrated ratio', what: 'MODIS detections × a count ratio fitted the same way' },
  { key: 'raw_counts_uncalibrated', label: 'Detection counts, k = 1', what: 'raw detection counts spliced together' },
];

/** Plain-language findings, built from the measured numbers. */
export function findings(v: Validation): string[] {
  const out: string[] = [];
  const g = v.loyo.levels.find((l) => l.level === 'global') ?? v.loyo.levels[0];
  const md = (m: LoyoMetrics | undefined) => (m && typeof m.mdape === 'number' ? m.mdape : null);
  if (g) {
    const cal = md(g.calibrated);
    const cnt = md(g.raw_counts);
    const unc = md(g.fcd_uncalibrated);
    if (cal !== null && unc !== null)
      out.push(
        `Calibration is what matters: predicting VIIRS from MODIS for a held-out year, the median error drops from ${unc.toFixed(1)} % (k = 1) to ${cal.toFixed(1)} % with the fitted k.`,
      );
    if (cal !== null && cnt !== null) {
      const d = cnt - cal;
      out.push(
        Math.abs(d) <= 1.5
          ? `On monthly sums, a simple detection-count ratio calibrates about as well as fire-cell-days + k (median error ${cnt.toFixed(1)} % vs ${cal.toFixed(1)} %). We say so plainly.`
          : d > 0
            ? `Fire-cell-days + k beat a detection-count ratio on monthly sums (median error ${cal.toFixed(1)} % vs ${cnt.toFixed(1)} %).`
            : `On monthly sums, a detection-count ratio does better than fire-cell-days + k (median error ${cnt.toFixed(1)} % vs ${cal.toFixed(1)} %). We say so plainly.`,
      );
    }
  }
  const t = v.seam.test;
  if (typeof t.mean_log_diff_before === 'number' && typeof t.mean_log_diff_after === 'number')
    out.push(
      `The 2012 seam disappears: across Feb 2012 the raw spliced record jumps by ${t.mean_log_diff_before.toFixed(2)} in log units (×${Math.exp(t.mean_log_diff_before).toFixed(2)}) more than MODIS alone; the harmonized record by ${t.mean_log_diff_after.toFixed(3)} (×${Math.exp(t.mean_log_diff_after).toFixed(3)}).`,
    );
  out.push(
    'Why fire-cell-days, then? The unit depends far less on pixel size (the several VIIRS 375 m pixels that fall in one ≈1 km cell on one day count once, as one MODIS pixel would), several overpasses a day count once, and sums over cells are exact — so any drawn area is a sum of precomputed cells, with no double counting at cell edges.',
  );
  return out;
}
