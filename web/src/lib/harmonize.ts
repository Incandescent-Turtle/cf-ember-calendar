// Harmonize AOI series into monthly VIIRS-equivalent FCD (HARMONIZATION.md steps 3–4,
// ARCHITECTURE.md step 5). S2 implementation; S4 checks it against tests/golden/*.json.
import type { AoiSeries, Calibration, KBlock, Manifest } from '../data/types';
import { S_MODIS, S_N20, S_SNPP } from '../data/types';
import { dekadIndex, dekadMonth } from './time';

export type Stratum = 'aoi' | 'tile' | 'global' | 'aoi-sparse' | 'none';
export type Era = 'modis' | 'snpp' | 'n20';

export interface KUsed {
  k: number;
  lo: number;
  hi: number;
  stratum: Stratum;
  /** human-readable source, e.g. "AOI (2013–2021, 1,234 MODIS FCD)" or "tile S30W070" */
  detail: string;
}

export interface MonthRow {
  year: number;
  month: number; // 0–11
  modis: number;
  snpp: number;
  n20: number;
  /** raw VIIRS as shown in the "VIIRS raw" view: S-NPP before the switch, NOAA-20 after */
  viirs: number;
  /** spliced raw: MODIS before 2012-02, VIIRS after (what you'd get without harmonization) */
  spliced: number;
  harmonized: number;
  lo: number;
  hi: number;
  era: Era;
  kUsed: KUsed | null; // null in the S-NPP era (reference series)
  /** fewer dekads observed than the month has (record start/end) */
  partial: boolean;
  nDekads: number;
}

export interface Harmonized {
  years: number[];
  /** rows[(year − years[0]) * 12 + month], null where the month is outside the record */
  rows: (MonthRow | null)[];
  kModis: KUsed[]; // per calendar month
  kN20: KUsed[];
  tSwitch: number;
  tN20: number;
  /** t0 of the input; dekadal[t − t0] = harmonized FCD in dekad t (NaN where no k) */
  t0: number;
  dekadal: Float64Array;
}

export const SWITCH_DATE = '2012-02-01';
export const N20_FIT = { start: '2020-06-01', end: '2026-10-31' };
const BOOT_N = 200;

/** Sum per-tile series → one series per id. */
export function totalSeries(a: AoiSeries): Float64Array {
  const out = new Float64Array(a.perTile[0]?.length ?? 4 * a.nT);
  for (const arr of a.perTile) for (let i = 0; i < arr.length; i++) out[i] += arr[i];
  return out;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
};

/**
 * Ratio-of-sums k = Σ num / Σ den per calendar month over dekads in [tA, tB], with a
 * year-bootstrap 5–95 % band. Returns per month {k, lo, hi, den}.
 */
