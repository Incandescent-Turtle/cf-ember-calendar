// ECharts option for the burning-activity calendar: years × months heatmap, log colour scale,
// marginal bars (per-year total right, per-month median bottom). Split mode = two heatmaps, one scale.
import type { EChartsCoreOption } from 'echarts/core';
import type { Harmonized, MonthRow } from '../lib/harmonize';
import { MONTHS_SHORT } from '../lib/time';
import { METRIC_LABEL, tooltipHtml, valueOf, type Metric } from './metric';

/** Reversed inferno (perceptually uniform, monotonic lightness → CVD-safe): light = low, dark = high. */
export const RAMP = ['#fcffa4', '#f7d13d', '#fb9b06', '#ed6925', '#cf4446', '#a52c60', '#781c6d', '#4a0c6b', '#1b0c41'];
export const ZERO_COLOR = '#e7e4df';
export const NODATA_COLOR = '#ffffff';

const log = (v: number) => Math.log10(1 + v);
const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function rowAt(h: Harmonized, year: number, month: number): MonthRow | null {
  return h.rows[(year - h.years[0]) * 12 + month] ?? null;
}

export interface BuildArgs {
  h: Harmonized;
  metrics: Metric[];
  currentYear: number;
  selected: { year: number; month: number } | null;
}

