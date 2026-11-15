// Dekad-of-year sub-view: harmonized FCD per 10-day period (years × 36), collapsed by default.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { RAMP, ZERO_COLOR } from './option';
import { dekadCells, dekadLabel, type DekadCell } from './dekad';
import type { Harmonized } from '../lib/harmonize';
import type { AoiSeries } from '../data/types';
import { MONTHS_SHORT } from '../lib/time';

const log = (v: number) => Math.log10(1 + v);
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const k2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

function tooltip(c: DekadCell): string {
  const viirs = c.year < 2012 ? '—' : c.era === 'n20' || c.year >= 2018 ? `S-NPP ${n0(c.snpp)} · NOAA-20 ${n0(c.n20)}` : `S-NPP ${n0(c.snpp)}`;
  const k =
    c.era === 'snpp'
      ? 'k = 1 (VIIRS S-NPP is the reference series)'
      : !c.k || !Number.isFinite(c.k.k)
        ? 'k unavailable — no calibration for this month'
        : `${c.era === 'modis' ? 'MODIS → VIIRS' : 'NOAA-20 → S-NPP'} k = ${k2(c.k.k)} (${k2(c.k.lo)}–${k2(c.k.hi)}), stratum: ${c.k.detail}`;
  return [
    `<b>${dekadLabel(c.d, c.year)} ${c.year}</b>`,
    `Harmonized: <b>${Number.isFinite(c.harmonized) ? n0(c.harmonized) : '—'}</b> FCD`,
    `Raw: MODIS ${n0(c.modis)} · VIIRS ${viirs}`,
    `<span class="tt-dim">${k}</span>`,
  ].join('<br/>');
}

export function DekadCalendar({ h, series }: { h: Harmonized; series: AoiSeries }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="dekad-view" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Dekad view (10-day periods)</summary>
      {open && <DekadChart h={h} series={series} />}
    </details>
  );
}

function DekadChart({ h, series }: { h: Harmonized; series: AoiSeries }) {
  const el = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => dekadCells(h, series), [h, series]);
  const option = useMemo((): EChartsCoreOption => {
    const years = h.years.map(String);
    const data: unknown[] = [];
    const zeros: unknown[] = [];
    const logs: number[] = [];
    cells.forEach((c, i) => {
      if (!Number.isFinite(c.harmonized)) return;
      const lv = log(c.harmonized);
      if (c.harmonized > 0) logs.push(lv);
      (c.harmonized > 0 ? data : zeros).push({ value: [c.d, String(c.year), lv, i] });
    });
    logs.sort((a, b) => a - b);
    const vmax = Math.max(logs[logs.length - 1] ?? 1, 1);
    const vmin = Math.min(Math.max(0, Math.floor((logs[Math.floor(logs.length * 0.02)] ?? 0) * 2) / 2), vmax - 1);
    const heat = (d: unknown[], color?: string) => ({
      type: 'heatmap',
      data: d,
      encode: { x: 0, y: 1, value: 2 },
      itemStyle: { borderColor: '#ffffff', borderWidth: 0.5, ...(color ? { color } : {}) },
      emphasis: { itemStyle: { borderColor: '#1f6fb2', borderWidth: 2 } },
      animation: false,
    });
    return {
      animation: false,
      grid: { left: 44, right: 12, top: 8, bottom: 28 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 36 }, (_, d) => d),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { fontSize: 10, color: '#4a4a4a', interval: (d: number) => d % 3 === 0, formatter: (d: string) => MONTHS_SHORT[Math.floor(Number(d) / 3)] },
      },
      yAxis: {
        type: 'category',
        data: years,
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { fontSize: 10, color: '#4a4a4a', interval: (i: number) => h.years[i] % 2 === 0 },
      },
      series: [heat(data), heat(zeros, ZERO_COLOR)],
      visualMap: [
        { type: 'continuous', show: false, min: vmin, max: vmax, dimension: 2, seriesIndex: 0, inRange: { color: RAMP } },
        { type: 'piecewise', show: false, dimension: 2, seriesIndex: 1, pieces: [{ min: -1, max: 1e9, color: ZERO_COLOR }] },
      ],
      tooltip: {
        confine: true,
        borderColor: '#cfcac3',
        textStyle: { fontSize: 12, color: '#222' },
        extraCssText: 'max-width: 360px; white-space: normal; line-height: 1.45;',
        formatter: (p: { value: [number, string, number, number] }) => tooltip(cells[p.value[3]]),
      },
    };
  }, [cells, h.years]);

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' });
    c.setOption(option);
    const ro = new ResizeObserver(() => !c.isDisposed() && c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, [option]);

  return (
    <>
      <p className="caption">
        Harmonized hotspot activity per dekad (days 1–10, 11–20, 21–end of each month), same colours and k as the monthly calendar, scaled to this view. Shows when in
        the month activity peaks; the latest dekad may be incomplete.
      </p>
      <div ref={el} className="chart dekad-chart" role="img" aria-label="Harmonized hotspot activity per dekad and year" />
    </>
  );
}
