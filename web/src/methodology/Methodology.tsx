// Methodology & validation page (PRODUCT.md F8). Renders validation.json, calibration.json and the
// manifest: every number comes from the current build.
import { useQuery } from '@tanstack/react-query';
import { RekindleFindings } from '../rekindle/Findings';
import { RekindleLimits, RekindleMethod } from './RekindleMethod';
import { DATA_BASE_URL, fetchJson } from '../data/client';
import { useCalibration, useManifest } from '../data/hooks';
import { dataScope, globalTableLinks } from '../lib/export';
import { dekadRange, MONTHS_SHORT } from '../lib/time';
import { linkTo } from '../route';
import { SeamChart } from './SeamChart';
import { findings, kStats, METHODS, SEAM_COLORS } from './summary';
import type { LoyoMetrics, SeamTest, Validation } from './types';

const f = (x: number | null | undefined, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
const n0 = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—');

export function Methodology() {
  const manifest = useManifest();
  const calibration = useCalibration();
  const validation = useQuery({ queryKey: ['validation'], queryFn: () => fetchJson<Validation>('validation.json'), staleTime: Infinity });
  const m = manifest.data;
  const v = validation.data;
  const err = manifest.error ?? validation.error;

  return (
    <div className="methodology-wrap">
      <article className="methodology">
        <p>
          <a href="/" onClick={linkTo('app')}>
            ← Back to the calendar
          </a>
        </p>
        <h1>Methodology and validation</h1>
        <p className="lede">
          Two parts: how MODIS (2000→) and VIIRS (2012→) hotspots become one consistent record and how well it holds up, then how the Rekindle fire-spread simulator works and how
          we test it. Each part explains the method before its results.
        </p>
          <nav className="mth-parts" aria-label="Parts of this page">
            <a href="#harmonization">
              <span>Part 1</span> Harmonizing MODIS and VIIRS hotspots
            </a>
            <a href="#rekindle">
              <span>Part 2</span> Rekindle fire-spread simulation
            </a>
          </nav>
          <h2 className="part-title" id="harmonization">
            Part 1 · Harmonizing MODIS and VIIRS hotspots
          </h2>
        <p className="meta">
          Every number in Part 1 is read from the current data build (<code>validation.json</code>, <code>calibration.json</code>, <code>manifest.json</code>).
        </p>
        {err && <p className="error">Couldn’t load the validation files: {(err as Error).message}</p>}
        {!v || !m ? (
          !err && <p className="loading">Loading…</p>
        ) : (
          <Body v={v} m={m} cal={calibration.data ?? null} />
        )}
          <h2 className="part-title" id="rekindle">
            Part 2 · Rekindle fire-spread simulation
          </h2>
          <RekindleMethod />
          <section>
            <h2>Results</h2>
            <RekindleFindings headingLevel={3} />
          </section>
          <RekindleLimits />
      </article>
    </div>
  );
}

function Body({ v, m, cal }: { v: Validation; m: NonNullable<ReturnType<typeof useManifest>['data']>; cal: ReturnType<typeof useCalibration>['data'] | null }) {
  const scope = dataScope(m);
  const ks = kStats(cal ?? null, m.min_modis_fcd);
  const overlap = v.params.overlap;
  const switchMonth = (v.params.switch ?? '2012-02-01').slice(0, 7);
  const years = v.loyo.years ?? [Number(overlap[0].slice(0, 4)), Number(overlap[1].slice(0, 4))];

  return (
    <>
      <section className={`data-scope ${scope.global ? '' : 'regional'}`}>
        <strong>Data in this build:</strong> {scope.global ? 'Global' : 'Regional only'} — {scope.text}. Record {dekadRange(m.dekad_range[0])[0]} to{' '}
        {dekadRange(m.dekad_range[1])[1]} (latest dekad possibly incomplete), built {m.built_at.slice(0, 16).replace('T', ' ')} UTC.
        {m.row_counts && (
          <>
            {' '}
            Cleaned detections: MODIS {n0(m.row_counts.MODIS)}, VIIRS S-NPP {n0(m.row_counts.VIIRS_SNPP)}, VIIRS NOAA-20 {n0(m.row_counts.VIIRS_NOAA20)}.
          </>
        )}
        {!scope.global && ' “Global” below means the whole build, not the whole world.'}
        {v.mock && <strong> Mock validation file (development only).</strong>}
      </section>


      <section>
        <h2>How the record is built</h2>
        <ol className="steps">
          <li>
            <strong>Clean.</strong> NASA FIRMS archive (science-quality where available, near-real-time after). Vegetation fires only (<code>type = 0</code>;
            rows without a type are masked against known static sources). MODIS confidence ≥ 30; VIIRS nominal and high. Near-real-time rows are dropped where
            science-quality rows exist for that sensor and date; exact duplicates are dropped.
          </li>
          <li>
            <strong>Fire-cell-days (FCD).</strong> Each detection is put in a 0.01° cell (≈1 km). One FCD = one cell with at least one detection on one UTC day,
            per sensor group (MODIS = Terra + Aqua). Summed per 0.1° and 1° cell and per dekad (10-day period). Any drawn area is an exact sum of those cells.
          </li>
          <li>
            <strong>Calibrate.</strong> <em>k</em> is a conversion factor: how many VIIRS fire-cell-days correspond to one MODIS fire-cell-day for the same fire activity
            (VIIRS sees more, because its pixels are smaller). k = VIIRS S-NPP FCD ÷ MODIS FCD, a ratio of sums per calendar month over {overlap[0].slice(0, 4)}–{overlap[1].slice(0, 4)}{' '}
            (both sensors stable; Terra’s orbit drifts after that). The app uses the drawn area’s own k when it has ≥ {m.min_modis_fcd} MODIS FCD in that month,
            otherwise its 10° tile’s, otherwise the whole build’s. The band is the 5th–95th percentile of 200 bootstrap resamples of the years.
          </li>
          <li>
            <strong>Splice.</strong> Before {switchMonth}: k × MODIS (“VIIRS-equivalent”). From {switchMonth}: VIIRS S-NPP as measured. From the dekad containing{' '}
            {m.snpp_end} (end of the S-NPP stream): NOAA-20 × k<sub>N20</sub>, cross-calibrated to S-NPP the same way.
          </li>
        </ol>
      </section>

      <section>
        <h2>The 2012 seam, before and after</h2>
        <p className="caption">
          Monthly FCD, 2008–2016. Raw MODIS sees far fewer fire-cell-days than VIIRS, so splicing raw data puts a false jump at {switchMonth}. The harmonized line
          (shaded: calibration uncertainty) should run straight through it. From {switchMonth} it is VIIRS S-NPP itself, so the two lines coincide.
        </p>
        <div className="seam-key" aria-hidden>
          <span><i style={{ borderTop: `2px dashed ${SEAM_COLORS.modis}` }} /> MODIS raw</span>
          <span><i style={{ borderTop: `1.5px solid ${SEAM_COLORS.viirs}` }} /> VIIRS S-NPP raw</span>
          <span><i style={{ borderTop: `3px solid ${SEAM_COLORS.harmonized}` }} /> Harmonized</span>
        </div>
        {v.seam.scopes.map((s) => (
          <figure key={s.name} className="seam">
            <figcaption>
              <strong>{s.name === 'global' ? (scope.global ? 'Global' : 'Whole build') : s.name}</strong>
              {s.test?.sparse ? (
                <span className="flag"> Too sparse for the seam test ({f(s.test.mean_modis_fcd_per_month, 1)} MODIS FCD a month): shown for context only.</span>
              ) : s.test ? (
                <span className="dim"> step across {switchMonth}, minus MODIS’s own: raw {f(s.test.mean_log_diff_before)} → harmonized {f(s.test.mean_log_diff_after, 3)} (log units)</span>
              ) : null}
              {s.k_strata && <span className="dim"> · k from: {[...new Set(s.k_strata)].join(', ')}</span>}
            </figcaption>
            <SeamChart scope={s} switchMonth={switchMonth} />
          </figure>
        ))}
        <SeamTable scopes={v.seam.scopes.map((s) => ({ name: s.name, test: s.test }))} />
      </section>

      <section>
        <h2>Leave-one-year-out test, {years[0]}–{years[1]}</h2>
        <p className="caption">
          For each overlap year: fit k on the other years, estimate that year’s monthly VIIRS from MODIS, compare with what VIIRS actually saw. Pooled over months
          and years. r = Pearson correlation of log(1 + value); median error = median |estimated − observed| / observed over months with ≥ 10; bias = mean log
          ratio (0 = unbiased, −0.69 = half).
        </p>
        <div className="table-wrap">
          <table className="loyo">
            <thead>
              <tr>
                <th scope="col">Method</th>
                {v.loyo.levels.map((l) => (
                  <th key={l.level} scope="colgroup" colSpan={3}>
                    {l.level === 'global' ? (scope.global ? 'Global' : 'Whole build') : `Per 10° tile (${l.n_series})`}
                  </th>
                ))}
              </tr>
              <tr>
                <th />
                {v.loyo.levels.map((l) => (
                  <Sub key={l.level} />
                ))}
              </tr>
            </thead>
            <tbody>
              {METHODS.map((meth) => (
                <tr key={meth.key} className={meth.key === 'calibrated' ? 'ours' : ''}>
                  <th scope="row" title={meth.what}>
                    {meth.label}
                  </th>
                  {v.loyo.levels.map((l) => (
                    <Cells key={l.level} x={l[meth.key] as LoyoMetrics | undefined} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Read across the rows: raw counts → fire-cell-days → fire-cell-days with k. The tile level is harder (sparse tile-months, where MODIS often sees nothing
          while VIIRS sees something), and its calibrated bias is negative: a ratio can’t recover activity MODIS missed entirely.
        </p>
      </section>

      <section>
        <h2>Calibration factors</h2>
        <ul>
          {ks.global && (
            <li>
              Whole-build k by month ranges from <strong>{f(ks.global.min)}</strong> ({MONTHS_SHORT[ks.global.minMonth]}) to <strong>{f(ks.global.max)}</strong> (
              {MONTHS_SHORT[ks.global.maxMonth]}): VIIRS records that many times more fire-cell-days than MODIS for the same activity.
            </li>
          )}
          {ks.tile && (
            <li>
              Per 10° tile ({ks.tile.n} tile-months with ≥ {m.min_modis_fcd} MODIS FCD, {ks.tile.nTiles} tiles): 5th / 50th / 95th percentile k ={' '}
              {f(ks.tile.p5)} / {f(ks.tile.p50)} / {f(ks.tile.p95)}. k varies by region and season, which is why the app prefers the most local k with enough data.
            </li>
          )}
          {ks.n20 && (
            <li>
              NOAA-20 → S-NPP: k<sub>N20</sub> from {f(ks.n20.min)} to {f(ks.n20.max)} (median {f(ks.n20.median)}). Close to 1, as expected for the same instrument on a
              sister satellite.
            </li>
          )}
        </ul>
        {cal && <KTable k={cal.global.k} lo={cal.global.lo} hi={cal.global.hi} />}
      </section>

      <section>
        <h2>Seasonality preserved</h2>
        <p>
          Per 10° tile, the median monthly cycle of {v.seasonality.modis_years?.join('–') ?? 'the MODIS era'} (harmonized MODIS) against{' '}
          {v.seasonality.viirs_years?.join('–') ?? 'the VIIRS era'} (VIIRS S-NPP): median correlation <strong>r = {f(v.seasonality.median_r)}</strong>
          {v.seasonality.p25_r != null && (
            <>
              {' '}
              (middle half of tiles {f(v.seasonality.p25_r)}–{f(v.seasonality.p75_r)})
            </>
          )}{' '}
          over {v.seasonality.n_tiles} tiles with enough activity. Low values aren’t necessarily errors: fire seasons do change.
        </p>
      </section>

      <section>
        <h2>What the tests show</h2>
        <ul className="findings">
          {findings(v).map((t) => (
            <li key={t.slice(0, 40)}>{t}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Limitations</h2>
        <ul className="limits">
          <li>Hotspots are not fires and not burned area. Clouds, smoke and overpass timing cause omissions; one fire spans many fire-cell-days.</li>
          <li>
            One k per stratum and month assumes the MODIS–VIIRS relationship is stable over time. A shift in fire sizes (e.g. more small fires) would bias it.
          </li>
          <li>Fire-cell-days drop intensity (FRP), the number of detections per cell-day and fire identity: they count activity, not fires.</li>
          <li>
            <strong>Values before 2012 cannot be checked against VIIRS</strong>, because VIIRS didn’t exist. The leave-one-year-out test checks that k is stable
            across overlap years and the seam test checks continuity; neither proves the 2001–2011 values.
          </li>
          <li>Bands are calibration uncertainty only (a bootstrap over {years[1] - years[0] + 1} overlap years), not omission, cloud or detection changes.</li>
          <li>Terra’s orbit has drifted since about 2020, so recent MODIS is less comparable; it isn’t used for fitting.</li>
          <li>0.01° cells shrink in longitude toward the poles. This affects both sensors alike, so k absorbs most of it.</li>
          <li>
            Related work fuses MODIS/VIIRS fire radiative power at footprint scale and harmonizes burned area (e.g. GFED5). Our approach is deliberately simpler,
            transparent and adapts to the drawn area.
          </li>
        </ul>
      </section>
      <GlobalTable m={m} />
      <p className="dim">
        Data: NASA FIRMS — MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP, NOAA-20) active fire products. Analytics rules are written once in{' '}
        <code>pipeline/analytics.py</code> and checked against the browser code with shared test files.
      </p>
    </>
  );
}

const mb = (b: number | undefined) => (b ? ` (${(b / 2 ** 20).toFixed(0)} MB)` : '');

/** "Download global table": only when the manifest lists it or VITE_GLOBAL_TABLE is set (see globalTableLinks). */
function GlobalTable({ m }: { m: NonNullable<ReturnType<typeof useManifest>['data']> }) {
  const g = globalTableLinks(m, DATA_BASE_URL, import.meta.env.VITE_GLOBAL_TABLE as string | undefined);
  if (!g) return null;
  return (
    <section className="global-table">
      <h2>Download global table</h2>
      <p>
        Monthly harmonized hotspot activity (VIIRS-equivalent fire-cell-days) for every 1° cell with activity, whole record
        {g.rows ? `: ${n0(g.rows)} cell-months, ${n0(g.cells)} cells` : ''}. Each row is what the calendar shows for an area covering that cell, with raw MODIS,
        raw VIIRS, the k used and its stratum.{' '}
        <a href={g.href(g.parquet)} download>
          Parquet{mb(g.bytes?.parquet)}
        </a>{' '}
        ·{' '}
        <a href={g.href(g.csv_gz)} download>
          CSV, gzipped{mb(g.bytes?.csv_gz)}
        </a>{' '}
        ·{' '}
        <a href={g.href(g.readme)} target="_blank" rel="noreferrer">
          data dictionary (README)
        </a>
      </p>
    </section>
  );
}

function Sub() {
  return (
    <>
      <th scope="col">r</th>
      <th scope="col">median error</th>
      <th scope="col">bias</th>
    </>
  );
}

function Cells({ x }: { x: LoyoMetrics | undefined }) {
  return (
    <>
      <td>{f(x?.r_log, 3)}</td>
      <td>{x && typeof x.mdape === 'number' ? `${x.mdape.toFixed(1)} %` : '—'}</td>
      <td>{f(x?.bias_log)}</td>
    </>
  );
}

function SeamTable({ scopes }: { scopes: { name: string; test?: SeamTest }[] }) {
  return (
    <div className="table-wrap">
      <table className="loyo">
        <caption>
          Step across the switch = mean log(1 + FCD) of the 24 months after minus the 24 before. “Seam” = the step minus MODIS’s own step (≈ 0 means no seam).
        </caption>
        <thead>
          <tr>
            <th scope="col">Scope</th>
            <th scope="col">MODIS only</th>
            <th scope="col">Raw spliced</th>
            <th scope="col">Harmonized</th>
            <th scope="col">Seam, raw</th>
            <th scope="col">Seam, harmonized</th>
          </tr>
        </thead>
        <tbody>
          {scopes.map(({ name, test: t }) => (
            <tr key={name} className={t?.sparse ? 'sparse' : ''}>
              <th scope="row">
                {name}
                {t?.sparse ? ' (too sparse)' : ''}
              </th>
              <td>{f(t?.step_modis)}</td>
              <td>{f(t?.step_spliced_raw)}</td>
              <td>{f(t?.step_harmonized)}</td>
              <td>{f(t?.mean_log_diff_before)}</td>
              <td>{f(t?.mean_log_diff_after, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KTable({ k, lo, hi }: { k: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] }) {
  return (
    <div className="table-wrap">
      <table className="loyo">
        <caption>Whole-build k by calendar month (5th–95th percentile band)</caption>
        <thead>
          <tr>
            {MONTHS_SHORT.map((mm) => (
              <th key={mm} scope="col">
                {mm}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {k.map((x, i) => (
              <td key={i}>{f(x)}</td>
            ))}
          </tr>
          <tr className="dimrow">
            {k.map((_, i) => (
              <td key={i}>
                {f(lo[i])}–{f(hi[i])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
