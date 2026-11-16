import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { bbox as turfBbox } from '@turf/turf';
import { useMemo } from 'react';
import { aggregateInWorker, densityInWorker, fetchCalibration, fetchManifest, pointsInWorker } from './client';
import { pickLevel, tilesForGeometry } from './aggregate';
import { harmonize, N20_FIT, SWITCH_DATE, type Harmonized } from '../lib/harmonize';
import { dekadIndex } from '../lib/time';
import type { Aoi } from '../store';
import { tilesForBbox, type Bbox } from '../lib/grid';
import type { AoiSeries, Calibration, Manifest } from './types';
import type { AoiRef } from './cube.worker';
import type { KPair, TimeWindow } from './density';
import { minutesSince2000 } from './points';

export const useManifest = () => useQuery({ queryKey: ['manifest'], queryFn: fetchManifest, staleTime: Infinity });
export const useCalibration = () =>
  useQuery({ queryKey: ['calibration'], queryFn: fetchCalibration, staleTime: Infinity });

export interface CalendarData {
  series: AoiSeries;
  harmonized: Harmonized;
  manifest: Manifest;
  calibration: Calibration | null;
}

/** Geometry + bbox + resolution level the Worker needs for an AOI (memoized per AOI). */
export function useAoiRef(aoi: Aoi | null): AoiRef | null {
  return useMemo(
    () =>
      aoi
        ? { id: aoi.id, geometry: aoi.feature.geometry, bbox: turfBbox(aoi.feature) as Bbox, level: pickLevel(aoi.feature.geometry) }
        : null,
    [aoi],
  );
}

export function useCalendarData(aoi: Aoi | null) {
  const manifest = useManifest();
  const calibration = useCalibration();
  const ref = useAoiRef(aoi);
  const series = useQuery({
    queryKey: ['aoi-series', ref?.id],
    enabled: !!ref && !!manifest.data,
    staleTime: Infinity,
    placeholderData: keepPreviousData, // keep the last calendar on screen while the next AOI loads
    queryFn: () => {
      const m = manifest.data!;
      const [t0, t1] = m.dekad_range;
      return aggregateInWorker({ kind: 'aggregate', aoi: ref!, manifestTiles: m.tiles, l10Path: m.l10, t0, nT: t1 - t0 + 1 });
    },
  });
  const data = useMemo<CalendarData | null>(() => {
    if (!series.data || !manifest.data || calibration.isLoading) return null;
    const cal = calibration.data ?? null;
    return { series: series.data, harmonized: harmonize(series.data, manifest.data, cal), manifest: manifest.data, calibration: cal };
  }, [series.data, manifest.data, calibration.data, calibration.isLoading]);
  return {
    data,
    isLoading: series.isFetching || manifest.isLoading,
    isStale: series.isPlaceholderData,
    error: (manifest.error ?? series.error) as Error | null,
  };
}

const kKey = (k: KPair | null) => (k ? [...k.modis, ...k.n20].map((x) => x.toFixed(4)).join(',') : 'fit');

/** Current map viewport (updated on moveend). */
export interface MapViewport {
  zoom: number;
  bbox: Bbox;
}

/** World view switches from the 1° cube to 0.1° tiles at this zoom, if ≤ MAX_VIEW_TILES tiles with data are in view. */
export const L01_MIN_ZOOM = 4;
export const MAX_VIEW_TILES = 16;
/** Individual hotspots: shown for a single-month window at any zoom, or for a year window from this zoom. */
export const POINTS_MIN_ZOOM = 8;
/** Without an AOI, at most this many point tiles are read for the viewport. */
export const MAX_POINT_TILES = 9;

/** Tiles in the viewport that exist in `have` (bbox clamped to the world). */
export function tilesInView(b: Bbox, have: string[]): string[] {
  const set = new Set(have);
  const clamped: Bbox = [Math.max(b[0], -180), Math.max(b[1], -90), Math.min(b[2], 180), Math.min(b[3], 90)];
  if (clamped[0] >= clamped[2] || clamped[1] >= clamped[3]) return [];
  return tilesForBbox(clamped).filter((t) => set.has(t));
}

/** Pad a bbox by 20 % and snap outward to 0.5°, so small pans reuse the same query. */
export function paddedViewBbox([w, s, e, n]: Bbox): Bbox {
  const px = (e - w) * 0.2;
  const py = (n - s) * 0.2;
  const snap = (x: number, f: (v: number) => number) => f(x * 2) / 2;
  return [
    Math.max(-180, snap(w - px, Math.floor)),
    Math.max(-90, snap(s - py, Math.floor)),
    Math.min(180, snap(e + px, Math.ceil)),
    Math.min(90, snap(n + py, Math.ceil)),
  ];
}

