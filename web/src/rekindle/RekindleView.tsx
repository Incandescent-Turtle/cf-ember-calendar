// Rekindle tab: precomputed hindcast + illustrative what-if runs for a curated past fire
// (docs/REKINDLE.md §6, CONTRACTS.md "Rekindle files"). Nothing is simulated in the browser.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, ImageSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection } from 'geojson';
import {
  fetchBurst, fetchFires, fetchReference, type Reference, fetchMeta, fetchObserved, fetchRaster, fetchRuns, fmtUtc, hoursSince, isochrones,
  renderRgba, windAt, type BurstIndex, type FireMeta, type Run,
} from './data';
import { BurstPanel, ShapePanel } from './Burst';
import { RkLegend, TimeBar } from './Controls';
import { linkTo } from '../route';
import { AreaChart } from './AreaChart';
import { Tabs } from '../Tabs';
import { useStore } from '../store';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const STYLE_URL =
  (import.meta.env.VITE_BASEMAP_STYLE_URL as string | undefined) || 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const SENSOR: Record<string, string> = {
  VIIRS_NOAA20: 'VIIRS NOAA-20', VIIRS_SNPP: 'VIIRS S-NPP', VIIRS_NOAA21: 'VIIRS NOAA-21', MODIS_TERRA: 'MODIS Terra', MODIS_AQUA: 'MODIS Aqua',
};
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];
const f1 = (x: number | null | undefined, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');

export function RekindleView() {
  const fires = useQuery({ queryKey: ['rk-fires'], queryFn: fetchFires, staleTime: Infinity });
  const [fireId, setFireId] = useState<string | null>(null);
  const shown = (fires.data?.fires ?? []).filter((f) => !f.hidden);
  const id = fireId ?? shown[0]?.id ?? null;
  const wholeFire = shown.find((f) => f.id === id)?.whole_fire !== false;
  const burstWindow = shown.find((f) => f.id === id)?.burst_window !== false;
  const meta = useQuery({ queryKey: ['rk-meta', id], queryFn: () => fetchMeta(id!), enabled: !!id, staleTime: Infinity });
  const runs = useQuery({ queryKey: ['rk-runs', id], queryFn: () => fetchRuns(id!), enabled: !!id, staleTime: Infinity });
  const observed = useQuery({ queryKey: ['rk-obs', id], queryFn: () => fetchObserved(id!), enabled: !!id, staleTime: Infinity });
  const burst = useQuery({ queryKey: ['rk-burst', id], queryFn: () => fetchBurst(id!).catch(() => null), enabled: !!id, staleTime: Infinity });
  const reference = useQuery({ queryKey: ['rk-ref', id], queryFn: () => fetchReference(id!).catch(() => null), enabled: !!id, staleTime: Infinity });
  const err = fires.error ?? meta.error ?? runs.error ?? observed.error;
  if (meta.data && runs.data && observed.data && burst.isFetched && reference.isFetched) {
    const picker =
      shown.length > 1 ? (
        <label className="rk-fire-pick">
          Fire:
          <select value={id ?? ''} onChange={(e) => setFireId(e.target.value)} className="rk-fire-select">
            {shown.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      ) : null;
    return <RkLoaded key={meta.data.id} meta={meta.data} runs={runs.data.runs} observed={observed.data} burst={burst.data ?? null} reference={reference.data ?? null} picker={picker} wholeFire={wholeFire} burstWindow={burstWindow} />;
  }
  return (
    <main className="main">
      <div className="map-wrap" />
      <aside className="panel">
        <Tabs />
        {err ? <p className="error">Couldn’t load the Rekindle files: {(err as Error).message}</p> : <p className="loading">Loading…</p>}
      </aside>
    </main>
  );
}

function RkLoaded({
  meta, runs, observed, burst, reference, picker, wholeFire, burstWindow,
}: {
  meta: FireMeta;
  runs: Run[];
  observed: FeatureCollection;
  burst: BurstIndex | null;
  reference: Reference | null;
  picker: ReactNode;
  wholeFire: boolean;
  burstWindow: boolean;
}) {
  const byKey = useMemo(() => new Map(runs.map((r) => [r.key, r])), [runs]);
  const baseline = byKey.get('baseline')!;
  const hours = baseline.burned_km2_by_hour.length - 1;
  // Fires without a whole-fire view open on their what-if view (burst window first).
  const hasWindows = burstWindow && !!burst?.windows.length;
  const initialView: 'whole' | 'burst' | 'shape' = wholeFire ? 'whole' : hasWindows ? 'burst' : burst?.shape ? 'shape' : 'whole';
  const [t, setT] = useState(() =>
    initialView === 'burst' ? Math.round(burst!.windows[0].hours) : initialView === 'shape' ? Math.round(burst!.shape!.hours) : hours,
  );
  const [showBurn, setShowBurn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [compare, setCompare] = useState(true);
  // The whole-fire view shows the hindcast only (the old validated-grid what-if UI is retired).
  const run = baseline;
  // S6c burst-window what-ifs (only when a 24 h window qualified) and S6d whole-fire footprint
  // what-ifs (shape only); both exploratory, both use the same run layout.
  const canBurst = hasWindows && !!burst;
  const shape = burst?.shape ?? null;
  const [view, setView] = useState<'whole' | 'burst' | 'shape'>(initialView);
  const [bwi, setBwi] = useState(0);
  const [bScale, setBScale] = useState(1);
  const [bDpp, setBDpp] = useState(0);
  const bWin = view === 'shape' ? shape : canBurst && view === 'burst' ? burst.windows[Math.min(bwi, burst.windows.length - 1)] : null;
  const bBase = bWin?.runs.find((r) => r.wind_scale === 1 && r.dead_delta_pct === 0) ?? null;
  const bRun = bWin ? (bWin.runs.find((r) => r.wind_scale === bScale && r.dead_delta_pct === bDpp) ?? bBase) : null;
  const inBurst = view !== 'whole' && !!bWin && !!bRun && !!bBase;
  const hoursNow = inBurst ? Math.round(bWin.hours) : hours;
  const size = meta.raster.width * meta.raster.height;
  const file = inBurst ? bRun.file : run.file;
  const baseFile = inBurst ? bBase.file : baseline.file;
  const raster = useQuery({ queryKey: ['rk-raster', meta.id, file], queryFn: () => fetchRaster(meta.id, file, size), staleTime: Infinity });
  const baseRaster = useQuery({ queryKey: ['rk-raster', meta.id, baseFile], queryFn: () => fetchRaster(meta.id, baseFile, size), staleTime: Infinity });
  const mcd = useQuery({
    queryKey: ['rk-raster', meta.id, 'mcd64'],
    queryFn: () => fetchRaster(meta.id, 'mcd64.u16.gz', size).catch(() => null),
    enabled: !!reference && showBurn,
    staleTime: Infinity,
  });
  const showBase = inBurst ? compare && bRun.key !== bBase.key : compare && run.key !== 'baseline';

  const switchView = (v: 'whole' | 'burst' | 'shape') => {
    setPlaying(false);
    setView(v);
    setBScale(1);
    setBDpp(0);
    const w = v === 'shape' ? shape : v === 'burst' && canBurst ? burst.windows[0] : null;
    setT(w ? Math.round(w.hours) : hours);
  };

  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round(hoursNow / 60));
    const id = setInterval(() => setT((x) => (x >= hoursNow ? (setPlaying(false), hoursNow) : Math.min(hoursNow, x + step))), 120);
    return () => clearInterval(id);
  }, [playing, hoursNow]);

  return (
    <main className="main">
      <div className="map-wrap">
        <RkMap
          meta={meta}
          minutes={raster.data ?? null}
          baseMinutes={showBase ? (baseRaster.data ?? null) : null}
          t={t}
          hours={hoursNow}
          observed={observed}
          offsetH={inBurst ? bWin.start_h_after_t0 : 0}
          mcdMinutes={showBurn ? (mcd.data ?? null) : null}
          showIgnitions={view !== 'burst'}
        />
        <RkLegend
          hours={hoursNow}
          from={inBurst && view === 'burst' ? 'the window start' : 'the first detection'}
          isoStepH={hoursNow > 48 ? 12 : 6}
          showIgnitions={view !== 'burst'}
          showBase={showBase}
          burnAvailable={!!reference}
          showBurn={showBurn}
          setShowBurn={setShowBurn}
        />
      </div>
      <aside className="panel">
        <Tabs />
        <div className="panel-body">
          {picker}
          {(canBurst || shape) && (wholeFire || (canBurst && shape)) && (
            <div className="seg rk-mode" role="radiogroup" aria-label="View">
              {wholeFire && (
                <button className={view === 'whole' ? 'on' : ''} onClick={() => switchView('whole')} role="radio" aria-checked={view === 'whole'}>
                  Hindcast
                </button>
              )}
              {canBurst && (
                <button className={view === 'burst' ? 'on' : ''} onClick={() => switchView('burst')} role="radio" aria-checked={view === 'burst'}>
                  24-hour simulation
                </button>
              )}
              {shape && (
                <button className={view === 'shape' ? 'on' : ''} onClick={() => switchView('shape')} role="radio" aria-checked={view === 'shape'}>
                  Whole fire (shape)
                </button>
              )}
            </div>
          )}
          {inBurst && view === 'shape' && shape ? (
            <ShapePanel
              fireId={meta.id}
              shape={shape}
              run={bRun}
              base={bBase}
              scale={bScale}
              setScale={setBScale}
              dpp={bDpp}
              setDpp={setBDpp}
              compare={compare}
              setCompare={setCompare}
              t={t}
              setT={setT}
              playing={playing}
              setPlaying={setPlaying}
              loading={raster.isFetching}
            />
          ) : inBurst ? (
            <BurstPanel
              burst={burst!}
              win={bWin}
              setWin={(i) => {
                setBwi(i);
                setT(Math.round(burst!.windows[i].hours));
              }}
              run={bRun}
              base={bBase}
              scale={bScale}
              setScale={setBScale}
              dpp={bDpp}
              setDpp={setBDpp}
              compare={compare}
              setCompare={setCompare}
              t={t}
              setT={setT}
              playing={playing}
              setPlaying={setPlaying}
              loading={raster.isFetching}
            />
          ) : (
            <RkPanel {...{ meta, baseline, hours, t, setT, playing, setPlaying, reference }} loading={raster.isFetching} />
          )}
        </div>
      </aside>
    </main>
  );
}

