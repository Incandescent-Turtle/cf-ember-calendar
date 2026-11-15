import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { bbox as turfBbox } from '@turf/turf';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { newAoiId, useStore } from '../store';
import { AoiTools } from './AoiTools';

const STYLE_URL =
  (import.meta.env.VITE_BASEMAP_STYLE_URL as string | undefined) ||
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const aoi = useStore((s) => s.aoi);
  const drawMode = useStore((s) => s.drawMode);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      center: [-30, 0],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('aoi', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi', paint: { 'fill-color': '#1f6fb2', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#1f6fb2', 'line-width': 2 } });
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
      // sync with any state set before load
      const s = useStore.getState();
      if (s.aoi) showAoi(map, s.aoi.feature, false);
    });
    mapRef.current = map;
    return () => {
      drawRef.current?.stop();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource('aoi')) return;
    if (aoi) showAoi(map, aoi.feature, true);
    else (map.getSource('aoi') as GeoJSONSource).setData(EMPTY);
  }, [aoi]);

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
