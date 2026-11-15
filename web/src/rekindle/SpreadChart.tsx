// Burst-and-stall diagnostic: farthest detection per overpass vs the calibrated model's head run
// (meta.json spread_profile, written by rekindle.export from rekindle.spread_profile).
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SpreadProfile } from './data';

echarts.use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function SpreadChart({ profile, mult }: { profile: SpreadProfile; mult: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = echarts.init(el.current!);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    const hours = profile.model_km_by_hour.length - 1;
    c.setOption({
      animation: false,
      grid: { left: 40, right: 12, top: 64, bottom: 32 },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      tooltip: { trigger: 'item', valueFormatter: (v: unknown) => `${Number(v).toFixed(1)} km` },
      xAxis: { type: 'value', min: 0, max: hours, name: 'hours after first detection', nameLocation: 'middle', nameGap: 20, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', min: 0, name: 'km from ignition', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: [
        {
          name: 'FIRMS: farthest detection per overpass', type: 'scatter', symbolSize: 6, itemStyle: { color: '#1f1f1f' },
          data: profile.observed.map((o) => [o.t_h, o.max_km]),
        },
        {
          name: `Model head run (ROS ×${mult})`, type: 'line', showSymbol: false, lineStyle: { color: '#c2410c', width: 2 }, itemStyle: { color: '#c2410c' },
          data: profile.model_km_by_hour.map((km, h) => [h, km]), tooltip: { trigger: 'axis' },
        },
      ],
    });
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, [profile, mult]);
  const obsMax = Math.max(...profile.observed.map((o) => o.max_km));
  const modelEnd = profile.model_km_by_hour[profile.model_km_by_hour.length - 1];
  return (
    <figure className="rk-figure">
      <div
        ref={el}
        className="rk-chart"
        role="img"
        aria-label={`Distance from ignition over time: detections reach at most ${obsMax.toFixed(1)} km; the calibrated model's head run reaches ${modelEnd.toFixed(1)} km`}
      />
      <figcaption className="caption">
        Distance from the nearest ignition vs time. Dots: the farthest FIRMS detection in each overpass (detection times are upper bounds). Line: the farthest cell the calibrated baseline
        has burned by each hour. Detections reach at most {obsMax.toFixed(1)} km; the model reaches {modelEnd.toFixed(1)} km by the end. A free-spread model grows steadily; plateaus in the dots mean the real fire stalled.
      </figcaption>
    </figure>
  );
}
