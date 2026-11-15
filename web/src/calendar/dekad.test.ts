import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harmonize } from '../lib/harmonize';
import type { AoiSeries } from '../data/types';
import { dekadCells, dekadLabel } from './dekad';

const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tests/golden/harmonize_cases.json'), 'utf8'));
const c = golden.cases.find((x: { name: string }) => x.name === 'fixture-chilecito');
const series: AoiSeries = {
  level: 1, t0: c.input.t0, nT: c.input.nT, tiles: c.input.tiles,
  perTile: c.input.perTile.map((a: number[]) => Float64Array.from(a)), nCells: 1, fetched: c.input.tiles, ms: 0,
};

describe('dekad sub-view', () => {
  it('dekads add up to the monthly calendar rows (harmonized and raw)', () => {
    const h = harmonize(series, c.input.manifest, c.input.calibration);
    const cells = dekadCells(h, series);
    expect(cells.length).toBe(series.nT);
    const sums = new Map<string, number[]>();
    for (const x of cells) {
      const key = `${x.year}-${Math.floor(x.d / 3)}`;
      const s = sums.get(key) ?? [0, 0, 0];
      s[0] += x.harmonized;
      s[1] += x.modis;
      s[2] += x.snpp + x.n20;
      sums.set(key, s);
    }
    for (const r of h.rows) {
      if (!r) continue;
      const s = sums.get(`${r.year}-${r.month}`)!;
      expect(s[0]).toBeCloseTo(r.harmonized, 6);
      expect(s[1]).toBe(r.modis);
      expect(s[2]).toBe(r.snpp + r.n20);
    }
    const jul2010 = cells.find((x) => x.year === 2010 && x.d === 18)!;
    expect(jul2010.era).toBe('modis');
    expect(jul2010.k).toBe(h.kModis[6]);
  });

  it('labels dekads of the year', () => {
    expect(dekadLabel(0)).toBe('Jan 1–10');
    expect(dekadLabel(5, 2024)).toBe('Feb 21–29');
    expect(dekadLabel(20)).toBe('Jul 21–31');
  });
});
