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
  fetchBurst, fetchFires, fetchReference, type Reference, fetchMeta, fetchObserved, fetchRaster, fetchRuns, fmtUtc, hoursSince, isochrones, rampCss,
  renderRgba, runKey, windAt, type BurstIndex, type FireMeta, type Run,
} from './data';
import { BurstPanel, ShapePanel, WindowScreen } from './Burst';
import { AreaChart } from './AreaChart';
import { RekindleFindings } from './Findings';
import { SpreadChart } from './SpreadChart';
import { Tabs } from '../Tabs';

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
const pct = (x: number | null | undefined) => (typeof x === 'number' ? `${Math.round(x * 100)} %` : '—');

type Mode = 'baseline' | 'whatif';

export function RekindleView() {
  const fires = useQuery({ queryKey: ['rk-fires'], queryFn: fetchFires, staleTime: Infinity });
  const [fireId, setFireId] = useState<string | null>(null);
  const shown = (fires.data?.fires ?? []).filter((f) => !f.hidden);
  const id = fireId ?? shown[0]?.id ?? null;
  const wholeFire = shown.find((f) => f.id === id)?.whole_fire !== false;
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
    return <RkLoaded key={meta.data.id} meta={meta.data} runs={runs.data.runs} observed={observed.data} burst={burst.data ?? null} reference={reference.data ?? null} picker={picker} wholeFire={wholeFire} />;
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
  meta, runs, observed, burst, reference, picker, wholeFire,
}: { meta: FireMeta; runs: Run[]; observed: FeatureCollection; burst: BurstIndex | null; reference: Reference | null; picker: ReactNode; wholeFire: boolean }) {
  const axes = meta.axes;
  const byKey = useMemo(() => new Map(runs.map((r) => [r.key, r])), [runs]);
  const baseline = byKey.get('baseline')!;
  const hours = baseline.burned_km2_by_hour.length - 1;
  const canWhatIf = meta.status === 'validated' && !!axes && runs.length > 1;
  const [mode, setMode] = useState<Mode>('baseline');
  const nearest = (axis: number[], v: number) => axis.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), axis[0]);
  const [ws, setWs] = useState(() => (axes ? nearest(axes.wind_ms, meta.baseline.wind_ms) : 0));
  const [wd, setWd] = useState(() => (axes ? nearest(axes.wind_from_deg, meta.baseline.wind_from_deg) : 0));
  const [mo, setMo] = useState(() => meta.baseline.dead_moisture_pct);
  // Fires without a whole-fire view open on their what-if view (burst window first).
  const initialView: 'whole' | 'burst' | 'shape' = wholeFire ? 'whole' : burst?.windows.length ? 'burst' : burst?.shape ? 'shape' : 'whole';
  const [t, setT] = useState(() =>
    initialView === 'burst' ? Math.round(burst!.windows[0].hours) : initialView === 'shape' ? Math.round(burst!.shape!.hours) : hours,
  );
  const [showBurn, setShowBurn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [compare, setCompare] = useState(true);
  const key = mode === 'baseline' || !canWhatIf ? 'baseline' : runKey(ws, wd, mo);
  const run = byKey.get(key) ?? baseline;
  // S6c burst-window what-ifs (only when a 24 h window qualified) and S6d whole-fire footprint
  // what-ifs (shape only); both exploratory, both use the same run layout.
  const canBurst = !!burst && burst.windows.length > 0;
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
      </div>
      <aside className="panel">
        <Tabs />
        <div className="panel-body">
          {picker}
          {reference && (
            <label className="rk-check">
              <input type="checkbox" checked={showBurn} onChange={(e) => setShowBurn(e.target.checked)} /> Show MODIS burned area (MCD64A1) by burn day, green outline
            </label>
          )}
          {(canBurst || shape) && (wholeFire || (canBurst && shape)) && (
            <div className="seg rk-mode" role="radiogroup" aria-label="View">
              {wholeFire && (
                <button className={view === 'whole' ? 'on' : ''} onClick={() => switchView('whole')} role="radio" aria-checked={view === 'whole'}>
                  Whole fire (hindcast)
                </button>
              )}
              {canBurst && (
                <button className={view === 'burst' ? 'on' : ''} onClick={() => switchView('burst')} role="radio" aria-checked={view === 'burst'}>
                  {burst?.windows[0]?.basis === 'shape' ? 'Window what-if' : 'Burst-window what-if'}{' '}
                  <span className="rk-tag exploratory">{burst?.windows[0]?.basis === 'shape' ? 'SHAPE ONLY' : 'EXPLORATORY'}</span>
                </button>
              )}
              {shape && (
                <button className={view === 'shape' ? 'on' : ''} onClick={() => switchView('shape')} role="radio" aria-checked={view === 'shape'}>
                  Footprint what-if <span className="rk-tag exploratory">SHAPE ONLY</span>
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
            <RkPanel
              {...{ meta, run, baseline, hours, t, setT, playing, setPlaying, mode, setMode, canWhatIf, ws, setWs, wd, setWd, mo, setMo, compare, setCompare, burst, reference }}
              loading={raster.isFetching}
              missing={key !== run.key}
            />
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
  run: Run;
  baseline: Run;
  hours: number;
  t: number;
  setT: (h: number) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  canWhatIf: boolean;
  ws: number;
  setWs: (v: number) => void;
  wd: number;
  setWd: (v: number) => void;
  mo: number;
  setMo: (v: number) => void;
  compare: boolean;
  setCompare: (b: boolean) => void;
  loading: boolean;
  missing: boolean;
  burst: BurstIndex | null;
  reference: Reference | null;
}

function AxisSlider({ label, axis, value, onChange, fmt }: { label: string; axis: number[]; value: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const i = Math.max(0, axis.indexOf(value));
  return (
    <label className="rk-slider">
      <span>
        {label}: <strong>{fmt(value)}</strong>
      </span>
      <input type="range" min={0} max={axis.length - 1} step={1} value={i} onChange={(e) => onChange(axis[Number(e.target.value)])} aria-valuetext={fmt(value)} />
    </label>
  );
}

function RkPanel(p: PanelProps) {
  const { meta, run, baseline, hours, t } = p;
  const v = meta.validation;
  const bm = v.metrics;
  const isBase = run.key === 'baseline';
  const wNow = windAt(meta, t);
  const areaAt = (r: Run) => r.burned_km2_by_hour[Math.min(Math.round(t), r.burned_km2_by_hour.length - 1)];
  const diff = areaAt(run) - areaAt(baseline);
  const shapeCal = meta.status === 'shape_validated' || meta.status === 'shape_poor';
  const statusText =
    meta.status === 'shape_validated'
      ? 'Shape validated: the simulated footprint reaches at least 70 % of the agreement between the two satellite references. Timing is not validated'
      : meta.status === 'shape_poor'
        ? 'Shape below the bar (under 70 % of the satellite references’ own agreement, or references too far apart to judge). Timing not validated'
        : meta.status === 'validated'
      ? 'Baseline passed the quality gate'
      : meta.status === 'poor_agreement'
        ? p.burst?.windows.length
          ? p.burst.windows[0].basis === 'shape'
            ? 'Poor agreement: the baseline did not pass the quality gate. One 24 h window matches the detections in shape, though not in timing (see “Window what-if”, shape only)'
            : 'Poor agreement: the whole-fire baseline did not pass the quality gate, so there are no whole-fire what-ifs. One 24 h window did match (see “Burst-window what-if”, exploratory)'
          : p.burst?.shape
            ? 'Poor agreement on timing: the baseline did not pass the quality gate, but its footprint matches the detections (see “Footprint what-if”, shape only)'
            : 'Poor agreement: the baseline did not pass the quality gate, so no what-if runs are shown'
        : 'Uncalibrated: no detections to check against';

  return (
    <div className="rk">
      <div className="panel-head">
        <h2>Rekindle — {meta.name}</h2>
        <p className="meta">
          Fire-spread hindcast with level-set + Rothermel surface spread, 90 m grid. Precomputed scenarios, surface fire only.
        </p>
      </div>

      <p className={`rk-status ${isBase ? 'hindcast' : 'illustrative'}`} role="status">
        {isBase ? (
          <>
            <strong>Hindcast of a real fire, calibrated to {shapeCal ? 'its satellite-mapped burned area' : 'its detections'}</strong> (observed MERRA-2 wind, ROS ×{' '}
            {meta.baseline.ros_multiplier}). Absolute timings are illustrative.
          </>
        ) : (
          <>
            <strong>Illustrative what-if</strong>: the baseline with a constant {run.wind_ms} m/s wind from {compass(run.wind_from_deg)} and {run.dead_moisture_pct} % dead fuel moisture. Not
            a forecast; compare it with the baseline rather than reading absolute times.
          </>
        )}
        <span className={`rk-badge ${meta.status}`}>{statusText}</span>
      </p>

      {p.canWhatIf && (
        <div className="seg rk-mode" role="radiogroup" aria-label="Run">
          <button className={p.mode === 'baseline' ? 'on' : ''} onClick={() => p.setMode('baseline')} role="radio" aria-checked={p.mode === 'baseline'}>
            Hindcast (observed weather)
          </button>
          <button className={p.mode === 'whatif' ? 'on' : ''} onClick={() => p.setMode('whatif')} role="radio" aria-checked={p.mode === 'whatif'}>
            What-if
          </button>
        </div>
      )}

      {p.canWhatIf && p.mode === 'whatif' && meta.axes && (
        <div className="rk-sliders">
          <AxisSlider label="Wind speed (10 m)" axis={meta.axes.wind_ms} value={p.ws} onChange={p.setWs} fmt={(x) => `${x} m/s`} />
          <AxisSlider label="Wind from" axis={meta.axes.wind_from_deg} value={p.wd} onChange={p.setWd} fmt={(x) => (p.ws === 0 ? 'calm' : `${compass(x)} (${x}°)`)} />
          <AxisSlider label="Dead fuel moisture (1-h)" axis={meta.axes.dead_moisture_pct} value={p.mo} onChange={p.setMo} fmt={(x) => `${x} %`} />
          <label className="rk-check">
            <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} /> Show the baseline’s burned outline (dashed blue)
          </label>
          {p.missing && <p className="warn">This combination wasn’t precomputed; showing the baseline.</p>}
        </div>
      )}

      <div className="rk-time">
        <button onClick={() => (t >= hours ? (p.setT(0), p.setPlaying(true)) : p.setPlaying(!p.playing))} aria-label={p.playing ? 'Pause' : 'Play'}>
          {p.playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={hours} step={1} value={t} onChange={(e) => (p.setPlaying(false), p.setT(Number(e.target.value)))} aria-label="Time since first detection" />
        <span className="rk-clock">
          {fmtUtc(meta.start, t)} <span className="meta">(+{t} h)</span>
        </span>
      </div>
      <div className="rk-legend">
        <span>0 h</span>
        <span className="rk-ramp" style={{ background: rampCss() }} aria-hidden="true" />
        <span>{hours} h after the first detection</span>
      </div>
      <p className="meta">
        Colour = simulated arrival time; thin white lines = simulated burned outline every {hours > 48 ? 12 : 6} h; white dots = FIRMS detections up to the clock time;{' '}
        {p.reference && 'green outline (when switched on) = MODIS MCD64A1 burned area by burn day: day precision, dates can lag under cloud (a second, partly independent reference for shape); '}red = ignition (first overpass,{' '}
        {fmtUtc(meta.start, 0)}). {p.loading && 'Loading run…'}
      </p>
      {isBase && (
        <p className="meta">
          Wind at this hour (MERRA-2): {f1(wNow.speed_ms)} m/s from {compass(wNow.from_deg)} ({Math.round(wNow.from_deg)}°).{' '}
          {meta.moisture?.baseline === 'hourly' ? (
            <>
              Dead fuel moisture follows MERRA-2 humidity hour by hour (1-h fuels {f1(meta.moisture.dead_1h_pct_min)}–{f1(meta.moisture.dead_1h_pct_max)} %, median{' '}
              {f1(meta.moisture.dead_1h_pct_median)} %).
            </>
          ) : (
            <>
              Dead fuel moisture {meta.baseline.dead_moisture_pct} % (estimated from MERRA-2 humidity, median EMC {f1(v.moisture_estimate.emc_pct_median)} %).
            </>
          )}
        </p>
      )}

      <h3>Burned area</h3>
      <p className="caption">
        {isBase ? 'Baseline' : 'This run'}: <strong>{f1(areaAt(run))} km²</strong> by the clock time
        {!isBase && (
          <>
            {' '}
            — {diff >= 0 ? '+' : '−'}
            {f1(Math.abs(diff))} km² vs the baseline ({f1(areaAt(baseline))} km²)
          </>
        )}
        .
      </p>
      <AreaChart start={meta.start} baseline={baseline.burned_km2_by_hour} selected={isBase ? null : run.burned_km2_by_hour} t={t} />

      <h3>How well the baseline matches the detections</h3>
      <table className="rk-metrics">
        <tbody>
          <tr>
            <th scope="row" title="T_sim − t_obs for each pixel’s first detection; negative = the simulation arrives before the satellite saw fire (expected: detections are upper bounds)">
              Timing error, median (IQR)
            </th>
            <td>
              {f1(bm.median_timing_error_h)} h ({f1(bm.iqr_h?.[0])} to {f1(bm.iqr_h?.[1])} h)
            </td>
          </tr>
          <tr>
            <th scope="row">Median |timing error|</th>
            <td>
              {f1(bm.median_abs_timing_error_h)} h (gate: ≤ {f1(v.gate.threshold_h)} h, the mean interval between overpasses)
            </td>
          </tr>
          <tr>
            <th scope="row" title="Share of detections inside the simulated burned area by the next overpass">
              Hit rate
            </th>
            <td>{pct(bm.hit_rate)}</td>
          </tr>
          <tr>
            <th scope="row" title="2|A∩B|/(|A|+|B|), simulated burned area vs union of detection pixel footprints">
              Sørensen overlap
            </th>
            <td>
              {f1(bm.sorensen, 2)} (simulated {f1(bm.area_km2, 0)} km² vs detection footprints {f1(bm.observed_footprint_km2, 0)} km²)
            </td>
          </tr>
          <tr>
            <th scope="row">ROS multiplier</th>
            <td>
              × {meta.baseline.ros_multiplier},{' '}
              {shapeCal ? 'fitted to this fire’s MCD64A1 burned-area shape (calibrated, not a blind test)' : 'fitted on this fire’s own detections (calibrated, not a blind test)'}
            </td>
          </tr>
        </tbody>
      </table>

      {p.reference && <TwoReferences r={p.reference} />}

      {meta.spread_profile && (
        <>
          <h3>Distance from ignition vs time</h3>
          <SpreadChart profile={meta.spread_profile} mult={meta.baseline.ros_multiplier} />
        </>
      )}

      {p.burst && <WindowScreen burst={p.burst} />}

      <details className="rk-details" open={meta.status !== 'validated'}>
        <summary>Limits / what validation showed</summary>
        <RekindleFindings headingLevel={4} />
      </details>

      <details className="rk-details">
        <summary>Intended use and limits</summary>
        <p>
          Explore how wind and fuel dryness change the spread of a real past fire, as a step toward planning tools. This is not a forecast: it uses past weather, a fixed set of precomputed
          scenarios and no live perimeter.
        </p>
        <p>{meta.notes}</p>
        <ul>
          {meta.prep_notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>

      <div className="rk-credits">
        <strong>Data:</strong>{' '}
        {meta.credits.map((c, i) => (
          <span key={c.id}>
            {i > 0 && ' · '}
            <a href={c.url} target="_blank" rel="noreferrer" title={c.citation}>
              {c.short}
            </a>
          </span>
        ))}
        . {meta.credits.find((c) => c.id === 'copdem')?.citation}.
        <details>
          <summary>Full citations</summary>
          <ul>
            {meta.credits.map((c) => (
              <li key={c.id}>
                <em>{c.use}:</em> {c.citation}
                {c.access ? ` ${c.access}` : ''}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}


/** S6h: shape against MCD64A1 burned area, timing against hotspots (fair interval). */
function TwoReferences({ r }: { r: Reference }) {
  const t = r.timing_vs_hotspots;
  return (
    <>
      <h3>Judged against two satellite references</h3>
      <p className="meta">
        Hotspots say <em>when</em> fire was seen; MODIS burned area (MCD64A1, 500 m) says <em>where</em> it burned. Neither is ground truth, so the model is compared with both, and with how
        well they agree with each other. Whole simulation domain, against burned patches connected to this fire’s hotspots.
      </p>
      <table className="rk-metrics">
        <tbody>
          <tr>
            <th scope="row" title="Sørensen overlap of the simulated burned area with MCD64A1 burned area in the run period">
              Shape vs burned area (MCD64A1)
            </th>
            <td>
              Sørensen {f1(r.sorensen_model_vs_mcd64, 2)} (model {f1(r.model_km2, 0)} km² vs burned area {f1(r.mcd64_km2, 0)} km²)
            </td>
          </tr>
          <tr>
            <th scope="row" title="How well the two satellite references agree with each other: the most a model could be expected to reach">
              Hotspots vs burned area (the ceiling)
            </th>
            <td>Sørensen {f1(r.sorensen_hotspots_vs_mcd64, 2)}</td>
          </tr>
          <tr>
            <th scope="row" title="Zero when the simulated arrival falls between the last overpass before the detection and the detection itself">
              Timing vs hotspots, fair interval
            </th>
            <td>
              median {f1(t.censored_median_h)} h (raw {f1(t.median_abs_h)} h; {pct(t.inside_interval)} inside the interval; gate {f1(t.gate_h)} h)
            </td>
          </tr>
          <tr>
            <th scope="row" title="Share of pixels whose day differs by at most one from the MCD64A1 burn day">Burn day within ±1 day</th>
            <td>
              hotspots {pct(r.detection_minus_burn_day.within_1_day)}, model {pct(r.model_minus_burn_day.within_1_day)}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
