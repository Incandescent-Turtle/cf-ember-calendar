// Hotspot CSV export (PRODUCT.md F5): cleaned detections in the AOI for a year range, built in the
// browser from the hosted Parquet files. Capped; above the cap, link to FIRMS Archive Download.
import { useMemo, useState } from 'react';
import { tilesForGeometry } from '../data/aggregate';
import { hotspotCsvInWorker } from '../data/client';
import { useAoiRef } from '../data/hooks';
import { FIRMS_ARCHIVE_URL, HOTSPOT_CAPS, minutesSince2000 } from '../data/points';
import type { Manifest } from '../data/types';
import { download, slug } from '../lib/export';
import { useStore, type Aoi } from '../store';

export function HotspotExport({ aoi, manifest }: { aoi: Aoi; manifest: Manifest }) {
  const ref = useAoiRef(aoi);
  const win = useStore((s) => s.window);
  const p = manifest.points;
  const years = useMemo(() => (p ? Array.from({ length: p.years[1] - p.years[0] + 1 }, (_, i) => p.years[0] + i) : []), [p]);
  const last = years[years.length - 1];
  const [from, setFrom] = useState(win.year ?? last);
  const [to, setTo] = useState(win.year ?? last);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; capped?: boolean } | null>(null);

  if (!p || !p.tiles.length || !ref)
    return (
      <p className="caption">
        Hotspot points aren’t hosted for this build. Download detections from{' '}
        <a href={FIRMS_ARCHIVE_URL} target="_blank" rel="noreferrer">
          FIRMS Archive Download
        </a>
        .
      </p>
    );
  const tiles = tilesForGeometry(ref.geometry).filter((t) => p.tiles.includes(t));
  const [a, b] = from <= to ? [from, to] : [to, from];

  const run = async () => {
    setBusy(true);
    setMsg({ text: 'Reading hotspot files…' });
    try {
      const paths = tiles.flatMap((t) => Array.from({ length: b - a + 1 }, (_, i) => `points/${t}/${a + i}.parquet`));
      const r = await hotspotCsvInWorker({ kind: 'hotspotCsv', aoi: ref, paths, tA: minutesSince2000(a, 0), tB: minutesSince2000(b + 1, 0), manifestTiles: manifest.tiles, l10Path: manifest.l10 });
      if (r.capped) {
        const why =
          r.capped === 'bytes'
            ? `it would need about ${Math.round(r.bytes / 1e6).toLocaleString('en-US')} MB of files (limit ${HOTSPOT_CAPS.bytes / 1024 / 1024} MB)`
            : `it has more than ${(HOTSPOT_CAPS.rows / 1e6).toFixed(0)} million detections`;
        setMsg({ text: `Too large to build in the browser: ${why}. Try a shorter range or a smaller area, or use`, capped: true });
      } else if (r.blob) {
        download(r.blob, `ember-hotspots_${slug(aoi.label)}_${a}${b > a ? `-${b}` : ''}.csv`, 'text/csv');
        setMsg({ text: `${r.rows.toLocaleString('en-US')} detections from ${r.files} file${r.files === 1 ? '' : 's'}${r.missing ? ` (${r.missing} tile-years have no file)` : ''}, ${(r.ms / 1000).toFixed(1)} s.` });
      }
    } catch (e) {
      setMsg({ text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hotspot-export">
      <div className="radius-form">
        <span>Hotspots (CSV), cleaned detections in this area:</span>
        <label>
          from{' '}
          <select value={from} onChange={(e) => (setFrom(Number(e.target.value)), setMsg(null))} aria-label="First year">
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          to{' '}
          <select value={to} onChange={(e) => (setTo(Number(e.target.value)), setMsg(null))} aria-label="Last year">
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <button onClick={run} disabled={busy || !tiles.length}>
          {busy ? 'Building…' : 'Download'}
        </button>
      </div>
      {!tiles.length && <p className="caption">No hotspot files cover this area.</p>}
      {msg && (
        <p className="caption" role="status">
          {msg.text}
          {msg.capped && (
            <>
              {' '}
              <a href={FIRMS_ARCHIVE_URL} target="_blank" rel="noreferrer">
                FIRMS Archive Download
              </a>
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}
