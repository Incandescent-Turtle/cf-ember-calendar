import { describe, expect, it } from 'vitest';
import { paddedViewBbox, pointsEligible, tilesInView } from './hooks';
import type { Manifest } from './types';

describe('points gating (short windows or high zoom)', () => {
  const manifest = { points: { years: [2000, 2026], tiles: ['S30W070', 'S30W060', 'S40W070'] } } as Manifest;
  const near = { zoom: 9, bbox: [-68, -29.5, -67.5, -29] as [number, number, number, number] };
  const far = { zoom: 5, bbox: [-68, -29.5, -67.5, -29] as [number, number, number, number] };
  const aoi = { id: 'a', label: '', kind: 'circle' as const, feature: { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [] } } };
  it('needs a year; a month shows at any zoom; a year needs zoom ≥ 8', () => {
    expect(pointsEligible(aoi, { year: null, month: 6 }, manifest, near)).toMatch(/Pick a year/);
    expect(pointsEligible(aoi, { year: 2025, month: 6 }, manifest, far)).toBeNull();
    expect(pointsEligible(aoi, { year: 2025, month: null }, manifest, far)).toMatch(/Zoom in further/);
    expect(pointsEligible(aoi, { year: 2025, month: null }, manifest, near)).toBeNull();
    expect(pointsEligible(null, { year: 2025, month: null }, manifest, near)).toBeNull();
    expect(pointsEligible(aoi, { year: 1999, month: 6 }, manifest, near)).toMatch(/cover 2000/);
  });
  it('without an AOI, limits the number of tiles in view', () => {
    expect(pointsEligible(null, { year: 2025, month: 6 }, { points: { years: [2000, 2026], tiles: Array.from({ length: 36 }, (_, i) => `S${30 + 10 * Math.floor(i / 6)}W${String(60 + 10 * (i % 6)).padStart(3, '0')}`) } } as Manifest, { zoom: 3, bbox: [-130, -89, -50, -20] })).toMatch(/Zoom in/);
  });
});

describe('viewport helpers', () => {
  it('lists only tiles with data in view, clamped to the world', () => {
    const have = ['S30W070', 'S30W060', 'S40W070'];
    expect(tilesInView([-68, -29, -58, -21], have).sort()).toEqual(['S30W060', 'S30W070']);
    expect(tilesInView([-400, -100, 400, 100], have).length).toBe(3);
    expect(tilesInView([10, 10, 20, 20], have)).toEqual([]);
  });
  it('pads 20 % and snaps outward to 0.5°', () => {
    expect(paddedViewBbox([-68.2, -29.3, -67.2, -28.3])).toEqual([-68.5, -29.5, -67, -28]);
    expect(paddedViewBbox([-179.9, -89.9, 179.9, 89.9])).toEqual([-180, -90, 180, 90]);
  });
});
