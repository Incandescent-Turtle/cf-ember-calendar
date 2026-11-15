import { describe, expect, it } from 'vitest';
import { paddedViewBbox, tilesInView } from './hooks';

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
