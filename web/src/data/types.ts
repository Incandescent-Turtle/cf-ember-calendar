// Shapes of the hosted JSON files (CONTRACTS.md).

export interface Manifest {
  version: number;
  mock?: boolean;
  built_at: string;
  dekad_range: [number, number];
  series: string[];
  tiles: string[];
  l10: string;
  overlap: { start: string; end: string };
  snpp_end: string;
  min_modis_fcd: number;
  points?: { years: [number, number]; tiles: string[] };
  row_counts?: Record<string, number>;
  sizes_mb?: Record<string, number>;
  /** downloadable files on the data host (CONTRACTS.md → Global harmonized table); added by sync_data.sh --exports */
  exports?: { global_table?: GlobalTableRef };
}

export interface GlobalTableRef {
  parquet: string;
  csv_gz: string;
  readme: string;
  rows?: number;
  cells?: number;
  bytes?: { parquet?: number; csv_gz?: number };
}

export interface KBlock {
  k: number[];
  lo: number[];
  hi: number[];
  n_modis?: number[];
}

export interface Calibration {
  mock?: boolean;
  global: KBlock;
  tile: Record<string, KBlock>;
  n20: { global: KBlock; tile: Record<string, KBlock> };
}

/** Series ids (CONTRACTS.md → Series ids). */
export const S_MODIS = 0;
export const S_SNPP = 1;
export const S_N20 = 2;
export const N_SERIES = 4;

/** Per-dekad sums for an AOI, split by 10° tile (so tile-level k can be weighted). */
export interface AoiSeries {
  level: 1 | 10;
  t0: number;
  nT: number;
  /** tile ids with ≥ 1 cell inside the AOI */
  tiles: string[];
  /** perTile[i][s * nT + (t − t0)] = FCD */
  perTile: Float64Array[];
  /** number of coarse cells whose centre is inside the AOI */
  nCells: number;
  /** tiles that were fetched (had data) */
  fetched: string[];
  ms: number;
}
