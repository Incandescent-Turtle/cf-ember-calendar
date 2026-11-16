import { circle } from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { newAoiId, useStore } from '../store';

/** 50 km, not 25: at 25 km 69 % of baseline months have no activity and most monthly medians are 0
 * (fixture), so the At-a-glance statistics have nothing to work with. At 50 km every month has activity
 * and July 2026 is still ~17× a typical July. */
export const HERO = { lon: -67.7, lat: -29.15, radiusKm: 50, label: 'Chilecito, Argentina (50 km)' };

export function setCircleAoi(lon: number, lat: number, radiusKm: number, label: string, kind: 'circle' | 'preset' = 'circle') {
  useStore.getState().setAoi({
    id: newAoiId(),
    kind,
    label,
    feature: circle([lon, lat], radiusKm, { steps: 96, units: 'kilometers' }) as Feature<Polygon>,
  });
}

/** Ready-made examples (empty state + toolbar menu). month is 0-based; the calendar and map jump to it. */
export interface Example {
  id: string;
  label: string;
  note: string;
  lon: number;
  lat: number;
  radiusKm: number;
  year?: number;
  month?: number;
}

export const EXAMPLES: Example[] = [
  { id: 'chilecito', label: 'Chilecito, Argentina (Jul 2026)', note: 'the challenge video’s fire; also in Rekindle', lon: HERO.lon, lat: HERO.lat, radiusKm: HERO.radiusKm, year: 2026, month: 6 },
  { id: 'cordoba', label: 'Córdoba sierras, Argentina (Sep 2024)', note: 'spring fire season in the hills; in Rekindle', lon: -65.385, lat: -31.325, radiusKm: 50, year: 2024, month: 8 },
  { id: 'sask', label: 'Northern Saskatchewan, Canada (May 2023)', note: 'boreal spring fires; in Rekindle', lon: -105.882, lat: 56.102, radiusKm: 60, year: 2023, month: 4 },
  { id: 'bc', label: 'Central British Columbia, Canada (Aug 2024)', note: 'summer forest fires; in Rekindle', lon: -125.908, lat: 53.352, radiusKm: 60, year: 2024, month: 7 },
  { id: 'nsw', label: 'NSW south coast, Australia (Dec 2019)', note: 'the Black Summer fires', lon: 150.0, lat: -35.6, radiusKm: 100, year: 2019, month: 11 },
  { id: 'rondonia', label: 'Rondônia, Brazilian Amazon', note: 'a yearly farming and clearing burn season', lon: -63.0, lat: -10.5, radiusKm: 150 },
];

export function selectExample(ex: Example) {
  setCircleAoi(ex.lon, ex.lat, ex.radiusKm, ex.label, 'preset');
  useStore.getState().setWindow(ex.year !== undefined && ex.month !== undefined ? { year: ex.year, month: ex.month } : { year: null, month: null });
}
