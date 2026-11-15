// Main-thread side of the data layer: config, JSON fetches, Worker RPC.
import type { DensityResult, WorkerRequest, WorkerResponse, WorkerResult } from './cube.worker';
import type { PointsResult } from './points';
import type { AoiSeries, Calibration, Manifest } from './types';

/** Base URL of the data host (VITE_DATA_BASE_URL). Defaults to the dev middleware. */
export const DATA_BASE_URL: string = (import.meta.env.VITE_DATA_BASE_URL as string | undefined) || '/dev-data';

const join = (path: string) => `${DATA_BASE_URL.replace(/\/+$/, '')}/${path}`;

export async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(join(path));
  if (!r.ok) throw new Error(`${r.status} fetching ${path}`);
  return (await r.json()) as T;
}

export const fetchManifest = () => fetchJson<Manifest>('manifest.json');

/** calibration.json is optional until S3 lands; null → AOI-specific k only. */
export async function fetchCalibration(): Promise<Calibration | null> {
  try {
    return await fetchJson<Calibration>('calibration.json');
  } catch {
    return null;
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./cube.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  return worker;
}

type Req<K extends WorkerRequest['kind']> = Omit<Extract<WorkerRequest, { kind: K }>, 'baseUrl'>;

function call(req: Omit<WorkerRequest, 'baseUrl'>): Promise<WorkerResult> {
  const id = nextId++;
  const baseUrl = new URL(DATA_BASE_URL, location.href).href;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id, baseUrl });
  });
}

export const aggregateInWorker = (req: Req<'aggregate'>) => call(req) as Promise<AoiSeries>;
export const densityInWorker = (req: Req<'density'>) => call(req) as Promise<DensityResult>;
export const pointsInWorker = (req: Req<'points'>) => call(req) as Promise<PointsResult>;
