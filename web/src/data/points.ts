// Hotspot points for the map (PRODUCT.md F4): points/<tile>/<year>.parquet (CONTRACTS.md), read with
// hyparquet (+ zstd). Row groups are skipped by their lat statistics (files are sorted by lat), so on a
// host with Range support only the needed byte ranges are fetched. Runs in the Worker.
import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects, type AsyncBuffer } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { Bbox } from '../lib/grid';

export const POINT_COLUMNS = ['lat', 'lon', 't_utc', 'sensor', 'frp', 'conf'] as const;
/** Max points sent to the map; above this we keep an even subsample and say so. */
export const MAX_MAP_POINTS = 150_000;

export interface PointsResult {
  lon: Float32Array;
  lat: Float32Array;
  t: Int32Array; // minutes since 2000-01-01T00:00Z
  sensor: Uint8Array;
  frp: Float32Array;
  conf: Uint8Array;
  /** points matching window + AOI before subsampling */
  total: number;
  files: number;
  missing: number;
  ms: number;
}

interface Row {
  lat: number;
  lon: number;
  t_utc: number;
  sensor: number;
  frp: number;
  conf: number;
}

/** Minutes since 2000-01-01 of a UTC date. */
export const minutesSince2000 = (y: number, m0: number, d = 1) => (Date.UTC(y, m0, d) - Date.UTC(2000, 0, 1)) / 60000;

/** Read rows of one file whose lat is within [s, n], using row-group statistics to skip the rest. */
export async function readPointsFile(file: AsyncBuffer, [, s, , n]: Bbox): Promise<Row[]> {
  const md = await parquetMetadataAsync(file);
  const latIdx = md.row_groups[0]?.columns.findIndex((c) => c.meta_data?.path_in_schema[0] === 'lat') ?? -1;
  let start = 0;
  const ranges: [number, number][] = [];
  for (const rg of md.row_groups) {
    const rows = Number(rg.num_rows);
    const st = latIdx >= 0 ? rg.columns[latIdx].meta_data?.statistics : undefined;
    const lo = Number(st?.min_value ?? -Infinity);
    const hi = Number(st?.max_value ?? Infinity);
    if (hi >= s && lo <= n) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === start) last[1] = start + rows;
      else ranges.push([start, start + rows]);
    }
    start += rows;
  }
  const out: Row[] = [];
  for (const [rowStart, rowEnd] of ranges) {
    const rows = (await parquetReadObjects({
      file,
      metadata: md,
      columns: [...POINT_COLUMNS],
      compressors,
      rowStart,
      rowEnd,
    })) as unknown as Row[];
    for (const r of rows) out.push(r);
  }
  return out;
}

export async function openUrl(url: string): Promise<AsyncBuffer> {
  return cachedAsyncBuffer(await asyncBufferFromUrl({ url }));
}

/**
 * Collect points from files, keep those in [tA, tB) minutes and accepted by `inside(lon, lat)`,
 * subsample evenly to MAX_MAP_POINTS.
 */
export async function collectPoints(
  urls: string[],
  bbox: Bbox,
  tA: number,
  tB: number,
  inside: (lon: number, lat: number) => boolean,
  open: (url: string) => Promise<AsyncBuffer> = openUrl,
): Promise<PointsResult> {
  const start = performance.now();
  const kept: Row[] = [];
  let missing = 0;
  await Promise.all(
    urls.map(async (url) => {
      let rows: Row[];
      try {
        rows = await readPointsFile(await open(url), bbox);
      } catch {
        missing++;
        return;
      }
      for (const r of rows) if (r.t_utc >= tA && r.t_utc < tB && inside(r.lon, r.lat)) kept.push(r);
    }),
  );
  const total = kept.length;
  const step = total > MAX_MAP_POINTS ? total / MAX_MAP_POINTS : 1;
  const n = Math.min(total, MAX_MAP_POINTS);
  const res: PointsResult = {
    lon: new Float32Array(n),
    lat: new Float32Array(n),
    t: new Int32Array(n),
    sensor: new Uint8Array(n),
    frp: new Float32Array(n),
    conf: new Uint8Array(n),
    total,
    files: urls.length - missing,
    missing,
    ms: 0,
  };
  for (let i = 0; i < n; i++) {
    const r = kept[Math.floor(i * step)];
    res.lon[i] = r.lon;
    res.lat[i] = r.lat;
    res.t[i] = r.t_utc;
    res.sensor[i] = r.sensor;
    res.frp[i] = r.frp;
    res.conf[i] = r.conf;
  }
  res.ms = performance.now() - start;
  return res;
}
