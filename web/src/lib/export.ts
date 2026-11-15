// Export (PRODUCT.md F5): calendar CSV, summary JSON. Generated in the browser; no server.
import type { Glance } from './glance';
import { monthPercentile, type Harmonized, type KUsed } from './harmonize';
import { dekadRange, MONTHS_SHORT } from './time';
import type { AoiSeries, GlobalTableRef, Manifest } from '../data/types';
import { valueOf } from '../calendar/metric';

/** PRODUCT.md F5 columns first (in that order), then extra traceability columns. */
export const CALENDAR_COLUMNS = [
  'year', 'month', 'harmonized', 'harmonized_lo', 'harmonized_hi', 'modis_fcd', 'viirs_fcd', 'k', 'k_stratum', 'percentile',
  'k_lo', 'k_hi', 'snpp_fcd', 'n20_fcd', 'era', 'partial', 'n_dekads', 'k_source',
] as const;

/** Keep CSVs ASCII so Excel opens them without an encoding prompt (no BOM needed). */
export const ascii = (s: string) =>
  s.replace(/°/g, ' deg').replace(/[–—]/g, '-').replace(/→/g, '->').replace(/·/g, '|').replace(/[^\x20-\x7e]/g, '');

export function csvField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (fields: (string | number | boolean | null | undefined)[]) => fields.map(csvField).join(',');

/**
 * One row per month in the record. `k` is 1 with stratum "reference" in the S-NPP era (VIIRS S-NPP is the
 * reference series). Percentile = mid-rank vs the same calendar month in full months of other years
 * than the current one; empty for partial months.
 */
export function calendarCsv(h: Harmonized, currentYear: number): string {
  const lines = [CALENDAR_COLUMNS.join(',')];
  for (const r of h.rows) {
    if (!r) continue;
    const k: KUsed | null = r.kUsed;
    const ref = r.era === 'snpp';
    const pct = r.partial ? NaN : monthPercentile(h, r.month, r.harmonized, currentYear);
    lines.push(
      csvLine([
        r.year, r.month + 1, r.harmonized, r.lo, r.hi, r.modis, valueOf(r, 'viirs'),
        ref ? 1 : k?.k, ref ? 'reference' : k?.stratum, pct,
        ref ? 1 : k?.lo, ref ? 1 : k?.hi, r.year < 2012 ? null : r.snpp, r.n20, r.era, r.partial, r.nDekads,
        ref ? 'VIIRS S-NPP (reference series)' : ascii(k?.detail ?? ''),
      ]),
    );
  }
  return lines.join('\n') + '\n';
}

/** Human description of the data a build covers: global, or the extent of its tiles. */
export function dataScope(m: Manifest): { global: boolean; text: string } {
  const tiles = m.tiles;
  if (tiles.length >= 100) return { global: true, text: `global (${tiles.length} 10° tiles with activity)` };
  let s = 90;
  let n = -90;
  let w = 180;
  let e = -180;
  for (const t of tiles) {
    const lat = (t[0] === 'S' ? -1 : 1) * Number(t.slice(1, 3));
    const lon = (t[3] === 'W' ? -1 : 1) * Number(t.slice(4, 7));
    s = Math.min(s, lat);
    n = Math.max(n, lat + 10);
    w = Math.min(w, lon);
    e = Math.max(e, lon + 10);
  }
  const ns = (x: number) => `${Math.abs(x)}° ${x < 0 ? 'S' : 'N'}`;
  const ew = (x: number) => `${Math.abs(x)}° ${x < 0 ? 'W' : 'E'}`;
  return {
    global: false,
    text: tiles.length
      ? `regional subset: ${tiles.length} 10° tile${tiles.length > 1 ? 's' : ''} within ${ns(s)}–${ns(n)}, ${ew(w)}–${ew(e)}`
      : 'no tiles',
  };
}

const kJson = (k: KUsed) => ({ k: k.k, lo: k.lo, hi: k.hi, stratum: k.stratum, source: k.detail });
const nan2null = (_: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? null : v);

export interface SummaryArgs {
  aoi: { label: string; kind: string; geometry: unknown; bbox: number[]; areaKm2: number };
  series: AoiSeries;
  h: Harmonized;
  g: Glance;
  manifest: Manifest;
  dataUrl: string;
}

