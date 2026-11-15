/// <reference lib="webworker" />
// Web Worker: fetch → gunzip → decode cubes (LRU), AOI cell masks (cached per AOI), and
//  - aggregate: per-tile, per-dekad sums for the calendar (ARCHITECTURE.md steps 2–4)
//  - density:   per-cell harmonized FCD in a time window for the map
//  - points:    hotspot points in a ≤ 1-year window for the map
import { decodeCubeFile, type Cube } from './cube';
import { countMask, maskL01, maskL10, sumMasked, sumMaskedByTileL10, tilesForGeometry, type AoiGeometry } from './aggregate';
import { densityFromCube, fitK, type Eras, type KPair, type TimeWindow } from './density';
import { collectPoints, type PointsResult } from './points';
import { l01Cell, l10Cell, tile10, type Bbox } from '../lib/grid';
import { N_SERIES, S_MODIS, S_N20, S_SNPP, type AoiSeries } from './types';

export interface AoiRef {
  id: string;
  geometry: AoiGeometry;
  bbox: Bbox;
  level: 1 | 10;
}

interface Common {
  baseUrl: string;
  /** tiles listed in the manifest (others have no fire and are not fetched) */
  manifestTiles: string[];
  l10Path: string;
}

export type WorkerRequest = Common &
  (
    | { kind: 'aggregate'; aoi: AoiRef; t0: number; nT: number }
    | {
        kind: 'density';
        aoi: AoiRef | null; // null = whole world at L10
        window: TimeWindow;
        eras: Eras;
        /** k to apply; null → fit global k from the L10 cube over the given dekad ranges */
        k: KPair | null;
        fit: { overlap: [number, number]; n20: [number, number] };
      }
    | { kind: 'points'; aoi: AoiRef; paths: string[]; tA: number; tB: number }
  );

export interface DensityResult {
  level: 1 | 10;
  /** one group per L01 tile, or a single group 'L10' */
  groups: { tile: string; cells: Uint32Array; values: Float64Array }[];
  k: KPair;
  ms: number;
}

export type WorkerResult = AoiSeries | DensityResult | PointsResult;
export type WorkerResponse = { id: number; ok: true; result: WorkerResult } | { id: number; ok: false; error: string };

// ---------------------------------------------------------------- caches
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

interface Masks {
  level: 1 | 10;
  touched: string[]; // L01 tiles touched by the AOI
  byTile: Map<string, Uint8Array>; // L01
  l10: Uint8Array | null;
  nCells: number;
}
const maskCache = new Map<string, Masks>();

