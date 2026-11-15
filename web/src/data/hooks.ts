import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { bbox as turfBbox } from '@turf/turf';
import { useMemo } from 'react';
import { aggregateInWorker, densityInWorker, fetchCalibration, fetchManifest, pointsInWorker } from './client';
import { pickLevel, tilesForGeometry } from './aggregate';
import { harmonize, N20_FIT, SWITCH_DATE, type Harmonized } from '../lib/harmonize';
import { dekadIndex } from '../lib/time';
import type { Aoi } from '../store';
import type { Bbox } from '../lib/grid';
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

/**
 * Map density: per-cell harmonized FCD in the window. Inside an AOI it uses the calendar's k (so the
 * map and calendar agree); for the world view, calibration.json's global k or, if absent, a global k
 * fitted from the 1° cube.
 */
export function useDensity(aoi: Aoi | null, window: TimeWindow) {
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
  const ready = !!manifest.data && !calibration.isLoading && (!aoi || (!!k && !cal.isStale));
  return useQuery({
    queryKey: ['density', ref?.id ?? 'world', window.year, window.month, kKey(k)],
    enabled: ready,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const m = manifest.data!;
      return densityInWorker({
        kind: 'density',
        aoi: ref,
        window,
        manifestTiles: m.tiles,
        l10Path: m.l10,
        eras: { tSwitch: dekadIndex(SWITCH_DATE), tN20: dekadIndex(m.snpp_end) },
        k,
        fit: {
          overlap: [dekadIndex(m.overlap.start), dekadIndex(m.overlap.end)],
          n20: [dekadIndex(N20_FIT.start), Math.min(dekadIndex(N20_FIT.end), dekadIndex(m.snpp_end) - 1)],
        },
      });
    },
  });
}

/** Points need an AOI and a window of at most one year (PRODUCT.md F4). */
export function pointsEligible(aoi: Aoi | null, w: TimeWindow, manifest: Manifest | undefined): string | null {
  if (!aoi) return 'Select an area to see individual hotspots.';
  if (w.year === null) return 'Pick a year (or click a calendar month) to see individual hotspots.';
  const p = manifest?.points;
  if (!p || !p.tiles.length) return 'No hotspot point files on this data host.';
  if (w.year < p.years[0] || w.year > p.years[1]) return `Hotspot points cover ${p.years[0]}–${p.years[1]}.`;
  return null;
}

export function usePoints(aoi: Aoi | null, window: TimeWindow, enabled: boolean) {
  const manifest = useManifest();
  const ref = useAoiRef(aoi);
  const why = pointsEligible(aoi, window, manifest.data);
  return useQuery({
    queryKey: ['points', ref?.id, window.year, window.month],
    enabled: enabled && !why && !!ref,
    staleTime: Infinity,
    queryFn: () => {
      const m = manifest.data!;
      const have = new Set(m.points!.tiles);
      const tiles = tilesForGeometry(ref!.geometry).filter((t) => have.has(t));
      const y = window.year!;
      const [tA, tB] =
        window.month === null
          ? [minutesSince2000(y, 0), minutesSince2000(y + 1, 0)]
          : [minutesSince2000(y, window.month), minutesSince2000(y, window.month + 1)];
      return pointsInWorker({
        kind: 'points',
        aoi: ref!,
        paths: tiles.map((t) => `points/${t}/${y}.parquet`),
        tA,
        tB,
        manifestTiles: m.tiles,
        l10Path: m.l10,
      });
    },
  });
}
