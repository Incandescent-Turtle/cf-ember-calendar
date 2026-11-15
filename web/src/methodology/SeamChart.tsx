// Seam chart: monthly raw MODIS, raw VIIRS S-NPP and harmonized (+ calibration band) around the
// Feb 2012 switch. Okabe–Ito colours plus line styles, so it reads without colour too.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SeamScope } from './types';
import { SEAM_COLORS } from './summary';

echarts.use([LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);


export function SeamChart({ scope, switchMonth }: { scope: SeamScope; switchMonth: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' });
    const lo = scope.harmonized_lo ?? [];
    const hi = scope.harmonized_hi ?? [];
    const fmt = (v: unknown) => (typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : '—');
    c.setOption({
      animation: false,
      grid: { left: 56, right: 16, top: 26, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: { axisValue: string; dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return [
            `<b>${ps[0].axisValue}</b>`,
            `Harmonized ${fmt(scope.harmonized[i])}${lo[i] != null && lo[i] !== hi[i] ? ` <span class="tt-dim">(band ${fmt(lo[i])}–${fmt(hi[i])})</span>` : ''}`,
            `MODIS raw ${fmt(scope.modis_raw[i])}`,
            `VIIRS S-NPP raw ${fmt(scope.viirs_raw[i])}`,
          ].join('<br/>');
        },
      },
      xAxis: { type: 'category', data: scope.months, axisLabel: { fontSize: 10, interval: (i: number) => scope.months[i].endsWith('-01') }, axisTick: { show: false } },
      yAxis: { type: 'value', name: 'FCD / month', nameTextStyle: { fontSize: 10, align: 'left' }, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#eee' } } },
      series: [
        // calibration band: invisible lower line + stacked difference
        { type: 'line', data: lo.map((v) => v ?? '-'), stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
        {
          type: 'line', data: hi.map((v, i) => (v != null && lo[i] != null ? v - (lo[i] as number) : '-')), stack: 'band', symbol: 'none',
          lineStyle: { opacity: 0 }, areaStyle: { color: SEAM_COLORS.band }, silent: true, tooltip: { show: false },
        },
        { name: 'MODIS raw', type: 'line', data: scope.modis_raw.map((v) => v ?? '-'), symbol: 'none', lineStyle: { color: SEAM_COLORS.modis, width: 1.5, type: 'dashed' }, itemStyle: { color: SEAM_COLORS.modis } },
        {
          name: 'Harmonized', type: 'line', data: scope.harmonized.map((v) => v ?? '-'), symbol: 'none', lineStyle: { color: SEAM_COLORS.harmonized, width: 2.5 }, itemStyle: { color: SEAM_COLORS.harmonized },
          markLine: { silent: true, symbol: 'none', label: { formatter: 'VIIRS takes over', fontSize: 10, position: 'insideEndTop' }, lineStyle: { color: '#888', type: 'dotted' }, data: [{ xAxis: switchMonth }] },
        },
        { name: 'VIIRS S-NPP raw', type: 'line', data: scope.viirs_raw.map((v) => v ?? '-'), symbol: 'none', lineStyle: { color: SEAM_COLORS.viirs, width: 1 }, itemStyle: { color: SEAM_COLORS.viirs } },
      ],
    });
    const ro = new ResizeObserver(() => !c.isDisposed() && c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, [scope, switchMonth]);
  return <div ref={el} className="seam-chart" role="img" aria-label={`Monthly fire-cell-days for ${scope.name}: raw MODIS, raw VIIRS and harmonized`} />;
}