function RkMap({
  meta, minutes, baseMinutes, t, hours, observed, offsetH = 0, showIgnitions = true, mcdMinutes = null,
}: {
  meta: FireMeta;
  minutes: Uint16Array | null;
  baseMinutes: Uint16Array | null;
  t: number;
  hours: number;
  observed: FeatureCollection;
  offsetH?: number;
  showIgnitions?: boolean;
  mcdMinutes?: Uint16Array | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const canvas = useMemo(() => document.createElement('canvas'), []);
  const [w, s, e, n] = meta.raster.bounds_lonlat;
  const coords: [[number, number], [number, number], [number, number], [number, number]] = [[w, n], [e, n], [e, s], [w, s]];

  useEffect(() => {
    const map = new maplibregl.Map({ container: container.current!, style: STYLE_URL, bounds: meta.raster.bounds_lonlat, fitBoundsOptions: { padding: 20 }, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', () => {
      // Satellite basemap (shared toggle with the calendar map), under the labels and the fire layers.
      map.addSource('satellite', {
        type: 'raster',
        tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
        tileSize: 256,
        maxzoom: 15,
        attribution:
          '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless 2020</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)',
      });
      const firstLabel = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: useStore.getState().satellite ? 'visible' : 'none' } }, firstLabel);
      const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      map.addSource('rk-arrival', { type: 'image', url: blank, coordinates: coords });
      map.addLayer({ id: 'rk-arrival', type: 'raster', source: 'rk-arrival', paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } });
      map.addSource('rk-iso', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'rk-iso', type: 'line', source: 'rk-iso', paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.75 } });
      map.addSource('rk-mcd', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'rk-mcd-casing', type: 'line', source: 'rk-mcd', paint: { 'line-color': '#062b12', 'line-width': 4.5, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'rk-mcd', type: 'line', source: 'rk-mcd', paint: { 'line-color': '#4ade80', 'line-width': 2.2 } });
      map.addSource('rk-base', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'rk-base', type: 'line', source: 'rk-base', paint: { 'line-color': '#1f6fb2', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      map.addSource('rk-obs', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'rk-obs', type: 'circle', source: 'rk-obs',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 5], 'circle-color': '#ffffff', 'circle-stroke-color': '#1f1f1f', 'circle-stroke-width': 1 },
      });
      map.addSource('rk-ign', { type: 'geojson', data: { type: 'FeatureCollection', features: meta.ignitions.map((g) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [g.lon, g.lat] } })) } });
      map.addLayer({ id: 'rk-ign', type: 'circle', source: 'rk-ign', paint: { 'circle-radius': 4, 'circle-color': '#d7301f', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' });
      map.on('click', 'rk-obs', (ev) => {
        const p = ev.features?.[0]?.properties as { t: string; sensor: string; frp: number; scan: number; track: number } | undefined;
        if (!p) return;
        const h = hoursSince(meta.start, p.t);
        popup
          .setLngLat(ev.lngLat)
          .setHTML(`<strong>${SENSOR[p.sensor] ?? p.sensor}</strong><br>${fmtUtc(meta.start, h)} (+${h.toFixed(1)} h)<br>FRP ${p.frp} MW · pixel ${p.scan}×${p.track} km`)
          .addTo(map);
      });
      map.on('mouseenter', 'rk-obs', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'rk-obs', () => (map.getCanvas().style.cursor = ''));
      setLoaded(true);
    });
    mapRef.current = map;
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  // Arrival-time image (cells reached by t).
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !minutes) return;
    canvas.width = meta.raster.width;
    canvas.height = meta.raster.height;
    const ctx = canvas.getContext('2d')!;
    const img = new ImageData(renderRgba(minutes, t * 60, hours * 60) as Uint8ClampedArray<ArrayBuffer>, meta.raster.width, meta.raster.height);
    ctx.putImageData(img, 0, 0);
    (map.getSource('rk-arrival') as ImageSource).updateImage({ url: canvas.toDataURL(), coordinates: coords });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, minutes, t, hours]);

  // Isochrones (client-side, d3-contour): every 6 h up to t, plus t itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !minutes) return;
    const step = hours > 48 ? 12 : 6;
    const th = [];
    for (let h = step; h < t; h += step) th.push(h * 60);
    th.push(t * 60);
    (map.getSource('rk-iso') as GeoJSONSource).setData(isochrones(minutes, meta.raster, th));
  }, [loaded, minutes, t, hours, meta.raster]);

  // Baseline outline at t (what-if runs only).
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    (map.getSource('rk-base') as GeoJSONSource).setData(baseMinutes ? isochrones(baseMinutes, meta.raster, [t * 60]) : EMPTY);
  }, [loaded, baseMinutes, t, meta.raster]);

  // Observed hotspots up to t.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const fc = { ...observed, features: observed.features.filter((f) => hoursSince(meta.start, (f.properties as { t: string }).t) <= offsetH + t + 1e-6) };
    (map.getSource('rk-obs') as GeoJSONSource).setData(fc);
  }, [loaded, observed, t, meta.start, offsetH]);

  const satellite = useStore((s) => s.satellite);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !map.getLayer('satellite')) return;
    map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none');
  }, [loaded, satellite]);

  // MCD64A1 burned area (second reference, S6h): outline of cells burned in the run period.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    // burn day ≤ the clock time (day precision; cells are 0 at 00:00 UTC of their burn day)
    (map.getSource('rk-mcd') as GeoJSONSource).setData(mcdMinutes ? isochrones(mcdMinutes, meta.raster, [Math.max((offsetH + t) * 60, 1)]) : EMPTY);
  }, [loaded, mcdMinutes, meta.raster, offsetH, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    map.setLayoutProperty('rk-ign', 'visibility', showIgnitions ? 'visible' : 'none');
  }, [loaded, showIgnitions]);

  return <div ref={container} className="map" aria-label="Rekindle map" />;
}

