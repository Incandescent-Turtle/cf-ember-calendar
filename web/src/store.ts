import { create } from 'zustand';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export type ViewMode = 'harmonized' | 'modis' | 'viirs' | 'split';
export type DrawMode = 'none' | 'rectangle' | 'polygon';

export interface Aoi {
  id: string;
  label: string;
  kind: 'rectangle' | 'polygon' | 'circle' | 'country' | 'preset';
  feature: Feature<Polygon | MultiPolygon>;
}

interface State {
  aoi: Aoi | null;
  viewMode: ViewMode;
  drawMode: DrawMode;
  selected: { year: number; month: number } | null;
  showTable: boolean;
  setAoi: (aoi: Aoi | null) => void;
  setViewMode: (m: ViewMode) => void;
  setDrawMode: (m: DrawMode) => void;
  setSelected: (s: { year: number; month: number } | null) => void;
  toggleTable: () => void;
}

let aoiCounter = 0;
export const newAoiId = () => `aoi-${++aoiCounter}`;

export const useStore = create<State>((set) => ({
  aoi: null,
  viewMode: 'harmonized',
  drawMode: 'none',
  selected: null,
  showTable: false,
  setAoi: (aoi) => set({ aoi, selected: null, drawMode: 'none' }),
  setViewMode: (viewMode) => set({ viewMode }),
  setDrawMode: (drawMode) => set({ drawMode }),
  setSelected: (selected) => set({ selected }),
  toggleTable: () => set((s) => ({ showTable: !s.showTable })),
}));
