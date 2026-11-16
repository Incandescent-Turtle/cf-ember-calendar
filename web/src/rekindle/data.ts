// Rekindle static files (CONTRACTS.md → "Rekindle files"), shipped with the SPA under /rekindle/.
import { contours } from 'd3-contour';
import { gunzipSync } from 'fflate';
import type { Feature, FeatureCollection, MultiPolygon, Point } from 'geojson';

export const NOT_REACHED = 65535;
// Dev only: ?rkbase=<dir under public/> loads a test export (used for the what-if UI check).
const devBase = import.meta.env.DEV ? new URLSearchParams(location.search).get('rkbase') : null;
const BASE = `${(import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')}/${devBase ?? 'rekindle'}`;

export interface FireRef {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  status?: Status;
  /** UI: not in the fire picker (still in the findings). */
  hidden?: boolean;
  /** UI: false = no whole-fire hindcast view; the fire opens on its what-if view. */
  whole_fire?: boolean;
}
export type Status = 'validated' | 'poor_agreement' | 'uncalibrated' | 'shape_validated' | 'shape_poor';

export interface Credit {
  id: string;
  short: string;
  use: string;
  citation: string;
  doi?: string;
  url: string;
  access?: string;
}

export interface RunMetrics {
  median_timing_error_h?: number | null;
  iqr_h?: [number | null, number | null] | null;
  median_abs_timing_error_h?: number | null;
  hit_rate?: number | null;
  consistent_rate?: number | null;
  sorensen?: number;
  false_alarm_km2?: number;
  observed_footprint_km2?: number;
  n_pixels?: number;
  area_km2: number;
}

export interface Run {
  key: string;
  file: string;
  wind_ms: number;
  wind_from_deg: number;
  dead_moisture_pct: number;
  observed_weather?: boolean;
  burned_km2_by_hour: number[];
  metrics: RunMetrics;
}

export interface FireMeta {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  raster: { crs: 'EPSG:3857'; width: number; height: number; bounds_3857: [number, number, number, number]; bounds_lonlat: [number, number, number, number]; dx_m: number };
  status: Status;
  start: string;
  end: string;
  ignitions: { lon: number; lat: number; t: string }[];
  baseline: {
    wind_ms: number;
    wind_from_deg: number;
    dead_moisture_pct: number;
    ros_multiplier: number;
    wind_source: string;
    wind_hourly: { t: string; speed_ms: number; from_deg: number }[];
  };
  axes: { wind_ms: number[]; wind_from_deg: number[]; dead_moisture_pct: number[] } | null;
  validation: {
    gate: { rule: string; threshold_h: number; passed: boolean; overpass_median_gap_h: number };
    metrics: RunMetrics;
    sweep: { ros_multiplier: number; median_abs_timing_error_h: number | null; hit_rate: number | null; sorensen: number }[];
    calibrated_not_blind: string;
    calibration_objective?: string;
    moisture_estimate: { method: string; rh_pct_median: number; emc_pct_median: number };
  };
  model_settings?: { nonveg_max_pct: number | null; diurnal_moisture: boolean; wind?: string; seed_h?: number };
  moisture?: {
    baseline: 'constant' | 'hourly';
    dead_1h_pct?: number;
    method?: string;
    dead_1h_pct_min?: number;
    dead_1h_pct_median?: number;
    dead_1h_pct_max?: number;
  };
  spread_profile?: SpreadProfile;
  notes: string;
  prep_notes: string[];
  credits: Credit[];
}

export interface SpreadProfile {
  observed: { t_h: number; max_km: number; median_km: number; n: number }[];
  model_km_by_hour: number[];
  definition: string;
}

export interface ObservedProps {
  t: string;
  sensor: string;
  frp: number;
  scan: number;
  track: number;
}

/** One 24 h window at its own best multiplier, with the S6c qualification verdict. */
export interface BurstWindowEval {
  index: number;
  t_k_h: number;
  ros_multiplier: number;
  median_abs_timing_error_h: number | null;
  median_timing_error_h: number | null;
  sorensen: number;
  n_pixels: number;
  hit_rate: number | null;
  area_km2: number;
  observed_footprint_km2: number;
  qualifies: boolean;
  reasons: string[];
  /** Why a window carries what-ifs: S6c timing rule, or S6f shape-only (post-hoc). */
  basis?: 'timing' | 'shape';
}

