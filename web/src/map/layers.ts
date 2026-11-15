// GeoJSON + style helpers for the map's density and hotspot layers.
import type { FeatureCollection, Point, Polygon } from 'geojson';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { DensityResult } from '../data/cube.worker';
import type { PointsResult } from '../data/points';
import { tileBounds } from '../lib/grid';
import { RAMP } from '../calendar/option';
import { MONTHS_LONG } from '../lib/time';

const log = (v: number) => Math.log10(1 + v);

export interface DensityLayerData {
  fc: FeatureCollection<Polygon, { v: number; lv: number }>;
  vmin: number;
  vmax: number;
  nCells: number;
  total: number;
}

/** Cells → square polygons with v (FCD) and lv (log10(1+v)). Colour range = P2…max of lv. */
export function densityGeoJson(d: DensityResult): DensityLayerData {
  const features: DensityLayerData['fc']['features'] = [];
  const lvs: number[] = [];
  let total = 0;
  for (const g of d.groups) {
    const size = d.level === 1 ? 0.1 : 1;
    const [tw, ts] = d.level === 1 ? tileBounds(g.tile) : [0, 0];
    for (let i = 0; i < g.cells.length; i++) {
      const c = g.cells[i];
      const v = g.values[i];
      const [w, s] =
        d.level === 1
          ? [tw + (c % 100) / 10, ts + Math.floor(c / 100) / 10]
          : [(c % 360) - 180, Math.floor(c / 360) - 90];
      const e = w + size;
      const n = s + size;
      const lv = log(v);
      lvs.push(lv);
      total += v;
      features.push({
        type: 'Feature',
        properties: { v, lv },
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      });
    }
  }
  lvs.sort((a, b) => a - b);
  const vmax = Math.max(lvs[lvs.length - 1] ?? 1, 0.5);
  const vmin = Math.min(lvs[Math.floor(lvs.length * 0.02)] ?? 0, vmax - 0.3);
  return { fc: { type: 'FeatureCollection', features }, vmin, vmax, nCells: features.length, total };
}

/** fill-color expression: RAMP spread linearly over [vmin, vmax] in log space. */
export function rampExpression(vmin: number, vmax: number): ExpressionSpecification {
  const stops: (number | string)[] = [];
  RAMP.forEach((col, i) => stops.push(vmin + ((vmax - vmin) * i) / (RAMP.length - 1), col));
  return ['interpolate', ['linear'], ['get', 'lv'], ...stops] as unknown as ExpressionSpecification;
}

/** Sensor groups and Okabe–Ito colours (CVD-safe categorical). */
export const SENSOR_GROUPS = [
  { id: 0, label: 'MODIS (Terra/Aqua)', color: '#0072B2' },
  { id: 1, label: 'VIIRS S-NPP', color: '#1a1a1a' },
  { id: 2, label: 'VIIRS NOAA-20/21', color: '#009E73' },
] as const;
/** CONTRACTS.md points.sensor: 1 Terra, 2 Aqua, 3 S-NPP, 4 NOAA-20, 5 NOAA-21. */
export const sensorGroup = (s: number) => (s <= 2 ? 0 : s === 3 ? 1 : 2);
export const SENSOR_NAME: Record<number, string> = {
  1: 'MODIS Terra',
  2: 'MODIS Aqua',
  3: 'VIIRS S-NPP',
  4: 'VIIRS NOAA-20',
  5: 'VIIRS NOAA-21',
};
export const CONF_NAME: Record<number, string> = { 0: 'low', 1: 'nominal', 2: 'high' };

export function pointsGeoJson(p: PointsResult): FeatureCollection<Point, { g: number; s: number; frp: number; t: number; conf: number }> {
  const features = new Array(p.lon.length);
  for (let i = 0; i < p.lon.length; i++)
    features[i] = {
      type: 'Feature',
      properties: { g: sensorGroup(p.sensor[i]), s: p.sensor[i], frp: p.frp[i], t: p.t[i], conf: p.conf[i] },
      geometry: { type: 'Point', coordinates: [p.lon[i], p.lat[i]] },
    };
  return { type: 'FeatureCollection', features };
}

export const sensorColorExpression = [
  'match',
  ['get', 'g'],
  ...SENSOR_GROUPS.flatMap((g) => [g.id, g.color]),
  '#666666',
] as unknown as ExpressionSpecification;

/** "2025-07-28 14:35 UTC" from minutes since 2000-01-01. */
export const fmtMinutes = (min: number) => new Date(Date.UTC(2000, 0, 1) + min * 60000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function windowLabel(w: { year: number | null; month: number | null }) {
  if (w.year === null && w.month === null) return 'all years';
  if (w.year === null) return `every ${MONTHS_LONG[w.month!]}`;
  if (w.month === null) return String(w.year);
  return `${MONTHS_LONG[w.month]} ${w.year}`;
}
