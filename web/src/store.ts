import { create } from 'zustand';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { TimeWindow } from './data/density';

export type ViewMode = 'harmonized' | 'modis' | 'viirs' | 'split';
export type DrawMode = 'none' | 'rectangle' | 'polygon';

export interface Aoi {
  id: string;
  label: string;
  kind: 'rectangle' | 'polygon' | 'circle' | 'country' | 'preset';
  feature: Feature<Polygon | MultiPolygon>;
}

export const ALL_TIME: TimeWindow = { year: null, month: null };

interface State {
  aoi: Aoi | null;
  viewMode: ViewMode;
  drawMode: DrawMode;
  /** map time window; a calendar cell click sets {year, month} */
  window: TimeWindow;
  showPoints: boolean;
  showTable: boolean;
  setAoi: (aoi: Aoi | null) => void;
  setViewMode: (m: ViewMode) => void;
  setDrawMode: (m: DrawMode) => void;
  setWindow: (w: TimeWindow) => void;
  setShowPoints: (v: boolean) => void;
  toggleTable: () => void;
}

let aoiCounter = 0;
export const newAoiId = () => `aoi-${++aoiCounter}`;

export const useStore = create<State>((set) => ({
  aoi: null,
  viewMode: 'harmonized',
  drawMode: 'none',
  window: ALL_TIME,
  showPoints: true,
  showTable: false,
  setAoi: (aoi) => set({ aoi, drawMode: 'none' }),
  setViewMode: (viewMode) => set({ viewMode }),
  setDrawMode: (drawMode) => set({ drawMode }),
  setWindow: (window) => set({ window }),
  setShowPoints: (showPoints) => set({ showPoints }),
  toggleTable: () => set((s) => ({ showTable: !s.showTable })),
}));

/** A single calendar cell is selected when both year and month are set. */
export const selectedCell = (w: TimeWindow) => (w.year !== null && w.month !== null ? { year: w.year, month: w.month } : null);
