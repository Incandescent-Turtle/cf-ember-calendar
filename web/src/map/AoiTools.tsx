import { useQuery } from '@tanstack/react-query';
import { area } from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { useState } from 'react';
import { newAoiId, useStore } from '../store';
import { setCircleAoi } from './aoiActions';
import { PlaceSearch } from './PlaceSearch';

type Country = Feature<Polygon | MultiPolygon, { name: string; iso: string }>;

/** Same-origin static file (web/public/countries.geojson). */
const useCountries = () =>
  useQuery({
    queryKey: ['countries'],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}countries.geojson`);
      if (!r.ok) throw new Error(`countries: ${r.status}`);
      return ((await r.json()) as FeatureCollection<Polygon | MultiPolygon, { name: string; iso: string }>).features as Country[];
    },
  });

export function AoiTools() {
  const { aoi, drawMode, setDrawMode, setAoi, satellite, setSatellite } = useStore();
  const countries = useCountries();
  const [lat, setLat] = useState('-29.15');
  const [lon, setLon] = useState('-67.70');
  const [radius, setRadius] = useState('25');

  const km2 = aoi ? area(aoi.feature) / 1e6 : 0;
  const submitCircle = (e: React.FormEvent) => {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    const r = Number(radius);
    if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180 && r > 0 && r <= 2000)) return;
    setCircleAoi(lo, la, r, `${la.toFixed(2)}, ${lo.toFixed(2)} · ${r} km`);
  };

  return (
    <div className="aoi-tools" role="toolbar" aria-label="Area of interest tools">
      <PlaceSearch />
      <div className="btn-row">
        <button className={drawMode === 'rectangle' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'rectangle' ? 'none' : 'rectangle')}>
          ▭ Rectangle
        </button>
        <button className={drawMode === 'polygon' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'polygon' ? 'none' : 'polygon')}>
          ⬠ Polygon
        </button>
        <button className={drawMode === 'circle' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'circle' ? 'none' : 'circle')}>
          ◎ Point + radius
        </button>
        {aoi && (
          <button onClick={() => setAoi(null)} aria-label="Clear area">
            ✕
          </button>
        )}
      </div>
      {drawMode === 'rectangle' && <p className="hint">Press and drag, or click two opposite corners. Esc to cancel.</p>}
      {drawMode === 'polygon' && <p className="hint">Click each corner; click the first point to close. Esc to cancel.</p>}
      {drawMode === 'circle' && (
        <p className="hint">Press at the centre and drag out to the radius, or click the centre then the edge. Esc to cancel. Or type it:</p>
      )}
      {drawMode === 'circle' && (
        <form className="radius-form" onSubmit={submitCircle}>
          <label>
            Lat <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" size={7} />
          </label>
          <label>
            Lon <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" size={7} />
          </label>
          <label>
            km <input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" size={4} />
          </label>
          <button type="submit">Go</button>
        </form>
      )}
      <label className="sat-toggle">
        <input type="checkbox" checked={satellite} onChange={(e) => setSatellite(e.target.checked)} /> Satellite imagery
      </label>
      <select
        aria-label="Country"
        value={aoi?.kind === 'country' ? aoi.label : ''}
        onChange={(e) => {
          const f = countries.data?.find((c) => c.properties.name === e.target.value);
          if (f) setAoi({ id: newAoiId(), kind: 'country', label: f.properties.name, feature: f });
        }}
      >
        <option value="">{countries.isLoading ? 'Loading countries…' : 'Pick a country…'}</option>
        {countries.data?.map((c) => (
          <option key={c.properties.iso + c.properties.name} value={c.properties.name}>
            {c.properties.name}
          </option>
        ))}
      </select>
      {aoi && (
        <p className="aoi-label">
          <strong>{aoi.label}</strong> · {km2 < 10 ? km2.toFixed(1) : Math.round(km2).toLocaleString('en-US')} km²
        </p>
      )}
    </div>
  );
}