export function fitRatio(
  num: (k: number) => number,
  den: (k: number) => number,
  t0: number,
  nT: number,
  tA: number,
  tB: number,
): { k: number; lo: number; hi: number; den: number }[] {
  // per month × year sums
  const byMonth = Array.from({ length: 12 }, () => new Map<number, [number, number]>());
  for (let t = Math.max(tA, t0); t <= Math.min(tB, t0 + nT - 1); t++) {
    const m = dekadMonth(t);
    const y = Math.floor(t / 36);
    const cell = byMonth[m].get(y) ?? [0, 0];
    cell[0] += num(t - t0);
    cell[1] += den(t - t0);
    byMonth[m].set(y, cell);
  }
  return byMonth.map((years, m) => {
    const vals = [...years.values()];
    const N = vals.reduce((a, v) => a + v[0], 0);
    const D = vals.reduce((a, v) => a + v[1], 0);
    const k = D > 0 ? N / D : NaN;
    const rnd = mulberry32(1000 + m);
    const boots: number[] = [];
    for (let b = 0; b < BOOT_N && vals.length; b++) {
      let bn = 0;
      let bd = 0;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[Math.floor(rnd() * vals.length)];
        bn += v[0];
        bd += v[1];
      }
      if (bd > 0) boots.push(bn / bd);
    }
    boots.sort((a, b) => a - b);
    return { k, lo: quantile(boots, 0.05), hi: quantile(boots, 0.95), den: D };
  });
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Choose k per month: AOI → tile (MODIS-weighted over the AOI's tiles) → global → AOI-sparse → none. */
function chooseK(
  aoiFit: { k: number; lo: number; hi: number; den: number }[],
  perTileDen: { tile: string; den: number[] }[],
  tileBlocks: Record<string, KBlock> | undefined,
  globalBlock: KBlock | undefined,
  minDen: number,
  fitLabel: string,
  denLabel: string,
): KUsed[] {
  return aoiFit.map((f, m) => {
    if (f.den >= minDen && Number.isFinite(f.k))
      return { k: f.k, lo: f.lo, hi: f.hi, stratum: 'aoi', detail: `this area, ${fitLabel} (${fmt(f.den)} ${denLabel})` };
    if (tileBlocks) {
      const usable = perTileDen.filter(
        (t) => tileBlocks[t.tile] && Number.isFinite(tileBlocks[t.tile].k[m]) && (tileBlocks[t.tile].n_modis?.[m] ?? minDen) >= minDen,
      );
      if (usable.length) {
        const w = usable.reduce((a, t) => a + t.den[m], 0);
        const weight = (t: (typeof usable)[number]) => (w > 0 ? t.den[m] / w : 1 / usable.length);
        const agg = (key: 'k' | 'lo' | 'hi') => usable.reduce((a, t) => a + weight(t) * tileBlocks[t.tile][key][m], 0);
        return { k: agg('k'), lo: agg('lo'), hi: agg('hi'), stratum: 'tile', detail: `10° tile ${usable.map((t) => t.tile).join(' + ')}` };
      }
    }
    if (globalBlock && Number.isFinite(globalBlock.k[m]))
      return { k: globalBlock.k[m], lo: globalBlock.lo[m], hi: globalBlock.hi[m], stratum: 'global', detail: 'global' };
    if (f.den > 0 && Number.isFinite(f.k))
      return { k: f.k, lo: f.lo, hi: f.hi, stratum: 'aoi-sparse', detail: `this area, sparse (${fmt(f.den)} ${denLabel}; no calibration file)` };
    return { k: NaN, lo: NaN, hi: NaN, stratum: 'none', detail: 'no calibration available' };
  });
}

export function harmonize(a: AoiSeries, manifest: Manifest, cal: Calibration | null): Harmonized {
  const { t0, nT } = a;
  const tot = totalSeries(a);
  const M = (i: number) => tot[S_MODIS * nT + i];
  const V = (i: number) => tot[S_SNPP * nT + i];
  const N = (i: number) => tot[S_N20 * nT + i];
  const tSwitch = dekadIndex(SWITCH_DATE);
  const tN20 = dekadIndex(manifest.snpp_end);
  const tOvA = dekadIndex(manifest.overlap.start);
  const tOvB = dekadIndex(manifest.overlap.end);
  const tNA = dekadIndex(N20_FIT.start);
  const tNB = Math.min(dekadIndex(N20_FIT.end), tN20 - 1);
  const minDen = manifest.min_modis_fcd;

  const perTileSums = (s: number, tA: number, tB: number) =>
    a.tiles.map((tile, i) => {
      const den = new Array(12).fill(0);
      for (let t = Math.max(tA, t0); t <= Math.min(tB, t0 + nT - 1); t++) den[dekadMonth(t)] += a.perTile[i][s * nT + t - t0];
      return { tile, den };
    });

  const kModis = chooseK(
    fitRatio(V, M, t0, nT, tOvA, tOvB),
    perTileSums(S_MODIS, tOvA, tOvB),
    cal?.tile,
    cal?.global,
    minDen,
    `${manifest.overlap.start.slice(0, 4)}–${manifest.overlap.end.slice(0, 4)}`,
    'MODIS FCD',
  );
  const kN20 = chooseK(
    fitRatio(V, N, t0, nT, tNA, tNB),
    perTileSums(S_N20, tNA, tNB),
    cal?.n20?.tile,
    cal?.n20?.global,
    minDen,
    `${N20_FIT.start.slice(0, 7)} → ${N20_FIT.end.slice(0, 7)}`,
    'NOAA-20 FCD',
  );

  const y0 = Math.floor(t0 / 36) + 2000;
  const y1 = Math.floor((t0 + nT - 1) / 36) + 2000;
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const rows: (MonthRow | null)[] = new Array(years.length * 12).fill(null);
  const dekadal = new Float64Array(nT);
  for (let i = 0; i < nT; i++) {
    const t = t0 + i;
    const year = Math.floor(t / 36) + 2000;
    const month = dekadMonth(t);
    const idx = (year - y0) * 12 + month;
    const era: Era = t < tSwitch ? 'modis' : t < tN20 ? 'snpp' : 'n20';
    let row = rows[idx];
    if (!row) {
      const kUsed = era === 'modis' ? kModis[month] : era === 'n20' ? kN20[month] : null;
      row = rows[idx] = {
        year, month, modis: 0, snpp: 0, n20: 0, viirs: 0, spliced: 0, harmonized: 0, lo: 0, hi: 0,
        era, kUsed, partial: false, nDekads: 0,
      };
    }
    const m = M(i);
    const v = V(i);
    const n = N(i);
    row.modis += m;
    row.snpp += v;
    row.n20 += n;
    row.nDekads++;
    if (era === 'modis') {
      const k = kModis[month];
      dekadal[i] = k.k * m;
      row.harmonized += k.k * m;
      row.lo += k.lo * m;
      row.hi += k.hi * m;
      row.viirs += v;
      row.spliced += m;
    } else if (era === 'snpp') {
      dekadal[i] = v;
      row.harmonized += v;
      row.lo += v;
      row.hi += v;
      row.viirs += v;
      row.spliced += v;
    } else {
      const k = kN20[month];
      dekadal[i] = k.k * n;
      row.harmonized += k.k * n;
      row.lo += k.lo * n;
      row.hi += k.hi * n;
      row.viirs += n;
      row.spliced += n;
    }
  }
  for (const r of rows) if (r) r.partial = r.nDekads < 3;
  return { years, rows, kModis, kN20, tSwitch, tN20, t0, dekadal };
}

/**
 * Percentile (0–100) of `value` among the same calendar month in complete baseline years
 * (every year with 3 dekads observed in that month, excluding `excludeYear`). Mid-rank for ties.
 */
export function monthPercentile(h: Harmonized, month: number, value: number, excludeYear: number): number {
  const base: number[] = [];
  for (const y of h.years) {
    if (y === excludeYear) continue;
    const r = h.rows[(y - h.years[0]) * 12 + month];
    if (r && !r.partial && Number.isFinite(r.harmonized)) base.push(r.harmonized);
  }
  if (!base.length || !Number.isFinite(value)) return NaN;
  const below = base.filter((b) => b < value).length;
  const eq = base.filter((b) => b === value).length;
  return (100 * (below + 0.5 * eq)) / base.length;
}
