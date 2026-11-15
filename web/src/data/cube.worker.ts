/// <reference lib="webworker" />
// Web Worker: fetch → gunzip → decode cubes (LRU), AOI mask, per-dekad sums (ARCHITECTURE.md steps 2–4).
import { decodeCubeFile, type Cube } from './cube';
import { countMask, maskL01, maskL10, sumMasked, sumMaskedByTileL10, tilesForGeometry, type AoiGeometry } from './aggregate';
import type { Bbox } from '../lib/grid';
import { N_SERIES, type AoiSeries } from './types';

export interface AggregateRequest {
  id: number;
  baseUrl: string;
  level: 1 | 10;
  /** tiles listed in the manifest (others have no fire and are not fetched) */
  manifestTiles: string[];
  l10Path: string;
  geometry: AoiGeometry;
  bbox: Bbox;
  t0: number;
  nT: number;
}

export type AggregateResponse = { id: number; ok: true; result: AoiSeries } | { id: number; ok: false; error: string };

const LRU_MAX = 24;
const cache = new Map<string, Promise<Cube>>();

function getCube(url: string): Promise<Cube> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit);
    return hit;
  }
  const p = fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
    return decodeCubeFile(new Uint8Array(await r.arrayBuffer()));
  });
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  while (cache.size > LRU_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

async function aggregate(req: AggregateRequest): Promise<AoiSeries> {
  const start = performance.now();
  const { geometry, bbox, t0, nT } = req;
  if (req.level === 10) {
    const cube = await getCube(join(req.baseUrl, req.l10Path));
    const mask = maskL10(geometry, bbox);
    const { tiles, perTile } = sumMaskedByTileL10(cube, mask, t0, nT);
    return { level: 10, t0, nT, tiles, perTile, nCells: countMask(mask), fetched: [req.l10Path], ms: performance.now() - start };
  }
  const have = new Set(req.manifestTiles);
  const touched = tilesForGeometry(geometry);
  const fetchTiles = touched.filter((t) => have.has(t));
  const masks = touched.map((t) => maskL01(t, geometry, bbox));
  const nCells = masks.reduce((a, m) => a + countMask(m), 0);
  const cubes = await Promise.all(fetchTiles.map((t) => getCube(join(req.baseUrl, `cube/l01/${t}.bin.gz`))));
  const tiles: string[] = [];
  const perTile: Float64Array[] = [];
  fetchTiles.forEach((tile, i) => {
    const mask = masks[touched.indexOf(tile)];
    if (!countMask(mask)) return;
    const out = new Float64Array(N_SERIES * nT);
    sumMasked(cubes[i], mask, t0, nT, out);
    tiles.push(tile);
    perTile.push(out);
  });
  return { level: 1, t0, nT, tiles, perTile, nCells, fetched: fetchTiles, ms: performance.now() - start };
}

self.onmessage = async (e: MessageEvent<AggregateRequest>) => {
  const req = e.data;
  try {
    const result = await aggregate(req);
    const msg: AggregateResponse = { id: req.id, ok: true, result };
    (self as unknown as Worker).postMessage(msg, result.perTile.map((a) => a.buffer));
  } catch (err) {
    const msg: AggregateResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
