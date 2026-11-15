import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCube, decodeCubeFile, encodeCube, encodeCubeGz } from './cube';
import { dekadIndex, dekadRange } from '../lib/time';
import { l01Cell, l10Cell, tile10, tilesForBbox, l01Center, tileOfL10, l10Center } from '../lib/grid';

const FIX = resolve(import.meta.dirname, '../../test-fixtures');
const cases = JSON.parse(readFileSync(resolve(FIX, 'pipeline_cases.json'), 'utf8'));

describe('cube codec', () => {
  it('decodes a pipeline-written cube (pipeline/cubes.write_cube)', async () => {
    const cube = await decodeCubeFile(new Uint8Array(readFileSync(resolve(FIX, cases.cube))));
    expect(cube.level).toBe(1);
    const rows = Array.from({ length: cube.n }, (_, i) => [cube.s[i], cube.t[i], cube.c[i], cube.v[i]]);
    expect(rows).toEqual(cases.cube_rows);
  });

  it('round-trips and accepts already-decompressed bytes', async () => {
    const rows: [number, number, number, number][] = [[2, 900, 5, 3], [0, 30, 1, 0], [0, 30, 0, 9], [1, 31, 64799, 70000]];
    const raw = encodeCube(10, rows);
    expect(raw.length).toBe(12 + 7 * 3);
    const a = decodeCube(raw);
    expect([...a.s]).toEqual([0, 1, 2]);
    expect([...a.v]).toEqual([9, 65535, 3]);
    const b = await decodeCubeFile(encodeCubeGz(10, rows));
    expect([...b.c]).toEqual([...a.c]);
    expect(() => decodeCube(raw.slice(0, raw.length - 1))).toThrow(/bad length/);
  });

  const processed = resolve(import.meta.dirname, '../../../data/processed/cube/l01');
  it.skipIf(!existsSync(processed))('decodes every fixture-build tile (data/processed)', async () => {
    for (const f of readdirSync(processed)) {
      const cube = await decodeCubeFile(new Uint8Array(readFileSync(resolve(processed, f))));
      expect(cube.n).toBeGreaterThan(0);
      for (let i = 1; i < cube.n; i++) {
        const prev = cube.s[i - 1] * 2 ** 32 + cube.t[i - 1] * 2 ** 16 + cube.c[i - 1];
        const cur = cube.s[i] * 2 ** 32 + cube.t[i] * 2 ** 16 + cube.c[i];
        if (cur <= prev) throw new Error(`${f}: not sorted at ${i}`);
      }
    }
  });
});

describe('time axis matches pipeline/grid.py', () => {
  it('dekad_index', () => {
    for (const [d, t] of Object.entries(cases.dekad_index)) expect(dekadIndex(d)).toBe(t);
  });
  it('dekad_range', () => {
    for (const [t, r] of Object.entries(cases.dekad_range)) expect(dekadRange(Number(t))).toEqual(r);
  });
});

describe('grid matches pipeline/grid.py', () => {
  it('binning rule', () => {
    for (const b of cases.binning) {
      expect(tile10(b.lat, b.lon)).toBe(b.tile);
      expect(l01Cell(b.lat, b.lon)).toBe(b.l01);
      expect(l10Cell(b.lat, b.lon)).toBe(b.l10);
    }
  });
  it('centres bin back to their own cell', () => {
    const [lon, lat] = l01Center('S30W070', 1234);
    expect(tile10(lat, lon)).toBe('S30W070');
    expect(l01Cell(lat, lon)).toBe(1234);
    const [lo2, la2] = l10Center(40000);
    expect(l10Cell(la2, lo2)).toBe(40000);
    expect(tileOfL10(40000)).toBe(tile10(la2, lo2));
  });
  it('tilesForBbox', () => {
    expect(tilesForBbox([-67.8, -29.3, -67.5, -29.0])).toEqual(['S30W070']);
    expect(tilesForBbox([-70, -30, -60, -20]).length).toBe(4); // edges touch neighbours
    expect(tilesForBbox([-180, -90, 180, 90]).length).toBe(18 * 36);
  });
});
