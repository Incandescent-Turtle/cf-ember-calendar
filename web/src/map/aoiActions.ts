import { circle } from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { newAoiId, useStore } from '../store';

export const HERO = { lon: -67.7, lat: -29.15, radiusKm: 25, label: 'Chilecito, Argentina (25 km)' };

export function setCircleAoi(lon: number, lat: number, radiusKm: number, label: string, kind: 'circle' | 'preset' = 'circle') {
  useStore.getState().setAoi({
    id: newAoiId(),
    kind,
    label,
    feature: circle([lon, lat], radiusKm, { steps: 96, units: 'kilometers' }) as Feature<Polygon>,
  });
}
