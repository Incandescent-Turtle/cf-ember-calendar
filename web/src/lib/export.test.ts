import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harmonize } from './harmonize';
import { calendarCsv, CALENDAR_COLUMNS, csvField, dataScope } from './export';
import { summarize, quantile } from './analytics';
import { hotspotLine, HOTSPOT_CSV_COLUMNS, type FullRow } from '../data/points';
import type { AoiSeries, Manifest } from '../data/types';

const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tests/golden/harmonize_cases.json'), 'utf8'));
const c = golden.cases.find((x: { name: string }) => x.name === 'fixture-chilecito');
const series: AoiSeries = {
  level: 1, t0: c.input.t0, nT: c.input.nT, tiles: c.input.tiles,
  perTile: c.input.perTile.map((a: number[]) => Float64Array.from(a)), nCells: 0, fetched: [], ms: 0,
};
const h = harmonize(series, c.input.manifest, c.input.calibration);

describe('calendar CSV', () => {
  const csv = calendarCsv(h, 2026);
  const lines = csv.trimEnd().split('\n');
  const head = lines[0].split(',');
  it('starts with the PRODUCT F5 columns, is ASCII, one row per month', () => {
    expect(head.slice(0, 10)).toEqual(['year', 'month', 'harmonized', 'harmonized_lo', 'harmonized_hi', 'modis_fcd', 'viirs_fcd', 'k', 'k_stratum', 'percentile']);
    expect(head).toEqual([...CALENDAR_COLUMNS]);
    expect(/^[\x20-\x7e\n]*$/.test(csv)).toBe(true);
    expect(lines.length - 1).toBe(h.rows.filter(Boolean).length);
  });
  it('reproduces the July climatology median from the CSV alone', () => {
    // a minimal CSV parser for quoted fields
    const parse = (l: string) => [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, '')).slice(0, head.length);
    const rows = lines.slice(1).map(parse);
    const col = (n: string) => head.indexOf(n);
    const jul = rows.filter((r) => r[col('month')] === '7' && r[col('partial')] === 'false' && r[col('year')] !== '2026').map((r) => Number(r[col('harmonized')]));
    expect(quantile(jul, 0.5)).toBeCloseTo(summarize(h, 2026).climatology[6].median, 3);
  });
  it('quotes fields with commas', () => {
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField(NaN)).toBe('');
  });
});

describe('hotspot CSV line', () => {
  it('follows the CONTRACTS column order', () => {
    const r: FullRow = { lat: -29.15, lon: -67.7, t_utc: 13_870_000, sensor: 4, frp: 12.345678, conf: 1, daynight: 1, scan: 0.39, track: 0.36, bt_mir: 330.1, bt_tir: 290.2, type: 255 };
    const f = hotspotLine(r).split(',');
    expect(f.length).toBe(HOTSPOT_CSV_COLUMNS.split(',').length);
    expect(f.slice(0, 8)).toEqual(['-29.15', '-67.7', '2026-05-15T22:40:00Z', 'VIIRS_NOAA20', 'VIIRS', '12.35', 'N', 'nominal']);
    expect(f[12]).toBe('');
  });
});

describe('data scope', () => {
  it('describes a regional build by its tile extent', () => {
    const m = { tiles: ['S30W070', 'S60W080', 'S30W060'] } as Manifest;
    expect(dataScope(m)).toEqual({ global: false, text: 'regional subset: 3 10° tiles within 60° S–20° S, 80° W–50° W' });
  });
});