interface PanelProps {
  meta: FireMeta;
  baseline: Run;
  hours: number;
  t: number;
  setT: (h: number) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
  loading: boolean;
  reference: Reference | null;
}

/** Whole-fire hindcast: show the animation and explain it. Validation details live on /methodology. */
function RkPanel(p: PanelProps) {
  const { meta, baseline, hours, t } = p;
  const shapeCal = meta.status === 'shape_validated' || meta.status === 'shape_poor';
  const wNow = windAt(meta, t);
  const area = baseline.burned_km2_by_hour[Math.min(Math.round(t), baseline.burned_km2_by_hour.length - 1)];
  const r = p.reference;
  return (
    <div className="rk">
      <div className="panel-head">
        <h2>{meta.name}</h2>
      </div>
      <p className="rk-status hindcast" role="status">
        <strong>Hindcast of a real fire, calibrated to {shapeCal ? 'its satellite-mapped burned area' : 'its detections'}.</strong> Illustrative: the timing is not validated.
        {meta.status === 'shape_validated' && <> Its burned shape matches MODIS burned area well enough to pass our shape test.</>}
      </p>

      <TimeBar t={t} setT={p.setT} hours={hours} playing={p.playing} setPlaying={p.setPlaying} clock={fmtUtc(meta.start, t)} label="Time since the first detection" />

      <h3>What you are seeing</h3>
      <p className="rk-intro">
        The colours show the simulated fire spreading hour by hour from the first satellite detection (red), driven by the real terrain, vegetation and hourly weather. White dots are the
        real satellite hotspots, appearing as the clock runs, so you can compare the model with what was observed. {p.loading && 'Loading…'}
      </p>
      <p className="meta">
        Now: wind {f1(wNow.speed_ms)} m/s from {compass(wNow.from_deg)} · simulated burned area <strong>{f1(area)} km²</strong>
      </p>

      <h3>Burned area over time</h3>
      <AreaChart start={meta.start} baseline={baseline.burned_km2_by_hour} selected={null} t={t} baseLabel="Simulated burned area" />

      {r && (
        <p className="meta">
          How close is it? Shape overlap with MODIS burned area {f1(r.sorensen_model_vs_mcd64, 2)} (the two satellite records agree at {f1(r.sorensen_hotspots_vs_mcd64, 2)}).{' '}
          <a href="/methodology" onClick={linkTo('methodology')}>How we test the model</a>.
        </p>
      )}

      <details className="rk-details">
        <summary>Model and data</summary>
        <p>
          Rothermel surface spread on a 90 m level-set grid; fuels from MODIS land cover, terrain from NASADEM/Copernicus, hourly MERRA-2 wind and humidity. Surface fire only: no
          crowning, spotting or firefighting. Not a forecast.
        </p>
        <p className="rk-credits">
          <strong>Data:</strong>{' '}
          {meta.credits.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ' · '}
              <a href={c.url} target="_blank" rel="noreferrer" title={c.citation}>
                {c.short}
              </a>
            </span>
          ))}
        </p>
      </details>
    </div>
  );
}
