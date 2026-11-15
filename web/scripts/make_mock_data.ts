// Writes contract-format mock data to web/mock-data/ (CONTRACTS.md): manifest, calibration, validation,
// two L01 tiles and the L10 global cube. Exercises the real decoder before/without pipeline output.
// The dev server serves pipeline output first and falls back to these files (vite.config.ts).
//   npx tsx scripts/make_mock_data.ts [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { encodeCubeGz, type CubeRow } from '../src/data/cube.ts';
import { dekadIndex, dekadMonth } from '../src/lib/time.ts';
import { l01Center, l10Cell } from '../src/lib/grid.ts';

const out = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../mock-data'));
const write = (rel: string, data: string | Uint8Array) => {
  const p = resolve(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

let seed = 12345;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const poisson = (lam: number) => {
  if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * (rand() + rand() + rand() - 1.5) * 2));
  let k = 0;
  for (let p = Math.exp(-lam), s = p, u = rand(); u > s; k++) p *= lam / (k + 1), (s += p);
  return k;
};

const T0 = dekadIndex('2000-11-01');
const T1 = dekadIndex('2026-11-14');
const T_SNPP = dekadIndex('2012-01-21');
const T_N20 = dekadIndex('2018-04-01');
const K_TRUE = 2.2;
const season = (m: number) => 0.15 + Math.exp(-((m - 7.5) ** 2) / 3) + 0.4 * Math.exp(-((m - 1) ** 2) / 2);

function tileRows(tile: string, intensity: number): CubeRow[] {
  const rows: CubeRow[] = [];
  // a few hundred active cells in a blob
  const cells: number[] = [];
  for (let i = 0; i < 300; i++) cells.push(Math.floor(rand() * 40 + 30) * 100 + Math.floor(rand() * 40 + 30));
  const uniq = [...new Set(cells)];
  for (let t = T0; t <= T1; t++) {
    const lam = intensity * season(dekadMonth(t)) * (1 + 0.3 * Math.sin(t / 36));
    for (const c of uniq) {
      if (rand() > 0.15) continue;
      const v = poisson(lam);
      if (v === 0) continue;
      rows.push([0, t, c, Math.max(0, Math.round(v / K_TRUE + (rand() - 0.5)))]);
      if (t >= T_SNPP) rows.push([1, t, c, v]);
      if (t >= T_N20) rows.push([2, t, c, Math.round(v * 1.05)]);
    }
  }
  return rows;
}

const tiles = { S30W070: 3, S40W070: 1.5 } as const;
const l10 = new Map<string, number>();
for (const [tile, intensity] of Object.entries(tiles)) {
  const rows = tileRows(tile, intensity);
  write(`cube/l01/${tile}.bin.gz`, encodeCubeGz(1, rows));
  for (const [s, t, c, v] of rows) {
    const [lon, lat] = l01Center(tile, c);
    const key = `${s},${t},${l10Cell(lat, lon)}`;
    l10.set(key, (l10.get(key) ?? 0) + v);
  }
}
write('cube/l10/global.bin.gz', encodeCubeGz(10, [...l10].map(([k, v]) => [...k.split(',').map(Number), v] as CubeRow)));

const twelve = (x: number) => Array.from({ length: 12 }, () => x);
const kBlock = (k: number) => ({ k: twelve(k), lo: twelve(k * 0.9), hi: twelve(k * 1.1), n_modis: twelve(500) });
write(
  'manifest.json',
  JSON.stringify(
    {
      version: 1,
      mock: true,
      built_at: new Date().toISOString().slice(0, 19) + 'Z',
      dekad_range: [T0, T1],
      series: ['MODIS', 'VIIRS_SNPP', 'VIIRS_NOAA20', 'VIIRS_NOAA21'],
      tiles: Object.keys(tiles),
      l10: 'cube/l10/global.bin.gz',
      overlap: { start: '2013-01-01', end: '2021-12-31' },
      snpp_end: '2026-11-02',
      min_modis_fcd: 200,
      points: { years: [2000, 2026], tiles: [] },
      row_counts: { MODIS: 0, VIIRS_SNPP: 0, VIIRS_NOAA20: 0 },
      sizes_mb: { cubes: 0, points: 0 },
    },
    null,
    1,
  ),
);
write(
  'calibration.json',
  JSON.stringify({
    mock: true,
    global: kBlock(K_TRUE),
    tile: Object.fromEntries(Object.keys(tiles).map((t) => [t, kBlock(K_TRUE * 1.02)])),
    n20: { global: { k: twelve(0.95), lo: twelve(0.9), hi: twelve(1.0) }, tile: {} },
  }),
);
const metrics = { r_log: 0, mdape: 0, bias_log: 0 };
write(
  'validation.json',
  JSON.stringify({
    mock: true,
    loyo: { levels: [{ level: 'global', n_series: 0, calibrated: metrics, fcd_uncalibrated: metrics, raw_counts: metrics }] },
    seam: { scopes: [], test: { window_months: 24, mean_log_diff_before: 0, mean_log_diff_after: 0 } },
    seasonality: { median_r: 0, n_tiles: 0 },
    params: { overlap: ['2013-01-01', '2021-12-31'], min_modis_fcd: 200 },
  }),
);
console.log(`mock data → ${out} (tiles ${Object.keys(tiles).join(', ')}, L10 entries ${l10.size})`);
