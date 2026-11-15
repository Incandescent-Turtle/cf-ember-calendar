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
