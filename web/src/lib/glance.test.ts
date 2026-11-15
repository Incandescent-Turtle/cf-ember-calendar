import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harmonize } from './harmonize';
import { computeGlance, lastCompleteDekad } from './glance';
import { monthToDate } from './analytics';
import { dekadIndex } from './time';
import type { AoiSeries, Manifest } from '../data/types';

const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tests/golden/harmonize_cases.json'), 'utf8'));
const c = golden.cases.find((x: { name: string }) => x.name === 'fixture-chilecito');
const series: AoiSeries = {
  level: 1, t0: c.input.t0, nT: c.input.nT, tiles: c.input.tiles,
  perTile: c.input.perTile.map((a: number[]) => Float64Array.from(a)), nCells: 0, fetched: [], ms: 0,
};
const t1 = c.input.t0 + c.input.nT - 1;
const manifest = (built: string): Manifest => ({
  ...c.input.manifest, version: 1, built_at: built, dekad_range: [c.input.t0, t1], series: [], tiles: c.input.tiles, l10: '',
});

describe('at a glance', () => {
  it('drops a last dekad that was still in progress at build time', () => {
    expect(t1).toBe(dekadIndex('2026-11-14'));
    expect(lastCompleteDekad(manifest('2026-11-15T06:00:00Z'))).toEqual({ t: t1 - 1, dropped: true });
    expect(lastCompleteDekad(manifest('2026-11-21T00:00:00Z'))).toEqual({ t: t1, dropped: false });
  });

  it('month-to-date compares the same dekads of baseline years', () => {
    const m = manifest('2026-11-15T06:00:00Z');
    const h = harmonize(series, m, c.input.calibration);
    const g = computeGlance(h, series, m, 2026);
    const mtd = g.mtd!;
    expect([mtd.year, mtd.month, mtd.dekads]).toEqual([2026, 10, 1]);
    expect(mtd.baseYears).toEqual(g.summary.baselineYears);
    expect(mtd.baseYears).not.toContain(2026);
    const ref = monthToDate(mtd.currentDekads, mtd.baseDekads);
    expect(mtd.ratio).toEqual(ref.ratio);
    expect(mtd.percentile).toEqual(ref.percentile);
    // with the full Nov 11–20 dekad, two dekads are compared
    const m2 = manifest('2026-11-30T00:00:00Z');
    expect(computeGlance(harmonize(series, m2, c.input.calibration), series, m2, 2026).mtd!.dekads).toBe(2);
  });

  it('flags sparse areas (the 25 km Chilecito case: most months have no activity)', () => {
    const m = manifest('2026-11-15T06:00:00Z');
    const g = computeGlance(harmonize(series, m, c.input.calibration), series, m, 2026);
    expect(g.sparse).toBe(true);
    expect(g.zeroShare).toBeGreaterThan(0.5);
    expect(g.zeroMonths).toBeLessThanOrEqual(g.baseMonths);
  });

  it('top lists and busiest month', () => {
    const m = manifest('2026-11-15T06:00:00Z');
    const g = computeGlance(harmonize(series, m, c.input.calibration), series, m, 2026);
    expect(g.topYears.length).toBe(3);
    expect(g.topYears[0].value).toBeGreaterThanOrEqual(g.topYears[1].value);
    expect(g.topMonths.length).toBeLessThanOrEqual(3);
    expect(g.topMonths.every((m) => m.median > 0)).toBe(true); // months with a median of 0 aren't 'busiest'
    expect(g.busiest).not.toBeNull();
    expect(g.busiest!.partial).toBe(false);
  });
});