export interface BurstRun {
  key: string;
  file: string;
  wind_scale: number;
  dead_delta_pct: number;
  burned_km2_by_hour: number[];
  start_km2: number;
  end_km2: number;
  new_km2: number;
  new_km2_vs_baseline: number;
  new_ratio_vs_baseline: number | null;
  /** Footprint what-ifs: the fire reached the domain edge, so the area is a lower bound. */
  domain_limited?: boolean;
}

export interface BurstWindow extends BurstWindowEval {
  start: string;
  start_h_after_t0: number;
  hours: number;
  n_ignitions: number;
  rothermel: {
    fuel_model: number;
    wind_10m_ms_median: number;
    dead_1h_pct_median: number;
    rows: { wind_scale: number; dead_delta_pct: number; head_kmh: number; ratio: number | null }[];
  };
  baseline_rerun_check: { median_abs_timing_error_h: number; sorensen: number };
  runs: BurstRun[];
}

/** S6c burst-window what-ifs (EXPLORATORY, post-hoc): <fire>/burst/index.json from rekindle.burst. */
export interface BurstIndex {
  fire: string;
  EXPLORATORY: true;
  post_hoc: true;
  what: string;
  rule: string;
  shape_rule?: string;
  gate_h: number;
  axes: { wind_scale: number[]; dead_delta_pct: number[]; dead_floor_pct: number };
  all_windows: BurstWindowEval[];
  windows: BurstWindow[];
  /** S6d whole-fire footprint what-ifs (rekindle.shape_whatif): timing failed, shape matches. */
  shape?: ShapeWhatIf;
}

export interface ShapeWhatIf extends BurstWindow {
  kind: 'whole_fire_shape';
  what: string;
  gate_h: number;
  dead_1h_pct_baseline: number;
  domain_burnable_km2?: number;
  axes: { wind_scale: number[]; dead_delta_pct: number[]; dead_floor_pct: number };
}

export const burstKey = (i: number, scale: number, dpp: number) =>
  `w${i}_u${String(Math.round(scale * 100)).padStart(3, '0')}_d${dpp < 0 ? 'm' : 'p'}${Math.abs(dpp)}`;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const fetchFires = () => getJson<{ fires: FireRef[] }>('index.json');
export const fetchMeta = (id: string) => getJson<FireMeta>(`${id}/meta.json`);
export const fetchRuns = (id: string) => getJson<{ runs: Run[] }>(`${id}/runs/index.json`);
/** S6h second reference: MCD64A1 burned area vs hotspots vs model (rekindle.burned_area). */
export interface Reference {
  fire: string;
  mcd64_km2: number;
  hotspot_footprint_km2: number;
  model_km2: number;
  sorensen_hotspots_vs_mcd64: number;
  sorensen_model_vs_mcd64: number;
  sorensen_model_vs_hotspots: number;
  timing_vs_hotspots: { median_abs_h: number; censored_median_h: number; inside_interval: number; gate_h: number };
  detection_minus_burn_day: { n: number; median: number | null; within_1_day: number | null };
  model_minus_burn_day: { n: number; median: number | null; median_abs: number | null; within_1_day: number | null };
}

/** Optional per-fire file; null if absent. */
export async function fetchReference(id: string): Promise<Reference | null> {
  const r = await fetch(`${BASE}/${id}/reference.json`);
  if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
  return (await r.json()) as Reference;
}

/** Burst-window what-ifs; null when the fire has none exported (older exports). */
export async function fetchBurst(id: string): Promise<BurstIndex | null> {
  const r = await fetch(`${BASE}/${id}/burst/index.json`);
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) return null; // SPA fallback page, not the file
  return (await r.json()) as BurstIndex;
}
export const fetchObserved =(id: string) => getJson<FeatureCollection<Point, ObservedProps>>(`${id}/observed.geojson`);

/** Fetch a run raster → minutes after first ignition (65535 = not reached). */
export async function fetchRaster(id: string, file: string, size: number): Promise<Uint16Array> {
  const r = await fetch(`${BASE}/${id}/${file}`);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return decodeRaster(new Uint8Array(await r.arrayBuffer()), size);
}

