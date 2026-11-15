// S7 colour checks: calendar ramp (= map density ramp), zero colour, sensor colours, seam lines,
// under normal vision and simulated protan / deutan / tritan (lib/cvd.ts).
import { describe, expect, it } from 'vitest';
import { NODATA_COLOR, RAMP, ZERO_COLOR } from '../calendar/option';
import { SENSOR_GROUPS } from '../map/layers';
import { SEAM_COLORS } from '../methodology/summary';
import { deltaE, hex, lab, VISIONS } from './cvd';

describe('CVD: colour ramps and categorical colours', () => {
  it('calendar / map density ramp gets monotonically darker under every vision', () => {
    for (const v of VISIONS) {
      const L = RAMP.map((c) => lab(hex(c), v)[0]);
      for (let i = 1; i < L.length; i++) expect(L[i], `${v} stop ${i}`).toBeLessThan(L[i - 1]);
      expect(L[0] - L[L.length - 1], `${v} lightness range`).toBeGreaterThan(55);
    }
  });

  it('neighbouring ramp classes stay distinguishable (ΔE ≥ 5) under every vision', () => {
    for (const v of VISIONS)
      for (let i = 1; i < RAMP.length; i++) expect(deltaE(hex(RAMP[i - 1]), hex(RAMP[i]), v), `${v} ${i}`).toBeGreaterThan(5);
  });

  it('zero colour and no-data colour differ from the lowest ramp class', () => {
    for (const v of VISIONS) {
      expect(deltaE(hex(ZERO_COLOR), hex(RAMP[0]), v), `${v} zero vs low`).toBeGreaterThan(8);
      expect(deltaE(hex(ZERO_COLOR), hex(NODATA_COLOR), v), `${v} zero vs no data`).toBeGreaterThan(8);
    }
  });

  it('sensor colours (map points) are pairwise distinct under every vision', () => {
    const cols = SENSOR_GROUPS.map((g) => hex(g.color));
    for (const v of VISIONS)
      for (let i = 0; i < cols.length; i++)
        for (let j = i + 1; j < cols.length; j++) expect(deltaE(cols[i], cols[j], v), `${v} ${i}/${j}`).toBeGreaterThan(20);
  });

  it('seam chart lines are pairwise distinct under every vision', () => {
    const cols = [SEAM_COLORS.modis, SEAM_COLORS.viirs, SEAM_COLORS.harmonized].map(hex);
    for (const v of VISIONS)
      for (let i = 0; i < cols.length; i++)
        for (let j = i + 1; j < cols.length; j++) expect(deltaE(cols[i], cols[j], v), `${v} ${i}/${j}`).toBeGreaterThan(20);
  });
});
