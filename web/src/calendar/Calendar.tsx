import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { buildOption, legendTicks, RAMP, rowAt, ZERO_COLOR } from './option';
import { METRIC_LABEL, metricsFor, valueOf } from './metric';
import type { Harmonized } from '../lib/harmonize';
import { MONTHS_SHORT } from '../lib/time';
import { useStore, type ViewMode } from '../store';

echarts.use([HeatmapChart, BarChart, GridComponent, TooltipComponent, VisualMapComponent, TitleComponent, CanvasRenderer]);

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'harmonized', label: 'Harmonized' },
  { id: 'modis', label: 'MODIS raw' },
  { id: 'viirs', label: 'VIIRS raw' },
  { id: 'split', label: 'Side-by-side' },
];

export const UNIT_LONG = 'hotspot activity (VIIRS-equivalent fire-cell-days)';
export const UNIT_TIP =
  'A fire-cell-day (FCD) is one 0.01° cell (≈1 km) with at least one cleaned satellite hotspot on one UTC day. ' +
  'MODIS values are scaled to what VIIRS would have seen (VIIRS-equivalent) so 2001–2026 is one consistent series.';

export function Calendar({ h, currentYear }: { h: Harmonized; currentYear: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { viewMode, setViewMode, selected, setSelected, showTable, toggleTable } = useStore();
  const metrics = metricsFor(viewMode);
  const { option, vmin, vmax } = useMemo(() => buildOption({ h, metrics, currentYear, selected }), [h, viewMode, currentYear, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => {
      if (!c.isDisposed()) c.resize();
    });
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      chart.current = null;
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c || c.isDisposed()) return;
    c.setOption(option, { notMerge: true });
    c.off('click');
    c.on('click', (p) => {
      if (p.seriesType !== 'heatmap') return;
      const [m, y] = p.value as [number, string];
      const cur = useStore.getState().selected;
      setSelected(cur?.year === Number(y) && cur.month === m ? null : { year: Number(y), month: m });
    });
  }, [option, setSelected]);

  const caption =
    viewMode === 'harmonized'
      ? 'Darker = more hotspot activity. MODIS-era months are scaled to VIIRS-equivalent, so the record is continuous through 2012.'
      : viewMode === 'split'
        ? 'Left: raw values spliced at Feb 2012 (note the jump when VIIRS takes over). Right: harmonized. Same colour scale.'
        : viewMode === 'modis'
          ? 'Raw MODIS fire-cell-days (Terra + Aqua). Not comparable with VIIRS.'
          : 'Raw VIIRS fire-cell-days: S-NPP, then NOAA-20 after S-NPP ended. VIIRS starts in 2012.';

  return (
    <section className="calendar" aria-label="Burning activity calendar">
      <div className="seg" role="radiogroup" aria-label="Calendar view">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={viewMode === m.id} className={viewMode === m.id ? 'on' : ''} onClick={() => setViewMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="caption">{caption}</p>
      <div ref={el} className={`chart ${viewMode === 'split' ? 'split' : ''}`} />
      <Legend vmin={vmin} vmax={vmax} />
      <div className="calendar-foot">
        <span className="unit" title={UNIT_TIP}>
          Units: {UNIT_LONG} <span aria-hidden>ⓘ</span>
        </span>
        <button className="link" onClick={toggleTable} aria-expanded={showTable}>
          {showTable ? 'Hide table' : 'Show as table'}
        </button>
      </div>
      {selected && (
        <p className="selected">
          Selected: <strong>{MONTHS_SHORT[selected.month]} {selected.year}</strong>{' '}
          <button className="link" onClick={() => setSelected(null)}>
            clear
          </button>
        </p>
      )}
      {showTable && <CalendarTable h={h} metric={metrics[metrics.length - 1]} />}
    </section>
  );
}

function Legend({ vmin, vmax }: { vmin: number; vmax: number }) {
  const ticks = legendTicks(vmin, vmax);
  const grad = `linear-gradient(to right, ${RAMP.join(', ')})`;
  return (
    <div className="legend" aria-label="Colour scale">
      <span className="swatch" style={{ background: ZERO_COLOR }} title="No hotspot activity" />
      <span className="legend-zero">0</span>
      <div className="ramp-wrap">
        <div className="ramp" style={{ background: grad }} />
        <div className="ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(100 * (Math.log10(1 + t) - vmin)) / (vmax - vmin)}%` }}>
              {t >= 1000 ? `${t / 1000}k` : t}
            </span>
          ))}
        </div>
      </div>
      <span className="legend-note">FCD / month (log{vmin > 0 ? '; lighter = at or below the left end' : ''}) · dashed = partial month</span>
    </div>
  );
}

function CalendarTable({ h, metric }: { h: Harmonized; metric: ReturnType<typeof metricsFor>[number] }) {
  return (
    <div className="table-wrap">
      <table>
        <caption>{METRIC_LABEL[metric]}, FCD per month</caption>
        <thead>
          <tr>
            <th scope="col">Year</th>
            {MONTHS_SHORT.map((m) => (
              <th key={m} scope="col">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {h.years.map((y) => (
            <tr key={y}>
              <th scope="row">{y}</th>
              {MONTHS_SHORT.map((_, m) => {
                const r = rowAt(h, y, m);
                const v = r ? valueOf(r, metric) : NaN;
                return <td key={m} className={r?.partial ? 'partial' : ''}>{Number.isFinite(v) ? Math.round(v) : ''}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
