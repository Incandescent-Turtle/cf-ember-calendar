// Dekad-of-year sub-view (S7, priority 6): years × 36 dekads of harmonized FCD, same eras and k as the
// monthly calendar (lib/harmonize.ts → Harmonized.dekadal). Pure; tested in dekad.test.ts.
import type { AoiSeries } from '../data/types';
import { S_MODIS, S_N20, S_SNPP } from '../data/types';
import { totalSeries, type Era, type Harmonized, type KUsed } from '../lib/harmonize';

export interface DekadCell {
  t: number;
  year: number;
  /** dekad of the year, 0–35 */
  d: number;
  harmonized: number;
  modis: number;
  snpp: number;
  n20: number;
  era: Era;
  /** null in the S-NPP era (reference series) */
  k: KUsed | null;
}

export function dekadCells(h: Harmonized, s: AoiSeries): DekadCell[] {
  const tot = totalSeries(s);
  const out: DekadCell[] = [];
  for (let i = 0; i < s.nT; i++) {
    const t = s.t0 + i;
    const month = Math.floor(t / 3) % 12;
    const era: Era = t < h.tSwitch ? 'modis' : t < h.tN20 ? 'snpp' : 'n20';
    out.push({
      t,
      year: 2000 + Math.floor(t / 36),
      d: t % 36,
      harmonized: h.dekadal[i],
      modis: tot[S_MODIS * s.nT + i],
      snpp: tot[S_SNPP * s.nT + i],
      n20: tot[S_N20 * s.nT + i],
      era,
      k: era === 'modis' ? h.kModis[month] : era === 'n20' ? h.kN20[month] : null,
    });
  }
  return out;
}

/** "Jul 11–20" for dekad-of-year d (0–35); the third dekad runs to the month's end. */
export function dekadLabel(d: number, year = 2001): string {
  const m = Math.floor(d / 3);
  const k = d % 3;
  const end = k === 2 ? new Date(Date.UTC(year, m + 1, 0)).getUTCDate() : 10 * (k + 1);
  const name = new Date(Date.UTC(2001, m, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${name} ${1 + 10 * k}–${end}`;
}