/** gunzip (unless the host already decoded it) and read little-endian uint16. */
export function decodeRaster(bytes: Uint8Array, size: number): Uint16Array {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  if (raw.byteLength !== size * 2) throw new Error(`raster has ${raw.byteLength} bytes, expected ${size * 2}`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Uint16Array(size);
  for (let i = 0; i < size; i++) out[i] = dv.getUint16(2 * i, true);
  return out;
}

export const runKey = (ws: number, wd: number, m: number) =>
  `ws${String(ws).padStart(2, '0')}_wd${String(wd).padStart(3, '0')}_m${String(m).padStart(2, '0')}`;

/** Nearest axis value (sliders snap to the precomputed grid). */
export const snap = (axis: number[], v: number) => axis.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), axis[0]);

// Arrival-time ramp: matplotlib "inferno", truncated to 0.10–0.88 so the late end stays visible on a
// light basemap. Perceptually uniform with monotonic lightness, so it reads under CVD (rampLightness test).
export const RAMP: [number, number, number][] = [
  [22, 11, 57], [66, 10, 104], [106, 23, 110], [147, 38, 103], [188, 55, 84], [221, 81, 58], [243, 118, 27], [252, 165, 10],
];

export function rampColor(f: number): [number, number, number] {
  const x = Math.min(Math.max(f, 0), 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const u = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + u * (b[k] - a[k]))) as [number, number, number];
}

export const rampCss = () => `linear-gradient(to right, ${RAMP.map((c) => `rgb(${c.join(',')})`).join(', ')})`;

/** RGBA pixels: cells reached by tMin coloured by arrival / maxMin; the rest transparent. */
export function renderRgba(minutes: Uint16Array, tMin: number, maxMin: number, alpha = 220): Uint8ClampedArray {
  const px = new Uint8ClampedArray(minutes.length * 4);
  const lut: [number, number, number][] = Array.from({ length: 256 }, (_, i) => rampColor(i / 255));
  for (let i = 0; i < minutes.length; i++) {
    const v = minutes[i];
    if (v === NOT_REACHED || v > tMin) continue;
    const c = lut[Math.min(255, Math.round((v / maxMin) * 255))];
    px[4 * i] = c[0];
    px[4 * i + 1] = c[1];
    px[4 * i + 2] = c[2];
    px[4 * i + 3] = alpha;
  }
  return px;
}

const R = 6378137;
const toLon = (x: number) => (x / R) * (180 / Math.PI);
const toLat = (y: number) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

/** Burned-by-t outlines (isochrones), in lon/lat. One feature per threshold (minutes). */
export function isochrones(minutes: Uint16Array, raster: FireMeta['raster'], thresholdsMin: number[]): FeatureCollection<MultiPolygon, { t_min: number }> {
  const { width: w, height: h, bounds_3857: [x0, y0, x1, y1] } = raster;
  const vals = new Float64Array(minutes.length);
  for (let i = 0; i < minutes.length; i++) vals[i] = minutes[i] === NOT_REACHED ? -1e9 : -minutes[i];
  const gen = contours().size([w, h]).smooth(false).thresholds(thresholdsMin.map((t) => -t));
  const sx = (x1 - x0) / w;
  const sy = (y1 - y0) / h;
  const features: Feature<MultiPolygon, { t_min: number }>[] = gen(Array.from(vals)).map((c) => ({
    type: 'Feature',
    properties: { t_min: -c.value },
    geometry: {
      type: 'MultiPolygon',
      coordinates: c.coordinates.map((poly) => poly.map((ring) => ring.map(([px, py]) => [toLon(x0 + px * sx), toLat(y1 - py * sy)]))),
    },
  }));
  features.sort((a, b) => a.properties.t_min - b.properties.t_min);
  return { type: 'FeatureCollection', features };
}

/** Hours since the first ignition. */
export const hoursSince = (t0: string, t: string) => (Date.parse(t) - Date.parse(t0)) / 3.6e6;

export function fmtUtc(t0: string, h: number): string {
  const d = new Date(Date.parse(t0) + h * 3.6e6);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${mon} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** Observed hourly wind nearest to hour h (baseline only). */
export function windAt(meta: FireMeta, h: number) {
  const t = Date.parse(meta.start) + h * 3.6e6;
  let best = meta.baseline.wind_hourly[0];
  for (const w of meta.baseline.wind_hourly) if (Math.abs(Date.parse(w.t) - t) < Math.abs(Date.parse(best.t) - t)) best = w;
  return best;
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