/**
 * Map density: per-cell harmonized FCD in the window. Inside an AOI it uses the calendar's k and the
 * AOI's cells (so map and calendar agree). Without an AOI: the 1° world cube when zoomed out, the 0.1°
 * tiles in view from zoom 4 (≤ 16 tiles), with calibration.json's global k or a global k fitted from
 * the 1° cube.
 */
export function useDensity(aoi: Aoi | null, window: TimeWindow, view: MapViewport) {
  const manifest = useManifest();
  const calibration = useCalibration();
  const cal = useCalendarData(aoi);
  const ref = useAoiRef(aoi);
  const k: KPair | null = useMemo(() => {
    if (aoi) {
      const h = cal.data?.harmonized;
      return h ? { modis: h.kModis.map((x) => x.k), n20: h.kN20.map((x) => x.k) } : null;
    }
    const c = calibration.data;
    return c ? { modis: c.global.k, n20: c.n20.global.k } : null;
  }, [aoi, cal.data, calibration.data]);
  const viewTiles = useMemo(() => {
    if (aoi || !manifest.data || view.zoom < L01_MIN_ZOOM) return null;
    const t = tilesInView(view.bbox, manifest.data.tiles);
    return t.length > 0 && t.length <= MAX_VIEW_TILES ? t : null;
  }, [aoi, manifest.data, view]);
  const ready = !!manifest.data && !calibration.isLoading && (!aoi || (!!k && !cal.isStale));
  return useQuery({
    queryKey: ['density', ref?.id ?? 'world', viewTiles?.join(',') ?? 'L10', window.year, window.month, kKey(k)],
    enabled: ready,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const m = manifest.data!;
      return densityInWorker({
        kind: 'density',
        aoi: ref,
        viewTiles,
        window,
        manifestTiles: m.tiles,
        l10Path: m.l10,
        eras: { tSwitch: dekadIndex(SWITCH_DATE), tN20: dekadIndex(m.snpp_end) },
        k,
        kSource: aoi ? 'aoi' : 'calibration',
        fit: {
          overlap: [dekadIndex(m.overlap.start), dekadIndex(m.overlap.end)],
          n20: [dekadIndex(N20_FIT.start), Math.min(dekadIndex(N20_FIT.end), dekadIndex(m.snpp_end) - 1)],
        },
      });
    },
  });
}

/**
 * Individual hotspots only for short windows or high zoom (PRODUCT.md F4): a single month at any zoom,
 * or a single year from zoom 8. Point files are per year, so a year must be picked. Without an AOI the
 * viewport must also cover ≤ MAX_POINT_TILES tiles.
 */
export function pointsEligible(aoi: Aoi | null, w: TimeWindow, manifest: Manifest | undefined, view: MapViewport): string | null {
  if (w.year === null) return 'Pick a year (top left) or click a calendar month to see individual hotspots.';
  const p = manifest?.points;
  if (!p || !p.tiles.length) return 'No hotspot point files on this data host.';
  if (w.year < p.years[0] || w.year > p.years[1]) return `Hotspot points cover ${p.years[0]}–${p.years[1]}.`;
  if (w.month === null && view.zoom < POINTS_MIN_ZOOM) return 'Zoom in further, or pick a single month, to see individual hotspots.';
  if (!aoi && tilesInView(paddedViewBbox(view.bbox), p.tiles).length > MAX_POINT_TILES)
    return 'Zoom in (or select an area) to see individual hotspots.';
  return null;
}

export function usePoints(aoi: Aoi | null, window: TimeWindow, enabled: boolean, view: MapViewport) {
  const manifest = useManifest();
  const ref = useAoiRef(aoi);
  const why = pointsEligible(aoi, window, manifest.data, view);
  const viewBbox = useMemo(() => (aoi ? null : paddedViewBbox(view.bbox)), [aoi, view]);
  return useQuery({
    queryKey: ['points', ref?.id ?? viewBbox?.join(','), window.year, window.month],
    enabled: enabled && !why,
    staleTime: Infinity,
    placeholderData: aoi ? undefined : keepPreviousData, // smooth panning in viewport mode
    queryFn: () => {
      const m = manifest.data!;
      const have = m.points!.tiles;
      const tiles = ref ? tilesForGeometry(ref.geometry).filter((t) => have.includes(t)) : tilesInView(viewBbox!, have);
      const y = window.year!;
      const [tA, tB] =
        window.month === null
          ? [minutesSince2000(y, 0), minutesSince2000(y + 1, 0)]
          : [minutesSince2000(y, window.month), minutesSince2000(y, window.month + 1)];
      return pointsInWorker({
        kind: 'points',
        aoi: ref,
        bbox: ref ? ref.bbox : viewBbox!,
        paths: tiles.map((t) => `points/${t}/${y}.parquet`),
        tA,
        tB,
        manifestTiles: m.tiles,
        l10Path: m.l10,
      });
    },
  });
}
