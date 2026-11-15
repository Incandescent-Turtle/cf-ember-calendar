import { useQuery } from '@tanstack/react-query';
import { bbox as turfBbox } from '@turf/turf';
import { useMemo } from 'react';
import { aggregateInWorker, fetchCalibration, fetchManifest } from './client';
import { pickLevel } from './aggregate';
import { harmonize, type Harmonized } from '../lib/harmonize';
import type { Aoi } from '../store';
import type { Bbox } from '../lib/grid';
import type { AoiSeries, Calibration, Manifest } from './types';

export const useManifest = () => useQuery({ queryKey: ['manifest'], queryFn: fetchManifest, staleTime: Infinity });
export const useCalibration = () =>
  useQuery({ queryKey: ['calibration'], queryFn: fetchCalibration, staleTime: Infinity });

export interface CalendarData {
  series: AoiSeries;
  harmonized: Harmonized;
  manifest: Manifest;
  calibration: Calibration | null;
}

export function useCalendarData(aoi: Aoi | null) {
  const manifest = useManifest();
  const calibration = useCalibration();
  const series = useQuery({
    queryKey: ['aoi-series', aoi?.id],
    enabled: !!aoi && !!manifest.data,
    staleTime: Infinity,
    queryFn: () => {
      const m = manifest.data!;
      const box = turfBbox(aoi!.feature) as Bbox;
      const [t0, t1] = m.dekad_range;
      return aggregateInWorker({
        level: pickLevel(box),
        manifestTiles: m.tiles,
        l10Path: m.l10,
        geometry: aoi!.feature.geometry,
        bbox: box,
        t0,
        nT: t1 - t0 + 1,
      });
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
    error: (manifest.error ?? series.error) as Error | null,
  };
}
