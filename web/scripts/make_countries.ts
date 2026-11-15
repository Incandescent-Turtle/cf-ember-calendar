// Simplify Natural Earth admin-0 (public domain) into web/public/countries.geojson (≲ 1 MB):
// keep name + ISO code, round to 0.03° and drop repeated vertices.
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   npx tsx scripts/make_countries.ts ne_50m_admin_0_countries.geojson
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { simplify } from '@turf/turf';

type Ring = [number, number][];
const r2 = (x: number) => Math.round(x * 100) / 100;

function ring(r: Ring): Ring | null {
  const out: Ring = [];
  for (const [x, y] of r) {
    const p: [number, number] = [r2(x), r2(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length < 4) return null;
  const [a, b] = [out[0], out[out.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}

const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const features = [];
for (const f of src.features) {
  const g = simplify(f, { tolerance: 0.02, highQuality: false }).geometry;
  const polys: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const kept = polys
    .map((p) => p.map(ring).filter((r): r is Ring => r !== null))
    .filter((p) => p.length > 0);
  if (!kept.length) continue;
  const iso = f.properties.ISO_A3 !== '-99' ? f.properties.ISO_A3 : f.properties.ADM0_A3;
  features.push({
    type: 'Feature',
    properties: { name: f.properties.NAME, iso },
    geometry: kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept },
  });
}
features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
const out = resolve(import.meta.dirname, '../public/countries.geojson');
const json = JSON.stringify({ type: 'FeatureCollection', source: 'Natural Earth 1:50m admin-0, simplified', features });
writeFileSync(out, json);
console.log(`${features.length} countries, ${(json.length / 1e6).toFixed(2)} MB → ${out}`);
