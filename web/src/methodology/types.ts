// validation.json (CONTRACTS.md → validation.json). Extra fields are optional.

export interface LoyoMetrics {
  r_log: number | null;
  mdape: number | null;
  bias_log: number | null;
  n_points?: number;
  n_mdape?: number;
}

export interface LoyoLevel {
  level: 'global' | 'tile' | string;
  n_series: number;
  calibrated: LoyoMetrics;
  fcd_uncalibrated: LoyoMetrics;
  raw_counts: LoyoMetrics;
  raw_counts_uncalibrated?: LoyoMetrics;
}

export interface SeamTest {
  window_months: number;
  step_modis?: number;
  step_spliced_raw?: number;
  step_harmonized?: number;
  mean_log_diff_before: number | null;
  mean_log_diff_after: number | null;
  mean_modis_fcd_per_month?: number;
  sparse?: boolean;
}

export interface SeamScope {
  name: string;
  months: string[];
  modis_raw: (number | null)[];
  viirs_raw: (number | null)[];
  harmonized: (number | null)[];
  harmonized_lo?: (number | null)[];
  harmonized_hi?: (number | null)[];
  spliced_raw?: (number | null)[];
  k_strata?: string[];
  k_modis?: (number | null)[];
  test?: SeamTest;
}

export interface Validation {
  mock?: boolean;
  loyo: { levels: LoyoLevel[]; years?: [number, number] };
  seam: { scopes: SeamScope[]; test: SeamTest & { scope?: string } };
  seasonality: {
    median_r: number | null;
    n_tiles: number;
    p25_r?: number | null;
    p75_r?: number | null;
    modis_years?: [number, number];
    viirs_years?: [number, number];
    min_annual_fcd?: number;
  };
  params: { overlap: [string, string]; min_modis_fcd: number; switch?: string; snpp_end?: string; built_at?: string };
}
