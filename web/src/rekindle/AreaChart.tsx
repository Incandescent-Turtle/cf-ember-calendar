// Burned area vs time: baseline (observed weather) and the selected what-if run.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export function AreaChart({ start, baseline, selected, t }: { start: string; baseline: number[]; selected: number[] | null; t: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const c = echarts.init(el.current!);
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);
  useEffect(() => {
    const xs = baseline.map((_, h) => h);
    chart.current?.setOption(
      {
        animation: false,
        grid: { left: 48, right: 12, top: 28, bottom: 30 },
        legend: { top: 0, textStyle: { fontSize: 11 } },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: unknown) => `${Number(v).toFixed(1)} km²`,
          axisPointer: { type: 'line' },
          formatter: undefined,
        },
        xAxis: { type: 'category', data: xs, name: 'hours after first detection', nameLocation: 'middle', nameGap: 20, axisLabel: { interval: 23, fontSize: 10 } },
        yAxis: { type: 'value', name: 'km²', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
        series: [
          {
            name: 'Baseline (hindcast)', type: 'line', data: baseline, showSymbol: false, lineStyle: { color: '#1f6fb2', width: 2 }, itemStyle: { color: '#1f6fb2' },
            markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#6b6b6b', type: 'dashed' }, data: [{ xAxis: t }] },
          },
          ...(selected
            ? [{ name: 'What-if (illustrative)', type: 'line', data: selected, showSymbol: false, lineStyle: { color: '#c2410c', width: 2, type: 'dashed' }, itemStyle: { color: '#c2410c' } }]
            : []),
        ],
      },
      { notMerge: true },
    );
  }, [baseline, selected, t, start]);
  return <div ref={el} className="rk-chart" role="img" aria-label="Burned area over time, baseline and selected run" />;
}
