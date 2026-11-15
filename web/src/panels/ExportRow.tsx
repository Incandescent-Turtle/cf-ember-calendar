// Export buttons (PRODUCT.md F5): calendar CSV, summary JSON, calendar PNG.
import { useState } from 'react';
import { area as turfArea, bbox as turfBbox } from '@turf/turf';
import { calendarCsv, dataScope, download, slug, summaryJson } from '../lib/export';
import type { Glance } from '../lib/glance';
import type { CalendarData } from '../data/hooks';
import type { Aoi } from '../store';
import { useStore } from '../store';
import { calendarPng } from '../calendar/png';
import { METRIC_LABEL, metricsFor } from '../calendar/metric';
import { DATA_BASE_URL } from '../data/client';
import { dekadRange } from '../lib/time';
import { HotspotExport } from './HotspotExport';

export function ExportRow({ aoi, data, g, currentYear }: { aoi: Aoi; data: CalendarData; g: Glance; currentYear: number }) {
  const viewMode = useStore((s) => s.viewMode);
  const win = useStore((s) => s.window);
  const [msg, setMsg] = useState('');
  const { harmonized: h, series, manifest } = data;
  const stamp = dekadRange(manifest.dekad_range[1])[1];
  const base = `ember-calendar_${slug(aoi.label)}_${stamp}`;

  const csv = () => download(calendarCsv(h, currentYear), `${base}_calendar.csv`, 'text/csv');
  const json = () =>
    download(
      summaryJson({
        aoi: { label: aoi.label, kind: aoi.kind, geometry: aoi.feature.geometry, bbox: turfBbox(aoi.feature), areaKm2: turfArea(aoi.feature) / 1e6 },
        series, h, g, manifest, dataUrl: new URL(DATA_BASE_URL, location.href).href,
      }),
      `${base}_summary.json`,
      'application/json',
    );
  const png = async () => {
    const view = metricsFor(viewMode).map((m) => METRIC_LABEL[m]).join(' | ');
    const blob = await calendarPng(
      `Burning activity calendar: ${aoi.label}`,
      `${view} · hotspot activity in VIIRS-equivalent fire-cell-days · record ${dekadRange(manifest.dekad_range[0])[0]} to ${stamp}`,
      `Ember Calendar · NASA FIRMS MODIS C6.1 + VIIRS 375 m (S-NPP, NOAA-20), harmonized · data ${dataScope(manifest).text} · built ${manifest.built_at.slice(0, 10)}`,
    );
    if (blob) download(blob, `${base}_calendar.png`, 'image/png');
    else setMsg('The calendar chart is not ready yet.');
  };

  return (
    <section className="export" aria-label="Export">
      <h3>Export</h3>
      <div className="btn-row">
        <button onClick={csv} title="One row per month: year, month, harmonized (+ band), raw MODIS and VIIRS FCD, k, its stratum, percentile">
          Calendar (CSV)
        </button>
        <button onClick={json} title="At-a-glance numbers with their inputs, k per month, the area and the data build">
          Summary (JSON)
        </button>
        <button onClick={png} title="The calendar as shown, with title and legend">
          Calendar (PNG)
        </button>
      </div>
      <HotspotExport key={`${aoi.id}-${win.year}`} aoi={aoi} manifest={manifest} />
      {msg && <p className="caption">{msg}</p>}
    </section>
  );
}
