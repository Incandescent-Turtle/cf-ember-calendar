"""Write tests/golden/{time_cases,harmonize_cases,analytics_cases}.json from the Python code.

    uv run python -m pipeline.make_golden

Never hand-edit the output. Field names follow the TypeScript types (camelCase) so the web
tests can feed `input` straight to harmonize() and compare with `expected`.
The "fixture-chilecito" case needs a fixture build (data/interim/fcd_daily +
data/processed/calibration.json); without it that case is skipped and the rest is unchanged.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math
from pathlib import Path

import numpy as np

from pipeline import analytics, grid, harmonize, series
from pipeline.config import REPO_ROOT, Config, connect

log = logging.getLogger("pipeline")

OUT = REPO_ROOT / "tests" / "golden"
TOL = {"rel": 1e-9, "abs": 1e-9}
MANIFEST = {"overlap": {"start": "2013-01-01", "end": "2021-12-31"},
            "snpp_end": "2026-11-02", "min_modis_fcd": 200}


def _t(s: str) -> int:
    return grid.dekad_index(dt.date.fromisoformat(s))


def _f(x):
    if x is None:
        return None
    if isinstance(x, (bool, str)):
        return x
    x = float(x)
    return x if math.isfinite(x) else None


# ----------------------------------------------------------------- time
def time_cases() -> dict:
    dates = ["2000-01-01", "2000-11-01", "2000-11-10", "2000-11-11", "2000-11-20", "2000-11-21",
             "2000-11-30", "2012-01-31", "2012-02-01", "2016-02-29", "2023-02-28", "2024-02-21",
             "2026-11-01", "2026-11-02", "2026-11-14", "2026-12-31", "2099-12-25"]
    by_date = [{"date": d, "t": _t(d)} for d in dates]
    ts = [0, 1, 2, 30, 31, 32, 433, 434, 875, 913, 914, 935, 3599]
    by_t = [{"t": t, "range": [x.isoformat() for x in grid.dekad_range(t)],
             "month": grid.dekad_month(t), "year": grid.dekad_year(t)} for t in ts]
    return {"generator": "pipeline.make_golden", "dekad_index": by_date, "dekad_range": by_t}


# ------------------------------------------------------------ harmonize
def _seasonal(rng, n_t: int, t0: int, level: float, start: str | None = None,
              zero_months: tuple[int, ...] = ()) -> np.ndarray:
    t = np.arange(t0, t0 + n_t)
    m = (t // 3) % 12
    shape = 1 + 0.9 * np.cos((m - 7) / 12 * 2 * np.pi)
    v = rng.poisson(level * shape).astype(float)
    if start:
        v[t < _t(start)] = 0
    for zm in zero_months:
        v[m == zm] = 0
    return v


def _case(name: str, per_tile: np.ndarray, tiles: list[str], t0: int, cal: dict | None,
          manifest: dict = MANIFEST, note: str = "") -> dict:
    h = harmonize.harmonize(per_tile, tiles, t0, manifest, cal)
    n_t = per_tile.shape[2]

    def kk(lst):
        return [{"k": _f(k["k"]), "lo": _f(k["lo"]), "hi": _f(k["hi"]), "stratum": k["stratum"]}
                for k in lst]

    rows = [None if r is None else {
        "year": r["year"], "month": r["month"], "modis": r["modis"], "snpp": r["snpp"],
        "n20": r["n20"], "viirs": r["viirs"], "spliced": r["spliced"],
        "harmonized": _f(r["harmonized"]), "lo": _f(r["lo"]), "hi": _f(r["hi"]),
        "era": r["era"], "stratum": r["stratum"], "partial": r["partial"],
        "nDekads": r["n_dekads"]} for r in h["rows"]]
    last = h["years"][-1]
    pct = []
    for month in (0, 6, 9):
        for value in (0.0, 50.0, 500.0, 5000.0):
            pct.append({"month": month, "value": value, "excludeYear": last,
                        "expected": _f(harmonize.month_percentile(h, month, value, last))})
    return {
        "name": name, "note": note,
        "input": {"t0": t0, "nT": n_t, "tiles": tiles,
                  "perTile": [[float(x) for x in a.reshape(-1)] for a in per_tile],
                  "manifest": manifest, "calibration": cal},
        "expected": {"years": h["years"], "tSwitch": h["t_switch"], "tN20": h["t_n20"],
                     "kModis": kk(h["k_modis"]), "kN20": kk(h["k_n20"]), "rows": rows,
                     "percentile": pct},
    }


def _block(k, lo, hi, n=None) -> dict:
    b = {"k": k, "lo": lo, "hi": hi}
    if n is not None:
        b["n_modis"] = n
    return b


def harmonize_cases(cfg: Config) -> dict:
    rng = np.random.default_rng(20261115)
    t0, t1 = _t("2009-01-01"), _t("2026-11-14")
    n_t = t1 - t0 + 1
    cases = []

    # 1. dense AOI, no calibration file: AOI k and bands for every month
    a = np.zeros((1, 4, n_t))
    a[0, 0] = _seasonal(rng, n_t, t0, 30)
    a[0, 1] = _seasonal(rng, n_t, t0, 70, "2012-01-21")
    a[0, 2] = _seasonal(rng, n_t, t0, 60, "2018-04-01")
    cases.append(_case("dense-aoi", a, ["S30W070"], t0, None,
                       note="AOI stratum everywhere; bands from the mulberry32 year bootstrap"))

    # 2. sparse two-tile AOI with a calibration file: tile (weighted), global, below-threshold
    b = np.zeros((2, 4, n_t))
    b[0, 0] = _seasonal(rng, n_t, t0, 2)
    b[0, 1] = _seasonal(rng, n_t, t0, 5, "2012-01-21")
    b[0, 2] = _seasonal(rng, n_t, t0, 4, "2018-04-01")
    b[1, 0] = _seasonal(rng, n_t, t0, 1, zero_months=(3,))
    b[1, 1] = _seasonal(rng, n_t, t0, 3, "2012-01-21")
    b[1, 2] = _seasonal(rng, n_t, t0, 3, "2018-04-01")
    ka = [2.0 + 0.05 * m for m in range(12)]
    kb = [3.0 - 0.05 * m for m in range(12)]
    kb_k = list(kb)
    kb_k[5] = None  # undefined k for one month in one tile
    cal = {
        "global": _block([2.4] * 12, [2.2] * 12, [2.6] * 12, [10_000] * 12),
        "tile": {
            "S30W070": _block(ka, [x - 0.2 for x in ka], [x + 0.2 for x in ka],
                              [500] * 6 + [150] * 6),  # below threshold Jul-Dec
            "S30W060": _block(kb_k, [None if x is None else x - 0.3 for x in kb_k],
                              [None if x is None else x + 0.3 for x in kb_k], [800] * 12),
        },
        "n20": {"global": _block([1.1] * 12, [1.0] * 12, [1.2] * 12),
                "tile": {"S30W070": _block([0.9] * 12, [0.8] * 12, [1.0] * 12, [300] * 12)}},
    }
    cases.append(_case("sparse-tiles", b, ["S30W070", "S30W060"], t0, cal,
                       note="tile ks weighted by the AOI's own overlap MODIS FCD per tile; "
                            "tiles with n_modis < min or k null are skipped; then global"))

    # 3. sparse AOI, no calibration file: aoi-sparse, and 'none' where MODIS is 0
    cases.append(_case("sparse-no-calibration", b[1:], ["S30W060"], t0, None,
                       note="no calibration.json: sparse AOI ratio, 'none' where the AOI "
                            "has no overlap MODIS FCD (April)"))

    # 4. global-only calibration, AOI in a tile the file doesn't list
    cases.append(_case("global-only", b[:1], ["N00E020"], t0,
                       {"global": cal["global"], "tile": {}, "n20": {"global": cal["n20"]["global"],
                                                                     "tile": {}}}))

    # 5. real fixture data: the hero AOI, with the fixture calibration
    cal_path = cfg.processed / "calibration.json"
    if cal_path.exists() and cfg.fcd_dir.exists():
        real = json.loads(cal_path.read_text(encoding="utf-8"))
        man = json.loads((cfg.processed / "manifest.json").read_text(encoding="utf-8"))
        con = connect(cfg)
        dr = tuple(man["dekad_range"])
        hero = series.circle_series(con, cfg, -67.7, -29.15, 25.0, dr)
        sub = {"global": real["global"],
               "tile": {t: real["tile"][t] for t in hero.tiles if t in real["tile"]},
               "n20": {"global": real["n20"]["global"],
                       "tile": {t: real["n20"]["tile"][t] for t in hero.tiles
                                if t in real["n20"]["tile"]}}}
        man_sub = {"overlap": man["overlap"], "snpp_end": man["snpp_end"],
                   "min_modis_fcd": man["min_modis_fcd"]}
        cases.append(_case("fixture-chilecito", hero.fcd, hero.tiles, hero.t0, sub, man_sub,
                           note="Argentina fixture, 0.1-degree cells with centre within 25 km "
                                "of (-67.7, -29.15)"))
    else:
        log.warning("fixture build missing: skipping the fixture-chilecito case")

    return {"generator": "pipeline.make_golden", "tolerance": TOL,
            "notes": ["perTile[i][s * nT + (t - t0)] = FCD (series 0 MODIS, 1 S-NPP, 2 NOAA-20)",
                      "null = NaN / undefined (JSON has no NaN)",
                      "row index = (year - years[0]) * 12 + month; null rows are outside the record",
                      "row.stratum is null in the S-NPP era (reference series)"],
            "cases": cases}


# ------------------------------------------------------------ analytics
def _assess(value, base) -> dict:
    a = analytics.assess(value, base)
    return {"percentile": _f(a["percentile"]), "label": a["label"], "z": _f(a["z"]),
            "clim": {k: _f(v) for k, v in a["clim"].items()}}


def analytics_cases(h_cases: dict) -> dict:
    rng = np.random.default_rng(7)
    quant = [{"xs": xs, "q": q, "expected": analytics.quantile(xs, q)}
             for xs in ([5.0], [1.0, 2.0, 3.0, 4.0], [0.0, 0.0, 3.0, 10.0, 7.0])
             for q in (0.1, 0.25, 0.5, 0.75, 0.9)]
    bases = [[0.0] * 10, [float(x) for x in rng.poisson(40, 15)], [1.0, 2.0, 3.0], [7.0]]
    assess = [{"value": v, "base": b, "expected": _assess(v, b)}
              for b in bases for v in (0.0, 3.0, 40.0, 60.0, 500.0)]
    mtd = []
    for d in (1, 2, 3):
        base = [[float(x) for x in rng.poisson(20, 3)] for _ in range(12)]
        cur = [float(x) for x in rng.poisson(30, d)]
        e = analytics.month_to_date(cur, base)
        mtd.append({"current": cur, "base": base,
                    "expected": {"dekads": e["dekads"], "value": e["value"], "ratio": _f(e["ratio"]),
                                 **_assess(e["value"], [sum(v[:d]) for v in base])}})
    mtd.append({"current": [0.0], "base": [[0.0, 1.0, 2.0]] * 5,
                "expected": {"dekads": 1, "value": 0.0, "ratio": None,
                             **_assess(0.0, [0.0] * 5)}})
    crit_in = [[0, 0, 0, 0, 0, 10, 50, 30, 10, 0, 0, 0], [40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
               [1] * 12, [0] * 12, [5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5],
               [float(x) for x in rng.poisson(10, 12)]]
    crit = [{"medians": m, "expected": analytics.critical_period(m)} for m in crit_in]
    tr_in = [(list(range(2001, 2011)), [10.0 + 2 * i for i in range(10)]),
             (list(range(2001, 2026)), [float(x) for x in rng.poisson(100, 25)]),
             (list(range(2001, 2006)), [5.0, 5.0, 5.0, 5.0, 5.0]),
             (list(range(2001, 2009)), [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0]),
             ([2001, 2002], [1.0, 2.0])]
    tr = [{"years": y, "annual": a, "expected": _trend(analytics.trend(y, a))} for y, a in tr_in]

    # end to end on a harmonize case: baseline = complete years except the last year
    from_series = []
    for c in h_cases["cases"]:
        rows, years = c["expected"]["rows"], c["expected"]["years"]
        cur = years[-1]
        table = {m: [(r["year"], r["harmonized"]) for r in rows
                     if r and r["month"] == m and not r["partial"] and r["harmonized"] is not None
                     and r["year"] != cur] for m in range(12)}
        clim = [_assess(0.0, [v for _, v in table[m]])["clim"] for m in range(12)]
        cur_rows = [r for r in rows if r and r["year"] == cur and not r["partial"]
                    and r["harmonized"] is not None]
        months = [{"month": r["month"], "value": r["harmonized"],
                   **_assess(r["harmonized"], [v for _, v in table[r["month"]]])}
                  for r in cur_rows]
        complete = [y for y in years if y != cur and all(
            rows[(y - years[0]) * 12 + m] and not rows[(y - years[0]) * 12 + m]["partial"]
            and rows[(y - years[0]) * 12 + m]["harmonized"] is not None for m in range(12))]
        annual = [sum(rows[(y - years[0]) * 12 + m]["harmonized"] for m in range(12))
                  for y in complete]
        from_series.append({
            "case": c["name"], "currentYear": cur, "baselineYears": complete,
            "expected": {"climatology": clim, "currentMonths": months,
                         "criticalPeriod": analytics.critical_period([x["median"] for x in clim])
                         if all(x["median"] is not None for x in clim) else None,
                         "annual": annual, "trend": _trend(analytics.trend(complete, annual))}})
    return {"generator": "pipeline.make_golden", "tolerance": {**TOL, "trend_p_abs": 1e-6},
            "rules": analytics.__doc__, "quantile": quant, "assess": assess,
            "monthToDate": mtd, "criticalPeriod": crit, "trend": tr, "fromSeries": from_series}


def _trend(t: dict | None) -> dict | None:
    if t is None:
        return None
    return {"slopePerYear": _f(t["slope_per_year"]), "pctPerYear": _f(t["pct_per_year"]),
            "medianAnnual": _f(t["median_annual"]), "s": t["s"], "varS": _f(t["var_s"]),
            "z": _f(t["z"]), "p": _f(t["p"]), "n": t["n"]}


def _write(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")
    log.info("wrote %s (%.0f kB)", path, path.stat().st_size / 1024)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cfg = Config()
    OUT.mkdir(parents=True, exist_ok=True)
    _write(OUT / "time_cases.json", time_cases())
    h = harmonize_cases(cfg)
    _write(OUT / "harmonize_cases.json", h)
    _write(OUT / "analytics_cases.json", analytics_cases(h))


if __name__ == "__main__":
    main()
