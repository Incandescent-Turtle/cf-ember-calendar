// AOI → cells → per-dekad sums (ARCHITECTURE.md → browser data layer, steps 2 and 4).
// Pure functions, used inside the Worker and in tests.
import { booleanPointInPolygon } from '@turf/turf';
import type { MultiPolygon, Polygon } from 'geojson';
import type { Cube } from './cube';
import { l01Center, l10Center, tileBounds, tileIdFromIndex, tilesForBbox, type Bbox } from '../lib/grid';
import { N_SERIES } from './types';

export type AoiGeometry = Polygon | MultiPolygon;

/** Tiles touched by the AOI: union over polygon parts of each part's bbox (so far-flung islands
 * don't blow up the count the way a single overall bbox would). */
export function tilesForGeometry(geom: AoiGeometry): string[] {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const out = new Set<string>();
  for (const poly of polys) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of poly[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    for (const t of tilesForBbox([w, s, e, n])) out.add(t);
  }
  return [...out];
}

/** ≤ 16 tiles touched by the AOI → L01, otherwise L10 (ARCHITECTURE.md). */
export const MAX_L01_TILES = 16;
export function pickLevel(geom: AoiGeometry): 1 | 10 {
  return tilesForGeometry(geom).length <= MAX_L01_TILES ? 1 : 10;
}

const inBbox = (lon: number, lat: number, [w, s, e, n]: Bbox) => lon >= w && lon <= e && lat >= s && lat <= n;

/** 10000-cell mask of L01 cells in `tile` whose centre lies inside the AOI. */
export function maskL01(tile: string, geom: AoiGeometry, bbox: Bbox): Uint8Array {
  const mask = new Uint8Array(10000);
  const [tw, ts, te, tn] = tileBounds(tile);
  if (bbox[2] < tw || bbox[0] > te || bbox[3] < ts || bbox[1] > tn) return mask;
  for (let c = 0; c < 10000; c++) {
    const p = l01Center(tile, c);
    if (inBbox(p[0], p[1], bbox) && booleanPointInPolygon(p, geom)) mask[c] = 1;
  }
  return mask;
}

/** 64800-cell mask of L10 cells whose centre lies inside the AOI. */
export function maskL10(geom: AoiGeometry, bbox: Bbox): Uint8Array {
  const mask = new Uint8Array(64800);
  const r0 = Math.max(0, Math.floor(bbox[1] + 90));
  const r1 = Math.min(179, Math.floor(bbox[3] + 90));
  const q0 = Math.max(0, Math.floor(bbox[0] + 180));
  const q1 = Math.min(359, Math.floor(bbox[2] + 180));
  for (let r = r0; r <= r1; r++)
    for (let q = q0; q <= q1; q++) {
      const c = r * 360 + q;
      const p = l10Center(c);
      if (inBbox(p[0], p[1], bbox) && booleanPointInPolygon(p, geom)) mask[c] = 1;
    }
  return mask;
}

/** Add masked entries of `cube` into `out` (length N_SERIES·nT). */
export function sumMasked(cube: Cube, mask: Uint8Array, t0: number, nT: number, out: Float64Array): void {
  const { s, t, c, v, n } = cube;
  for (let i = 0; i < n; i++) {
    if (!mask[c[i]]) continue;
    const k = t[i] - t0;
    if (k < 0 || k >= nT || s[i] >= N_SERIES) continue;
    out[s[i] * nT + k] += v[i];
  }
}

/** L10: sum masked entries split by the 10° tile each 1° cell belongs to. */
export function sumMaskedByTileL10(
  cube: Cube,
  mask: Uint8Array,
  t0: number,
  nT: number,
): { tiles: string[]; perTile: Float64Array[] } {
  const tileOf = new Int16Array(64800).fill(-1);
  const tiles: string[] = [];
  const index = new Map<string, number>();
  for (let c = 0; c < 64800; c++) {
    if (!mask[c]) continue;
    const id = tileIdFromIndex(Math.floor(Math.floor(c / 360) / 10), Math.floor((c % 360) / 10));
    let i = index.get(id);
    if (i === undefined) index.set(id, (i = tiles.push(id) - 1));
    tileOf[c] = i;
  }
  const perTile = tiles.map(() => new Float64Array(N_SERIES * nT));
  const { s, t, c, v, n } = cube;
  for (let i = 0; i < n; i++) {
    const ti = tileOf[c[i]];
    if (ti < 0) continue;
    const k = t[i] - t0;
    if (k < 0 || k >= nT || s[i] >= N_SERIES) continue;
    perTile[ti][s[i] * nT + k] += v[i];
  }
  return { tiles, perTile };
}

export const countMask = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
