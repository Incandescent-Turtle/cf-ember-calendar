// Hotspot points for the map (PRODUCT.md F4): points/<tile>/<year>.parquet (CONTRACTS.md), read with
// hyparquet (+ zstd). Row groups are skipped by their lat statistics (files are sorted by lat), so on a
// host with Range support only the needed byte ranges are fetched. Runs in the Worker.
import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects, type AsyncBuffer } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { Bbox } from '../lib/grid';

export const POINT_COLUMNS = ['lat', 'lon', 't_utc', 'sensor', 'frp', 'conf'] as const;
/** Max points sent to the map; above this we keep an even subsample and say so. */
export const MAX_MAP_POINTS = 50_000;

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
/** Row ranges of the row groups whose lat statistics overlap [s, n], and their compressed size. */
async function latRanges(file: AsyncBuffer, [, s, , n]: Bbox) {
  const md = await parquetMetadataAsync(file);
  const latIdx = md.row_groups[0]?.columns.findIndex((c) => c.meta_data?.path_in_schema[0] === 'lat') ?? -1;
  let start = 0;
  let bytes = 0;
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
      bytes += Number(rg.total_compressed_size ?? 0);
    }
    start += rows;
  }
  return { md, ranges, bytes };
}

export async function readPointsFile(file: AsyncBuffer, bbox: Bbox, columns: readonly string[] = POINT_COLUMNS): Promise<Row[]> {
  const { md, ranges } = await latRanges(file, bbox);
  const out: Row[] = [];
  for (const [rowStart, rowEnd] of ranges) {
    const rows = (await parquetReadObjects({
      file,
      metadata: md,
      columns: [...columns],
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

// ------------------------------------------------------------------ hotspot CSV export (F5)

/** CONTRACTS.md → Points file: every column, for the CSV export. */
export const ALL_POINT_COLUMNS = ['lat', 'lon', 't_utc', 'sensor', 'frp', 'daynight', 'conf', 'scan', 'track', 'bt_mir', 'bt_tir', 'type'] as const;
/** CONTRACTS.md → CSV export columns, in this order. */
export const HOTSPOT_CSV_COLUMNS =
  'latitude,longitude,acq_datetime_utc,sensor,instrument,frp_mw,daynight,confidence_class,scan_km,track_km,bt_mir_k,bt_tir_k,type';
/** PRODUCT.md F5 caps: above these, the export stops and points to FIRMS Archive Download. */
export const HOTSPOT_CAPS = { bytes: 200 * 1024 * 1024, rows: 3_000_000 };
export const FIRMS_ARCHIVE_URL = 'https://firms.modaps.eosdis.nasa.gov/download/';

const SENSORS: Record<number, [string, string]> = {
  1: ['MODIS_TERRA', 'MODIS'],
  2: ['MODIS_AQUA', 'MODIS'],
  3: ['VIIRS_SNPP', 'VIIRS'],
  4: ['VIIRS_NOAA20', 'VIIRS'],
  5: ['VIIRS_NOAA21', 'VIIRS'],
};
const CONF = ['low', 'nominal', 'high'];
const T2000 = Date.UTC(2000, 0, 1);

export interface FullRow extends Row {
  daynight: number;
  scan: number;
  track: number;
  bt_mir: number;
  bt_tir: number;
  type: number;
}

const fx = (v: number, d: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : '');

export function hotspotLine(r: FullRow): string {
  const [sensor, instrument] = SENSORS[r.sensor] ?? [String(r.sensor), ''];
  return [
    fx(r.lat, 5), fx(r.lon, 5), new Date(T2000 + r.t_utc * 60000).toISOString().replace('.000Z', 'Z'), sensor, instrument,
    fx(r.frp, 2), r.daynight === 0 ? 'D' : r.daynight === 1 ? 'N' : '', CONF[r.conf] ?? '',
    fx(r.scan, 2), fx(r.track, 2), fx(r.bt_mir, 2), fx(r.bt_tir, 2), r.type === 255 || r.type === undefined ? '' : String(r.type),
  ].join(',');
}

export interface HotspotCsvResult {
  /** null when a cap was hit (nothing to download) */
  blob: Blob | null;
  rows: number;
  files: number;
  missing: number;
  /** compressed bytes of the row groups that had to be read */
  bytes: number;
  capped: 'bytes' | 'rows' | null;
  ms: number;
}

/**
 * Cleaned detections in [tA, tB) minutes accepted by `inside`, as CSV (CONTRACTS column order), in time
 * order. Pass 1 reads only Parquet footers and stops if the row groups to fetch exceed the byte cap;
 * pass 2 reads them, one year at a time, and stops at the row cap.
 */
export async function hotspotCsv(
  urls: string[],
  bbox: Bbox,
  tA: number,
  tB: number,
  inside: (lon: number, lat: number) => boolean,
  open: (url: string) => Promise<AsyncBuffer> = openUrl,
  caps = HOTSPOT_CAPS,
): Promise<HotspotCsvResult> {
  const start = performance.now();
  const files: { url: string; file: AsyncBuffer }[] = [];
  let missing = 0;
  let bytes = 0;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const file = await open(url);
        bytes += (await latRanges(file, bbox)).bytes;
        files.push({ url, file });
      } catch {
        missing++;
      }
    }),
  );
  const done = (r: Partial<HotspotCsvResult>): HotspotCsvResult => ({
    blob: null, rows: 0, files: files.length, missing, bytes, capped: null, ms: performance.now() - start, ...r,
  });
  if (bytes > caps.bytes) return done({ capped: 'bytes' });
  const year = (u: string) => Number(/(\d{4})\.parquet$/.exec(u)?.[1] ?? 0);
  const years = [...new Set(files.map((f) => year(f.url)))].sort((a, b) => a - b);
  const chunks: string[] = [HOTSPOT_CSV_COLUMNS + '\n'];
  let rows = 0;
  for (const y of years) {
    const kept: FullRow[] = [];
    for (const f of files.filter((x) => year(x.url) === y)) {
      const got = (await readPointsFile(f.file, bbox, ALL_POINT_COLUMNS)) as FullRow[];
      for (const r of got) if (r.t_utc >= tA && r.t_utc < tB && inside(r.lon, r.lat)) kept.push(r);
      if (rows + kept.length > caps.rows) return done({ rows: rows + kept.length, capped: 'rows' });
    }
    kept.sort((a, b) => a.t_utc - b.t_utc || a.lat - b.lat || a.lon - b.lon);
    for (let i = 0; i < kept.length; i += 20_000) chunks.push(kept.slice(i, i + 20_000).map(hotspotLine).join('\n') + '\n');
    rows += kept.length;
  }
  return done({ blob: new Blob(chunks, { type: 'text/csv' }), rows });
}
