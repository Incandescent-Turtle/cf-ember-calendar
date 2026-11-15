import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 resolves its (self-contained) worker relative to its own module URL, which breaks once
// bundled. Emit it as an asset and point MapLibre at it explicitly (works in dev and in the build).
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { bbox as turfBbox } from '@turf/turf';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { newAoiId, useStore } from '../store';
import { AoiTools } from './AoiTools';
import { TimeControl } from './TimeControl';
import { pointsEligible, useDensity, useManifest, usePoints, type MapViewport } from '../data/hooks';
import {
  CONF_NAME, densityGeoJson, densityTooltipHtml, type DensityProps, fmtMinutes, pointsGeoJson, rampExpression, SENSOR_NAME, sensorColorExpression,
} from './layers';

const STYLE_URL =
  (import.meta.env.VITE_BASEMAP_STYLE_URL as string | undefined) ||
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<MapViewport>({ zoom: 1.4, bbox: [-180, -85, 180, 85] });
  const aoi = useStore((s) => s.aoi);
  const drawMode = useStore((s) => s.drawMode);
  const win = useStore((s) => s.window);
  const showPoints = useStore((s) => s.showPoints);
  const manifest = useManifest();
  const density = useDensity(aoi, win, view);
  const densityLayer = useMemo(() => (density.data ? densityGeoJson(density.data) : null), [density.data]);
  const densityRef = useRef(densityLayer);
  useEffect(() => {
    densityRef.current = densityLayer;
  }, [densityLayer]);
  const pointsWhy = pointsEligible(aoi, win, manifest.data, view);
  const points = usePoints(aoi, win, showPoints, view);
  const pointsFc = useMemo(() => (points.data ? pointsGeoJson(points.data) : null), [points.data]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      center: [-30, 0],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const syncView = () => {
      const b = map.getBounds();
      setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
    };
    map.on('moveend', syncView);
    map.once('load', syncView);
    map.on('load', () => {
      map.addSource('density', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'density-fill',
        type: 'fill',
        source: 'density',
        paint: { 'fill-color': '#888', 'fill-opacity': 0.78, 'fill-antialias': false },
      });
      map.addSource('aoi', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi', paint: { 'fill-color': '#1f6fb2', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#1f6fb2', 'line-width': 2 } });
      // Clustered up to zoom 8 (count bubbles), individual dots from zoom 9.
      map.addSource('points', { type: 'geojson', data: EMPTY, cluster: true, clusterMaxZoom: 8, clusterRadius: 40, clusterMinPoints: 3 });
      map.addLayer({
        id: 'points-cluster',
        type: 'circle',
        source: 'points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#2b2b2b',
          'circle-opacity': 0.72,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.2,
          'circle-radius': ['step', ['get', 'point_count'], 9, 25, 12, 200, 16, 1000, 21],
        },
      });
      map.addLayer({
        id: 'points-count',
        type: 'symbol',
        source: 'points',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Montserrat SemiBold', 'Open Sans Bold', 'Noto Sans Regular'],
          'text-size': 11,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'points',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': sensorColorExpression,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 7, 2.5, 11, 5],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0, 9, 0.6],
          'circle-opacity': 0.9,
        },
      });
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' });
      map.on('click', 'points', (e) => {
        if (useStore.getState().drawMode !== 'none') return;
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { s: number; frp: number; t: number; conf: number };
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${SENSOR_NAME[p.s] ?? 'Unknown sensor'}</b><br/>${fmtMinutes(p.t)}<br/>FRP ${Number(p.frp).toFixed(1)} MW · confidence ${CONF_NAME[p.conf] ?? '—'}<br/><span class="tt-dim">cleaned FIRMS detection</span>`,
          )
          .addTo(map);
      });
      map.on('click', 'points-cluster', async (e) => {
        const f = e.features?.[0];
        if (!f || useStore.getState().drawMode !== 'none') return;
        const z = await (map.getSource('points') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id as number);
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.2 });
      });
      map.on('click', 'density-fill', (e) => {
        if (useStore.getState().drawMode !== 'none') return;
        if (map.queryRenderedFeatures(e.point, { layers: ['points', 'points-cluster'] }).length) return;
        const f = e.features?.[0];
        if (!f) return;
        const layer = densityRef.current;
        if (!layer) return;
        const p = f.properties as DensityProps;
        popup.setLngLat(e.lngLat).setHTML(densityTooltipHtml({ v: Number(p.v), lv: Number(p.lv), m: Number(p.m), vi: Number(p.vi) }, layer, useStore.getState().window))
          .addTo(map);
      });
      for (const id of ['points', 'points-cluster', 'density-fill']) {
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
      }
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawRectangleMode(), new TerraDrawPolygonMode()],
      });
      draw.start();
      draw.on('finish', (id) => {
        const f = draw.getSnapshotFeature(id);
        if (!f || f.geometry.type !== 'Polygon') return;
        const kind = draw.getMode() === 'rectangle' ? 'rectangle' : 'polygon';
        draw.clear();
        draw.setMode('static');
        useStore.getState().setAoi({
          id: newAoiId(),
          kind,
          label: kind === 'rectangle' ? 'Drawn rectangle' : 'Drawn polygon',
          feature: { type: 'Feature', properties: {}, geometry: f.geometry as Polygon } as Feature<Polygon>,
        });
      });
      drawRef.current = draw;
      loadedRef.current = true;
      setLoaded(true);
      // sync with any state set before load
      const s = useStore.getState();
      if (s.aoi) showAoi(map, s.aoi.feature, false);
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map; // e2e checks
    return () => {
      loadedRef.current = false;
      setLoaded(false);
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (aoi) showAoi(map, aoi.feature, true);
    else (map.getSource('aoi') as GeoJSONSource | undefined)?.setData(EMPTY);
  }, [aoi]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource('density') as GeoJSONSource | undefined;
    if (!densityLayer || !src) {
      src?.setData(EMPTY);
      return;
    }
    src.setData(densityLayer.fc);
    map.setPaintProperty('density-fill', 'fill-color', rampExpression(densityLayer.vmin, densityLayer.vmax));
  }, [densityLayer, loaded]);

  const pointsOn = showPoints && !pointsWhy && !!pointsFc;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource('points') as GeoJSONSource | undefined)?.setData(pointsOn ? pointsFc! : EMPTY);
    // fade the cells under visible points so the dots read
    map.setPaintProperty('density-fill', 'fill-opacity', pointsOn && pointsFc!.features.length > 0 ? 0.35 : 0.78);
  }, [pointsFc, pointsOn, loaded]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.clear();
    draw.setMode(drawMode === 'none' ? 'static' : drawMode);
  }, [drawMode]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <AoiTools />
      <TimeControl
        density={densityLayer}
        densityLoading={density.isFetching}
        level={density.data?.level ?? null}
        points={points.data}
        pointsLoading={points.isFetching}
        pointsWhy={pointsWhy}
        pointsError={points.error as Error | null}
      />
    </div>
  );
}

function showAoi(map: maplibregl.Map, feature: Feature, fly: boolean) {
  (map.getSource('aoi') as GeoJSONSource | undefined)?.setData(feature);
  const [w, s, e, n] = turfBbox(feature);
  map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: 60, duration: fly ? 900 : 0, maxZoom: 9 },
  );
}
