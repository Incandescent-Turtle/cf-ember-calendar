import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCube, encodeCube } from './cube';
import { densityFromCube, fitK, inWindow } from './density';
import { collectPoints, minutesSince2000, readPointsFile } from './points';
import { dekadIndex } from '../lib/time';
import { l01Cell, tile10 } from '../lib/grid';

const eras = { tSwitch: dekadIndex('2012-02-01'), tN20: dekadIndex('2026-11-02') };
const k = { modis: Array(12).fill(2), n20: Array(12).fill(1.5) };

describe('density', () => {
  it('applies the calendar eras per cell and honours the window', () => {
    const tM = dekadIndex('2010-07-05'); // MODIS era, July
    const tV = dekadIndex('2020-07-05'); // S-NPP era
    const tN = dekadIndex('2026-11-12'); // NOAA-20 era
    const cube = decodeCube(
      encodeCube(1, [
        [0, tM, 5, 10], [1, tM, 5, 99], // MODIS-era: only MODIS × k counts
        [0, tV, 5, 50], [1, tV, 5, 30], [2, tV, 5, 40], // S-NPP era: only S-NPP
        [2, tN, 7, 4], [1, tN, 7, 100], // NOAA-20 era: only NOAA-20 × k_N20
      ]),
    );
    const all = densityFromCube(cube, null, { year: null, month: null }, k, eras);
    const byCell = Object.fromEntries([...all.cells].map((c, i) => [c, all.values[i]]));
    expect(byCell[5]).toBe(2 * 10 + 30);
    expect(byCell[7]).toBe(6);
    const julys = densityFromCube(cube, null, { year: null, month: 6 }, k, eras);
    expect([...julys.cells]).toEqual([5]);
    const y2020 = densityFromCube(cube, null, { year: 2020, month: null }, k, eras);
    expect([...y2020.values]).toEqual([30]);
    const mask = new Uint8Array(10000);
    mask[7] = 1;
    expect([...densityFromCube(cube, mask, { year: null, month: null }, k, eras).cells]).toEqual([7]);
    expect(inWindow(tM, { year: 2010, month: 6 })).toBe(true);
    expect(inWindow(tM, { year: 2010, month: 5 })).toBe(false);
  });

  it('fits a ratio-of-sums k per month', () => {
    const t = dekadIndex('2015-03-01');
    const cube = decodeCube(encodeCube(10, [[0, t, 1, 10], [0, t, 2, 10], [1, t, 1, 50]]));
    const kk = fitK(cube, 1, 0, dekadIndex('2013-01-01'), dekadIndex('2021-12-31'));
    expect(kk[2]).toBe(2.5);
    expect(Number.isNaN(kk[0])).toBe(true);
  });
});

const fixture = resolve(import.meta.dirname, '../../../data/processed/points/S30W070/2025.parquet');
describe.skipIf(!existsSync(fixture))('points (fixture parquet, zstd)', () => {
  const buf = readFileSync(fixture);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const asBuffer = { byteLength: ab.byteLength, slice: (s: number, e?: number) => ab.slice(s, e) };

  it('skips row groups outside the lat range and filters by time + AOI', async () => {
    const all = await readPointsFile(asBuffer, [-70, -30, -60, -20]);
    const south = await readPointsFile(asBuffer, [-70, -30, -60, -29.5]);
    expect(all.length).toBeGreaterThan(south.length); // some row groups skipped
    expect(south.every((r) => r.lat <= -26)).toBe(true);
    // Chilecito, July 2025, cell-centre membership via an L01 mask
    const mask = new Uint8Array(10000);
    for (let lat = -29.25; lat <= -29.0; lat += 0.05) for (let lon = -67.8; lon <= -67.55; lon += 0.05) mask[l01Cell(lat, lon)] = 1;
    const res = await collectPoints(
      ['x'],
      [-67.8, -29.3, -67.5, -29.0],
      minutesSince2000(2025, 0),
      minutesSince2000(2026, 0),
      (lon, lat) => tile10(lat, lon) === 'S30W070' && mask[l01Cell(lat, lon)] === 1,
      async () => asBuffer,
    );
    expect(res.missing).toBe(0);
    for (let i = 0; i < res.lon.length; i++) {
      expect(res.t[i]).toBeGreaterThanOrEqual(minutesSince2000(2025, 0));
      expect(mask[l01Cell(res.lat[i], res.lon[i])]).toBe(1);
    }
  });
});