function getMasks(aoi: AoiRef): Masks {
  const key = `${aoi.id}:${aoi.level}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  let m: Masks;
  if (aoi.level === 10) {
    const l10 = maskL10(aoi.geometry, aoi.bbox);
    m = { level: 10, touched: [], byTile: new Map(), l10, nCells: countMask(l10) };
  } else {
    const touched = tilesForGeometry(aoi.geometry);
    const byTile = new Map(touched.map((t) => [t, maskL01(t, aoi.geometry, aoi.bbox)] as const));
    m = { level: 1, touched, byTile, l10: null, nCells: [...byTile.values()].reduce((a, x) => a + countMask(x), 0) };
  }
  maskCache.set(key, m);
  while (maskCache.size > 4) maskCache.delete(maskCache.keys().next().value as string);
  return m;
}

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
const l01Url = (req: Common, tile: string) => join(req.baseUrl, `cube/l01/${tile}.bin.gz`);

// ---------------------------------------------------------------- handlers
async function aggregate(req: Common & { aoi: AoiRef; t0: number; nT: number }): Promise<AoiSeries> {
  const start = performance.now();
  const { t0, nT } = req;
  const masks = getMasks(req.aoi);
  if (masks.level === 10) {
    const cube = await getCube(join(req.baseUrl, req.l10Path));
    const { tiles, perTile } = sumMaskedByTileL10(cube, masks.l10!, t0, nT);
    return { level: 10, t0, nT, tiles, perTile, nCells: masks.nCells, fetched: [req.l10Path], ms: performance.now() - start };
  }
  const have = new Set(req.manifestTiles);
  const fetchTiles = masks.touched.filter((t) => have.has(t));
  const cubes = await Promise.all(fetchTiles.map((t) => getCube(l01Url(req, t))));
  const tiles: string[] = [];
  const perTile: Float64Array[] = [];
  fetchTiles.forEach((tile, i) => {
    const mask = masks.byTile.get(tile)!;
    if (!countMask(mask)) return;
    const out = new Float64Array(N_SERIES * nT);
    sumMasked(cubes[i], mask, t0, nT, out);
    tiles.push(tile);
    perTile.push(out);
  });
  return { level: 1, t0, nT, tiles, perTile, nCells: masks.nCells, fetched: fetchTiles, ms: performance.now() - start };
}

async function density(req: Extract<WorkerRequest, { kind: 'density' }>): Promise<DensityResult> {
  const start = performance.now();
  let k = req.k;
  if (!k) {
    const g = await getCube(join(req.baseUrl, req.l10Path));
    k = {
      modis: fitK(g, S_SNPP, S_MODIS, ...req.fit.overlap),
      n20: fitK(g, S_SNPP, S_N20, ...req.fit.n20).map((x) => (Number.isFinite(x) ? x : 1)),
    };
  }
  const groups: DensityResult['groups'] = [];
  const masks = req.aoi ? getMasks(req.aoi) : null;
  if (!masks || masks.level === 10) {
    const g = await getCube(join(req.baseUrl, req.l10Path));
    groups.push({ tile: 'L10', ...densityFromCube(g, masks?.l10 ?? null, req.window, k, req.eras) });
    return { level: 10, groups, k, ms: performance.now() - start };
  }
  const have = new Set(req.manifestTiles);
  const tiles = masks.touched.filter((t) => have.has(t));
  const cubes = await Promise.all(tiles.map((t) => getCube(l01Url(req, t))));
  tiles.forEach((tile, i) => {
    const d = densityFromCube(cubes[i], masks.byTile.get(tile)!, req.window, k, req.eras);
    if (d.cells.length) groups.push({ tile, ...d });
  });
  return { level: 1, groups, k, ms: performance.now() - start };
}

async function points(req: Extract<WorkerRequest, { kind: 'points' }>): Promise<PointsResult> {
  const masks = getMasks(req.aoi);
  // same cell-centre membership as the calendar: a point counts if its cell is in the AOI mask
  const inside =
    masks.level === 10
      ? (lon: number, lat: number) => masks.l10![l10Cell(lat, lon)] === 1
      : (lon: number, lat: number) => masks.byTile.get(tile10(lat, lon))?.[l01Cell(lat, lon)] === 1;
  return collectPoints(
    req.paths.map((p) => join(req.baseUrl, p)),
    req.aoi.bbox,
    req.tA,
    req.tB,
    inside,
  );
}

function transferables(r: WorkerResult): Transferable[] {
  if ('perTile' in r) return r.perTile.map((a) => a.buffer);
  if ('groups' in r) return r.groups.flatMap((g) => [g.cells.buffer, g.values.buffer]);
  return [r.lon.buffer, r.lat.buffer, r.t.buffer, r.sensor.buffer, r.frp.buffer, r.conf.buffer];
}

self.onmessage = async (e: MessageEvent<WorkerRequest & { id: number }>) => {
  const req = e.data;
  try {
    const result = req.kind === 'aggregate' ? await aggregate(req) : req.kind === 'density' ? await density(req) : await points(req);
    const msg: WorkerResponse = { id: req.id, ok: true, result };
    (self as unknown as Worker).postMessage(msg, transferables(result));
  } catch (err) {
    const msg: WorkerResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
