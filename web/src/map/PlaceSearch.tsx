// Place search (Photon, OpenStreetMap geocoder: no key, CORS-enabled; queries go to photon.komoot.io).
// Picking a result flies the map there; results with an extent can become the area of interest.
import { bboxPolygon } from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { useEffect, useRef, useState } from 'react';
import { newAoiId, useStore } from '../store';

interface Hit {
  label: string;
  center: [number, number];
  bbox?: [number, number, number, number];
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; state?: string; country?: string; type?: string; extent?: [number, number, number, number] };
}

const PHOTON = 'https://photon.komoot.io/api/';

function toHit(f: PhotonFeature): Hit {
  const p = f.properties;
  const parts = [p.name, p.city !== p.name ? p.city : undefined, p.state, p.country].filter(Boolean);
  const e = p.extent; // [west, north, east, south]
  return { label: parts.join(', '), center: f.geometry.coordinates, bbox: e ? [e[0], e[3], e[2], e[1]] : undefined };
}

export function PlaceSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const picked = useRef<string | null>(null); // the label we filled in after a pick: don't search it again

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3 || text === picked.current) return;
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const r = await fetch(`${PHOTON}?q=${encodeURIComponent(text)}&limit=6&lang=en`, { signal: ac.signal });
        if (!r.ok) throw new Error(`search ${r.status}`);
        const j = (await r.json()) as { features: PhotonFeature[] };
        setHits(j.features.map(toHit));
        setErr(null);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErr('Search is unavailable right now.');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim().length < 3 ? [] : hits;
  const go = (h: Hit) => {
    useStore.getState().requestFlyTo(h.bbox ? { bbox: h.bbox } : { center: h.center });
    setOpen(false);
    picked.current = h.label;
    setQ(h.label);
  };
  const select = (h: Hit) => {
    if (!h.bbox) return;
    useStore.getState().setAoi({ id: newAoiId(), kind: 'rectangle', label: h.label, feature: bboxPolygon(h.bbox) as Feature<Polygon> });
    go(h);
  };

  return (
    <div className="place-search">
      <input
        type="search"
        value={q}
        placeholder="Search a place…"
        aria-label="Search a place"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => shown.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown[0]) go(shown[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {err && <p className="hint">{err}</p>}
      {open && shown.length > 0 && (
        <ul className="place-hits" role="listbox">
          {shown.map((h) => (
            <li key={h.label + h.center.join(',')}>
              <button className="place-go" onClick={() => go(h)} title="Go there">
                {h.label}
              </button>
              {h.bbox && (
                <button className="place-select" onClick={() => select(h)} title="Use this place's box as the area">
                  Select area
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
