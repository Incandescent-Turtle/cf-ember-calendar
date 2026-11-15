import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeRaster, isochrones, luminance, NOT_REACHED, RAMP, rampColor, renderRgba, runKey, snap } from './data';
import type { FireMeta } from './data';

const raster: FireMeta['raster'] = { crs: 'EPSG:3857', width: 4, height: 3, bounds_3857: [0, 0, 400, 300], bounds_lonlat: [0, 0, 0, 0], dx_m: 100 };

describe('rekindle data', () => {
  it('decodes gzip little-endian uint16, north-up', () => {
    const v = new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, NOT_REACHED]);
    const bytes = new Uint8Array(v.length * 2);
    v.forEach((x, i) => {
      bytes[2 * i] = x & 0xff;
      bytes[2 * i + 1] = x >> 8;
    });
    expect(Array.from(decodeRaster(gzipSync(bytes), 12))).toEqual(Array.from(v));
    expect(() => decodeRaster(gzipSync(bytes), 13)).toThrow();
  });

  it('builds contract run keys and snaps to the axes', () => {
    expect(runKey(9, 270, 6)).toBe('ws09_wd270_m06');
    expect(runKey(0, 0, 14)).toBe('ws00_wd000_m14');
    expect(snap([0, 3, 6, 9, 12, 15], 7.4)).toBe(6);
    expect(snap([0, 45, 90], 80)).toBe(90);
  });

  it('renders only cells reached by t', () => {
    const px = renderRgba(new Uint16Array([0, 30, 90, NOT_REACHED]), 60, 120);
    expect([px[3], px[7], px[11], px[15]]).toEqual([220, 220, 0, 0]);
  });

  it('isochrone encloses the cells burned by t', () => {
    const m = new Uint16Array(12).fill(NOT_REACHED);
    m[5] = 10; // row 1, col 1
    m[6] = 50;
    const fc = isochrones(m, raster, [20, 60]);
    expect(fc.features.map((f) => f.properties.t_min)).toEqual([20, 60]);
    const ring20 = fc.features[0].geometry.coordinates[0][0];
    const lons = ring20.map((p) => p[0]);
    // 1 cell burned at t = 20 → polygon spans about one cell (100 m) in x
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(0);
    const ring60 = fc.features[1].geometry.coordinates[0][0];
    const w60 = Math.max(...ring60.map((p) => p[0])) - Math.min(...ring60.map((p) => p[0]));
    expect(w60).toBeGreaterThan(Math.max(...lons) - Math.min(...lons));
  });

  // CVD check: the ramp must stay ordered in lightness under protan/deutan/tritan simulation
  // (Machado, Oliveira & Fernandes 2009, severity 1.0, applied in linear RGB).
  it('arrival ramp lightness is monotonic for normal vision and simulated CVD', () => {
    const M: Record<string, number[][]> = {
      normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
      deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
      tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
    };
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const enc = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(l, 0) ** (1 / 2.4) - 0.055);
    const stops = Array.from({ length: 21 }, (_, i) => rampColor(i / 20));
    expect(RAMP.length).toBeGreaterThan(4);
    for (const [name, m] of Object.entries(M)) {
      const L = stops.map((c) => {
        const l = c.map(lin);
        const s = m.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
        return luminance(s.map(enc) as [number, number, number]);
      });
      for (let i = 1; i < L.length; i++) expect(L[i], `${name} stop ${i}`).toBeGreaterThan(L[i - 1]);
      expect(L[L.length - 1] / Math.max(L[0], 1e-3), name).toBeGreaterThan(4);
    }
  });
});
