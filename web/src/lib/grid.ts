// Grids (CONTRACTS.md → Grids). Twin of pipeline/grid.py.
// Binning a coordinate uses the integer-0.01° rule with EPS; AOI membership uses cell centres.

export const EPS = 1e-9;
export type Bbox = [west: number, south: number, east: number, north: number];

const clamp = (v: number, hi: number) => (v < 0 ? 0 : Math.min(v, hi));

export function rc01(lat: number, lon: number): [number, number] {
  return [
    clamp(Math.floor((lat + 90) * 100 + EPS), 17999),
    clamp(Math.floor((lon + 180) * 100 + EPS), 35999),
  ];
}

export function tileIdFromIndex(tr: number, tq: number): string {
  const south = tr * 10 - 90;
  const west = tq * 10 - 180;
  const ns = south >= 0 ? 'N' : 'S';
  const ew = west >= 0 ? 'E' : 'W';
  return `${ns}${String(Math.abs(south)).padStart(2, '0')}${ew}${String(Math.abs(west)).padStart(3, '0')}`;
}

export function tileIndex(tile: string): [number, number] {
  const south = Number(tile.slice(1, 3)) * (tile[0] === 'N' ? 1 : -1);
  const west = Number(tile.slice(4, 7)) * (tile[3] === 'E' ? 1 : -1);
  return [(south + 90) / 10, (west + 180) / 10];
}

export function tileBounds(tile: string): Bbox {
  const [tr, tq] = tileIndex(tile);
  return [tq * 10 - 180, tr * 10 - 90, tq * 10 - 170, tr * 10 - 80];
}

/** Tile of a point (binning rule). */
export function tile10(lat: number, lon: number): string {
  const [r, q] = rc01(lat, lon);
  return tileIdFromIndex(Math.floor(r / 1000), Math.floor(q / 1000));
}

/** L01 cell id inside its tile of a point (binning rule). */
export function l01Cell(lat: number, lon: number): number {
  const [r, q] = rc01(lat, lon);
  return (Math.floor(r / 10) % 100) * 100 + (Math.floor(q / 10) % 100);
}

/** L10 cell id of a point (binning rule). */
export function l10Cell(lat: number, lon: number): number {
  const [r, q] = rc01(lat, lon);
  return Math.floor(r / 100) * 360 + Math.floor(q / 100);
}

/** All 10° tiles whose area overlaps the bbox. */
export function tilesForBbox([w, s, e, n]: Bbox): string[] {
  const tr0 = Math.floor(clamp(s + 90, 179.999) / 10);
  const tr1 = Math.floor(clamp(n + 90, 179.999) / 10);
  const tq0 = Math.floor(clamp(w + 180, 359.999) / 10);
  const tq1 = Math.floor(clamp(e + 180, 359.999) / 10);
  const out: string[] = [];
  for (let tr = tr0; tr <= tr1; tr++) for (let tq = tq0; tq <= tq1; tq++) out.push(tileIdFromIndex(tr, tq));
  return out;
}

/** [lon, lat] centre of L01 cell c in a tile. */
export function l01Center(tile: string, c: number): [number, number] {
  const [w, s] = tileBounds(tile);
  return [w + ((c % 100) + 0.5) / 10, s + (Math.floor(c / 100) + 0.5) / 10];
}

/** [lon, lat] centre of L10 cell c. */
export function l10Center(c: number): [number, number] {
  return [(c % 360) - 180 + 0.5, Math.floor(c / 360) - 90 + 0.5];
}

/** 10° tile containing L10 cell c. */
export function tileOfL10(c: number): string {
  return tileIdFromIndex(Math.floor(Math.floor(c / 360) / 10), Math.floor((c % 360) / 10));
}
