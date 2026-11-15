// Cube file codec (CONTRACTS.md → Cube file). gzip of a little-endian, columnar, sparse table.
import { gunzipSync, gzipSync } from 'fflate';

export interface Cube {
  level: 1 | 10;
  n: number;
  s: Uint8Array;
  t: Uint16Array;
  c: Uint16Array;
  v: Uint16Array;
}

/** Decode raw (already gunzipped) bytes. Copies u16 columns into aligned arrays. */
export function decodeCube(raw: Uint8Array): Cube {
  if (raw.length < 12) throw new Error('cube too short');
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'EMBC') throw new Error('not an EMBC cube');
  if (raw[4] !== 1) throw new Error(`unsupported cube version ${raw[4]}`);
  const level = raw[5];
  if (level !== 1 && level !== 10) throw new Error(`bad level ${level}`);
  const n = dv.getUint32(8, true);
  if (raw.length !== 12 + 7 * n) throw new Error(`bad length ${raw.length} for n=${n}`);
  return {
    level,
    n,
    s: raw.slice(12, 12 + n),
    t: readU16(dv, 12 + n, n),
    c: readU16(dv, 12 + 3 * n, n),
    v: readU16(dv, 12 + 5 * n, n),
  };
}

function readU16(dv: DataView, offset: number, n: number): Uint16Array {
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getUint16(offset + 2 * i, true);
  return out;
}

const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Gunzip (unless the host already decoded it) and decode. */
export async function decodeCubeFile(bytes: Uint8Array): Promise<Cube> {
  return decodeCube(isGzip(bytes) ? await gunzip(bytes) : bytes);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return gunzipSync(bytes);
}

export type CubeRow = [s: number, t: number, c: number, v: number];

/** Encode entries (mock-data generator and tests). Sorts by (s, t, c), drops zeros, saturates v. */
export function encodeCube(level: 1 | 10, rows: CubeRow[]): Uint8Array {
  const kept = rows.filter((r) => r[3] > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const n = kept.length;
  const buf = new Uint8Array(12 + 7 * n);
  const dv = new DataView(buf.buffer);
  buf.set([0x45, 0x4d, 0x42, 0x43, 1, level, 0, 0]);
  dv.setUint32(8, n, true);
  kept.forEach(([s, t, c, v], i) => {
    buf[12 + i] = s;
    dv.setUint16(12 + n + 2 * i, t, true);
    dv.setUint16(12 + 3 * n + 2 * i, c, true);
    dv.setUint16(12 + 5 * n + 2 * i, Math.min(v, 65535), true);
  });
  return buf;
}

export const encodeCubeGz = (level: 1 | 10, rows: CubeRow[]) => gzipSync(encodeCube(level, rows), { level: 9, mtime: 0 });
