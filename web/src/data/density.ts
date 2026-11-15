// Per-cell harmonized FCD over a time window (map density layer, PRODUCT.md F4).
// Same eras and k as the calendar (lib/harmonize.ts), applied cell by cell. Pure; runs in the Worker.
import type { Cube } from './cube';
import { S_MODIS, S_N20, S_SNPP } from './types';

/** year/month null = all. {year: 2025, month: 6} = Jul 2025; {year: null, month: 6} = every July. */
export interface TimeWindow {
  year: number | null;
  month: number | null;
}

export interface KPair {
  modis: number[]; // per calendar month
  n20: number[];
}

export interface Eras {
  tSwitch: number; // first S-NPP-era dekad (2012-02-01)
  tN20: number; // first NOAA-20-era dekad (dekad containing snpp_end)
}

export const inWindow = (t: number, w: TimeWindow) =>
  (w.year === null || 2000 + Math.floor(t / 36) === w.year) && (w.month === null || Math.floor(t / 3) % 12 === w.month);

/**
 * Sum harmonized FCD per cell for entries in the window. `mask` (optional) keeps only cells inside the AOI.
 * Returns parallel arrays of cell ids, harmonized values (non-zero only) and, for the tooltip, the raw
 * MODIS and raw VIIRS FCD of the same cells and window (VIIRS = S-NPP before the NOAA-20 switch,
 * NOAA-20 after, as MonthRow.viirs).
 */
export function densityFromCube(
  cube: Cube,
  mask: Uint8Array | null,
  w: TimeWindow,
  k: KPair,
  eras: Eras,
): { cells: Uint32Array; values: Float64Array; modis: Float64Array; viirs: Float64Array } {
  const acc = new Map<number, [number, number, number]>();
  const { s, t, c, v, n } = cube;
  for (let i = 0; i < n; i++) {
    const ci = c[i];
    if (mask && !mask[ci]) continue;
    const ti = t[i];
    if (!inWindow(ti, w)) continue;
    const si = s[i];
    const m = Math.floor(ti / 3) % 12;
    let h = 0;
    let rawM = 0;
    let rawV = 0;
    if (si === S_MODIS) rawM = v[i];
    if (ti < eras.tSwitch) {
      if (si === S_MODIS) h = k.modis[m] * v[i];
      else if (si === S_SNPP) rawV = v[i];
    } else if (ti < eras.tN20) {
      if (si === S_SNPP) h = rawV = v[i];
    } else if (si === S_N20) {
      h = k.n20[m] * v[i];
      rawV = v[i];
    }
    if (!(h > 0) && !rawM && !rawV) continue;
    const a = acc.get(ci);
    if (a) {
      if (h > 0) a[0] += h;
      a[1] += rawM;
      a[2] += rawV;
    } else acc.set(ci, [h > 0 ? h : 0, rawM, rawV]);
  }
  let size = 0;
  for (const a of acc.values()) if (a[0] > 0) size++;
  const cells = new Uint32Array(size);
  const values = new Float64Array(size);
  const modis = new Float64Array(size);
  const viirs = new Float64Array(size);
  let j = 0;
  for (const [ci, a] of acc) {
    if (!(a[0] > 0)) continue;
    cells[j] = ci;
    values[j] = a[0];
    modis[j] = a[1];
    viirs[j++] = a[2];
  }
  return { cells, values, modis, viirs };
}

/**
 * Ratio-of-sums k per calendar month from a whole cube (the "global" stratum when calibration.json
 * is absent): num series / den series over dekads [tA, tB]. NaN where the denominator is 0.
 */
export function fitK(cube: Cube, num: number, den: number, tA: number, tB: number): number[] {
  const N = new Float64Array(12);
  const D = new Float64Array(12);
  const { s, t, v, n } = cube;
  for (let i = 0; i < n; i++) {
    const ti = t[i];
    if (ti < tA || ti > tB) continue;
    const m = Math.floor(ti / 3) % 12;
    if (s[i] === num) N[m] += v[i];
    else if (s[i] === den) D[m] += v[i];
  }
  return Array.from(N, (x, m) => (D[m] > 0 ? x / D[m] : NaN));
}