export function buildOption({ h, metrics, currentYear, selected }: BuildArgs): { option: EChartsCoreOption; vmin: number; vmax: number } {
  const years = h.years.map(String);
  const split = metrics.length > 1;
  let vmax = 0;
  const logs: number[] = [];
  const heat = metrics.map((metric) => {
    const data: unknown[] = [];
    const zeros: unknown[] = [];
    for (const y of h.years)
      for (let m = 0; m < 12; m++) {
        const r = rowAt(h, y, m);
        if (!r) continue;
        const v = valueOf(r, metric);
        if (!Number.isFinite(v)) continue;
        const lv = v > 0 ? log(v) : 0;
        vmax = Math.max(vmax, lv);
        if (v > 0) logs.push(lv);
        const isSel = selected?.year === y && selected?.month === m;
        (v > 0 ? data : zeros).push({
          value: [m, String(y), lv, v],
          itemStyle: r.partial
            ? { borderColor: '#5b5b5b', borderWidth: 1.5, borderType: 'dashed' }
            : isSel
              ? { borderColor: '#1f6fb2', borderWidth: 2 }
              : undefined,
        });
      }
    return { metric, data, zeros };
  });
  vmax = Math.max(vmax, 1);
  // start the ramp at the 2nd percentile of non-zero months so large areas don't render all-dark
  logs.sort((a, b) => a - b);
  const vmin = Math.min(Math.max(0, Math.floor((logs[Math.floor(logs.length * 0.02)] ?? 0) * 2) / 2), vmax - 1);

  // marginals for the (last) displayed metric
  const main = metrics[metrics.length - 1];
  const yearTotals = h.years.map((y) => {
    let s = 0;
    let any = false;
    let partial = false;
    for (let m = 0; m < 12; m++) {
      const r = rowAt(h, y, m);
      if (!r) {
        partial = true;
        continue;
      }
      const v = valueOf(r, main);
      if (Number.isFinite(v)) {
        s += v;
        any = true;
      }
      if (r.partial) partial = true;
    }
    return { value: any ? s : null, itemStyle: { color: partial ? '#b9b4ac' : '#7a6f63' }, partial };
  });
  const monthMedians = MONTHS_SHORT.map((_, m) =>
    median(
      h.years
        .filter((y) => y !== currentYear)
        .map((y) => rowAt(h, y, m))
        .filter((r): r is MonthRow => !!r && !r.partial)
        .map((r) => valueOf(r, main)),
    ),
  );

  const left = 44;
  const barW = split ? 0 : 64;
  const bottomBars = split ? 0 : 56;
  const grids: object[] = [];
  const xAxes: object[] = [];
  const yAxes: object[] = [];
  const series: object[] = [];
  heat.forEach(({ metric, data }, i) => {
    grids.push(
      split
        ? { left: `${i === 0 ? 9 : 54}%`, width: '44%', top: 30, bottom: 34 }
        : { left, right: barW + 16, top: 12, bottom: bottomBars + 34 },
    );
    xAxes.push({
      type: 'category',
      gridIndex: i,
      data: MONTHS_SHORT.map((m) => (split ? m[0] : m)),
      position: 'bottom',
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { fontSize: 11, color: '#4a4a4a', interval: 0 },
      splitArea: { show: false },
    });
    yAxes.push({
      type: 'category',
      gridIndex: i,
      data: years,
      inverse: true,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { show: i === 0, fontSize: 10, color: '#4a4a4a', interval: (idx: number) => (h.years[idx] % 2 === 0) },
    });
    series.push({
      name: METRIC_LABEL[metric],
      type: 'heatmap',
      xAxisIndex: i,
      yAxisIndex: i,
      data,
      encode: { x: 0, y: 1, value: 2 },
      itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: '#1f6fb2', borderWidth: 2 } },
      progressive: 0,
      animation: false,
    });
  });
  // zero months: own series with a fixed neutral colour (not part of the visualMap)
  heat.forEach(({ metric, zeros }, i) => {
    series.push({
      name: `${METRIC_LABEL[metric]} (zero)`,
      type: 'heatmap',
      xAxisIndex: i,
      yAxisIndex: i,
      data: zeros,
      encode: { x: 0, y: 1, value: 2 },
      itemStyle: { color: ZERO_COLOR, borderColor: '#ffffff', borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: '#1f6fb2', borderWidth: 2 } },
      animation: false,
    });
  });

  if (!split) {
    // right: per-year totals
    grids.push({ right: 8, width: barW, top: 12, bottom: bottomBars + 34 });
    xAxes.push({ type: 'value', gridIndex: 1, show: false });
    yAxes.push({ type: 'category', gridIndex: 1, data: years, inverse: true, show: false });
    series.push({
      name: 'Per-year total',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: yearTotals,
      barWidth: '70%',
      animation: false,
    });
    // bottom: per-month median
    grids.push({ left, right: barW + 16, height: bottomBars - 8, bottom: 4 });
    xAxes.push({ type: 'category', gridIndex: 2, data: MONTHS_SHORT, show: false });
    yAxes.push({ type: 'value', gridIndex: 2, show: false, inverse: true });
    series.push({
      name: 'Per-month median',
      type: 'bar',
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: monthMedians.map((v) => (Number.isFinite(v) ? v : null)),
      itemStyle: { color: '#7a6f63' },
      barWidth: '60%',
      animation: false,
    });
  }

  const titles = split
    ? heat.map(({ metric }, i) => ({
        text: metric === 'spliced' ? 'Raw (MODIS → VIIRS at Feb 2012)' : 'Harmonized',
        left: `${i === 0 ? 9 : 54}%`,
        top: 6,
        textStyle: { fontSize: 12, fontWeight: 600, color: '#2b2b2b' },
      }))
    : [];

  const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
  for (const { data } of heat)
    for (const d of data as { value: [number, string, number, number] }[]) if (d.value[2] < vmin) d.value[2] = vmin;
  const option: EChartsCoreOption = {
    title: titles,
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    series,
    visualMap: [
      {
        type: 'continuous',
        show: false,
        min: vmin,
        max: vmax,
        dimension: 2,
        seriesIndex: heat.map((_, i) => i),
        inRange: { color: RAMP },
      },
      {
        // zero months: a single neutral colour (ECharts needs a visualMap on every heatmap series)
        type: 'piecewise',
        show: false,
        dimension: 2,
        seriesIndex: heat.map((_, i) => heat.length + i),
        pieces: [{ min: -1, max: 1e9, color: ZERO_COLOR }],
      },
    ],
    tooltip: {
      confine: true,
      borderColor: '#cfcac3',
      textStyle: { fontSize: 12, color: '#222' },
      extraCssText: 'max-width: 360px; white-space: normal; line-height: 1.45;',
      formatter: (p: { seriesType: string; seriesName: string; dataIndex: number; value: unknown; name: string }) => {
        if (p.seriesType === 'heatmap') {
          const [m, y] = (p.value as [number, string, number, number]);
          const r = rowAt(h, Number(y), m);
          return r ? tooltipHtml(r, h, currentYear) : '';
        }
        if (p.seriesName === 'Per-year total') {
          const t = yearTotals[p.dataIndex];
          return `<b>${h.years[p.dataIndex]}</b> total: ${t.value == null ? '—' : fmt(t.value)} FCD${t.partial ? ' (incomplete year)' : ''}<br/><span class="tt-dim">${METRIC_LABEL[main]}</span>`;
        }
        const v = monthMedians[p.dataIndex];
        return `<b>${MONTHS_SHORT[p.dataIndex]}</b> median: ${Number.isFinite(v) ? fmt(v) : '—'} FCD<br/><span class="tt-dim">over complete years, excluding ${currentYear}</span>`;
      },
    },
  };
  return { option, vmin, vmax };
}

/** Legend ticks (FCD values) for a log scale up to 10^vmax. */
export function legendTicks(vmin: number, vmax: number): number[] {
  const out: number[] = [];
  for (let p = 0; p <= Math.floor(vmax); p++) if (Math.log10(1 + 10 ** p) >= vmin - 1e-9) out.push(10 ** p);
  return out;
}