/** Everything the At-a-glance panel shows, plus its inputs, so each number can be recomputed. */
export function summaryJson({ aoi, series, h, g, manifest, dataUrl }: SummaryArgs): string {
  const s = g.summary;
  const out = {
    generator: 'Ember Calendar (harmonized MODIS + VIIRS hotspot activity)',
    generated_at: new Date().toISOString(),
    units: 'hotspot activity in VIIRS-equivalent fire-cell-days (FCD): distinct (0.01 deg cell, UTC day) pairs with >= 1 cleaned detection; MODIS scaled by k to VIIRS S-NPP, NOAA-20 cross-calibrated to S-NPP',
    area: { label: aoi.label, kind: aoi.kind, bbox: aoi.bbox, area_km2: aoi.areaKm2, resolution_deg: series.level === 1 ? 0.1 : 1, n_cells: series.nCells, tiles: series.tiles, geometry: aoi.geometry },
    data: {
      host: dataUrl,
      built_at: manifest.built_at,
      dekad_range: manifest.dekad_range,
      first_day: dekadRange(manifest.dekad_range[0])[0],
      last_dekad: dekadRange(manifest.dekad_range[1]),
      scope: dataScope(manifest).text,
      overlap: manifest.overlap,
      snpp_end: manifest.snpp_end,
    },
    calibration: {
      k_modis_by_month: h.kModis.map(kJson),
      k_n20_by_month: h.kN20.map(kJson),
      switch_modis_to_snpp: dekadRange(h.tSwitch)[0],
      switch_snpp_to_n20: dekadRange(h.tN20)[0],
    },
    rules: 'pipeline/analytics.py (copied into tests/golden/analytics_cases.json -> rules); see the methodology page',
    current_year: s.currentYear,
    baseline_years: s.baselineYears,
    climatology_by_month: s.climatology.map((c, m) => ({ month: MONTHS_SHORT[m], ...c })),
    current_year_months: s.currentMonths.map((x) => ({ ...x, month: MONTHS_SHORT[x.month] })),
    month_to_date: g.mtd && {
      year: g.mtd.year,
      month: MONTHS_SHORT[g.mtd.month],
      dekads_compared: g.mtd.dekads,
      days: [dekadRange(g.mtd.tFirst)[0], dekadRange(g.mtd.tLast)[1]],
      latest_dekad_left_out_as_incomplete: g.mtd.droppedIncomplete,
      value: g.mtd.value,
      ratio_to_median: g.mtd.ratio,
      percentile: g.mtd.percentile,
      label: g.mtd.label,
      z: g.mtd.z,
      climatology: g.mtd.clim,
      inputs: {
        current_dekads_harmonized: g.mtd.currentDekads,
        current_raw: g.mtd.raw,
        base_years: g.mtd.baseYears,
        base_dekads_harmonized: g.mtd.baseDekads,
      },
    },
    critical_period: s.criticalPeriod && { ...s.criticalPeriod, month_names: s.criticalPeriod.months.map((m) => MONTHS_SHORT[m]) },
    trend: s.trend,
    annual_totals: s.baselineYears.map((y, i) => ({ year: y, harmonized: s.annual[i] })),
    top_years: g.topYears,
    top_months: g.topMonths.map((m) => ({ month: MONTHS_SHORT[m.month], median: m.median })),
    busiest_month: g.busiest && {
      year: g.busiest.year, month: MONTHS_SHORT[g.busiest.month], harmonized: g.busiest.harmonized,
      modis_fcd: g.busiest.modis, snpp_fcd: g.busiest.snpp, n20_fcd: g.busiest.n20, k: g.busiest.kUsed && kJson(g.busiest.kUsed),
    },
  };
  return JSON.stringify(out, nan2null, 1) + '\n';
}

export function slug(s: string): string {
  return ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'area';
}

export function download(content: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Default location of the global table on the data host (pipeline.export_global + sync_data.sh --exports). */
export const GLOBAL_TABLE_DEFAULT: GlobalTableRef = {
  parquet: 'exports/global_harmonized_monthly_1deg.parquet',
  csv_gz: 'exports/global_harmonized_monthly_1deg.csv.gz',
  readme: 'exports/README.md',
};

/**
 * Links for the "Download global table" block: shown when the manifest lists the table, or when the
 * VITE_GLOBAL_TABLE flag is "1"/"true" (then the default paths are assumed). Otherwise null, so nothing
 * points at files that aren't uploaded yet.
 */
export function globalTableLinks(m: Manifest, baseUrl: string, flag: string | undefined): (GlobalTableRef & { href: (p: string) => string }) | null {
  const ref = m.exports?.global_table ?? (flag === '1' || flag === 'true' ? GLOBAL_TABLE_DEFAULT : null);
  if (!ref) return null;
  const base = baseUrl.replace(/\/+$/, '');
  return { ...ref, href: (p: string) => `${base}/${p.replace(/^\/+/, '')}` };
}
