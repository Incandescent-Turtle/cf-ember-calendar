import { describe, expect, it } from 'vitest';
import { bboxPolygon } from '@turf/turf';
import { harmonize, monthPercentile } from './harmonize';
import { maskL01, maskL10, sumMasked, sumMaskedByTileL10, countMask } from '../data/aggregate';
import { encodeCube, decodeCube } from '../data/cube';
import { dekadIndex } from './time';
import type { AoiSeries, Calibration, Manifest } from '../data/types';
import { l01Cell, type Bbox } from './grid';

const T0 = dekadIndex('2000-11-01');
const T1 = dekadIndex('2026-11-14');
const nT = T1 - T0 + 1;
const manifest: Manifest = {
  version: 1, built_at: '', dekad_range: [T0, T1], series: [], tiles: ['S30W070'], l10: 'cube/l10/global.bin.gz',
  overlap: { start: '2013-01-01', end: '2021-12-31' }, snpp_end: '2026-11-02', min_modis_fcd: 200,
};

/** Synthetic AOI: MODIS = 10/dekad always, S-NPP = 25 from 2012-01-21, NOAA-20 = 20 from 2018-04. */
function synthetic(modis = 10): AoiSeries {
  const a = new Float64Array(4 * nT);
  for (let i = 0; i < nT; i++) {
    const t = T0 + i;
    a[i] = modis;
    if (t >= dekadIndex('2012-01-21')) a[nT + i] = 25;
    if (t >= dekadIndex('2018-04-01')) a[2 * nT + i] = 20;
  }
  return { level: 1, t0: T0, nT, tiles: ['S30W070'], perTile: [a], nCells: 1, fetched: [], ms: 0 };
}

describe('harmonize', () => {
  it('AOI k removes the 2012 step and NOAA-20 is scaled to S-NPP', () => {
    const h = harmonize(synthetic(), manifest, null);
    const row = (y: number, m: number) => h.rows[(y - h.years[0]) * 12 + m]!;
    expect(h.kModis[0].stratum).toBe('aoi');
    expect(h.kModis[0].k).toBeCloseTo(2.5);
    expect(row(2011, 11).harmonized).toBeCloseTo(row(2012, 2).harmonized);
    expect(row(2011, 11).spliced).toBeCloseTo(30); // raw MODIS shows the step
    expect(row(2012, 2).spliced).toBe(75);
    expect(row(2012, 0).era).toBe('modis');
    expect(row(2012, 1).era).toBe('snpp');
    expect(row(2026, 10).era).toBe('n20');
    expect(row(2026, 10).harmonized).toBeCloseTo(2 * 25); // two dekads × 20 × k_N20 (1.25)
    expect(row(2026, 10).partial).toBe(true);
    expect(h.rows[0]).toBeNull(); // Jan 2000: before the record
    expect(row(2000, 10).nDekads).toBe(3);
  });

  it('falls back to tile then global k when the AOI is sparse', () => {
    const cal: Calibration = {
      global: { k: Array(12).fill(2), lo: Array(12).fill(1.8), hi: Array(12).fill(2.2) },
      tile: { S30W070: { k: Array(12).fill(3), lo: Array(12).fill(2.7), hi: Array(12).fill(3.3), n_modis: Array(12).fill(500) } },
      n20: { global: { k: Array(12).fill(1), lo: Array(12).fill(1), hi: Array(12).fill(1) }, tile: {} },
    };
    const sparse = synthetic(0.5); // 0.5 × 3 dekads × 9 yrs = 13.5 < 200
    expect(harmonize(sparse, manifest, cal).kModis[5].stratum).toBe('tile');
    expect(harmonize(sparse, manifest, cal).kModis[5].k).toBe(3);
    const noTile = { ...cal, tile: {} };
    expect(harmonize(sparse, manifest, noTile).kModis[5].stratum).toBe('global');
    expect(harmonize(sparse, manifest, null).kModis[5].stratum).toBe('aoi-sparse');
  });

  it('percentile is mid-rank among complete baseline years', () => {
    const h = harmonize(synthetic(), manifest, null);
    expect(monthPercentile(h, 6, 75, 2026)).toBeCloseTo(50); // all Julys equal → 50
    expect(monthPercentile(h, 6, 1e9, 2026)).toBe(100);
  });
});

describe('aggregate', () => {
  it('sums cells whose centre is inside the AOI', () => {
    const bbox: Bbox = [-67.8, -29.3, -67.5, -29.0];
    const geom = bboxPolygon(bbox).geometry;
    const mask = maskL01('S30W070', geom, bbox);
    expect(countMask(mask)).toBe(9); // 3 × 3 cells of 0.1°
    const inside = l01Cell(-29.15, -67.65);
    const outside = l01Cell(-29.35, -67.65);
    const cube = decodeCube(encodeCube(1, [[0, T0, inside, 4], [0, T0, outside, 100], [1, T0 + 1, inside, 6]]));
    const out = new Float64Array(4 * nT);
    sumMasked(cube, mask, T0, nT, out);
    expect(out[0]).toBe(4);
    expect(out[nT + 1]).toBe(6);
    const l10 = maskL10(bboxPolygon([-75, -55, -53, -21]).geometry, [-75, -55, -53, -21]);
    const { tiles } = sumMaskedByTileL10(decodeCube(encodeCube(10, [])), l10, T0, nT);
    expect(tiles).toContain('S30W070');
  });
});
