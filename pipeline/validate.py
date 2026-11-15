"""Validation of the harmonization (HARMONIZATION.md step 5) -> validation.json.

1. Leave-one-year-out over the overlap years: fit k on the other years, predict the held-out
   year's monthly VIIRS from MODIS. Three methods, pooled over (series, month) points:
     calibrated        FCD x k (tile level: the tile's k, or global k if the tile's other-year
                       MODIS FCD for that month < min_modis_fcd; same rule as the web)
     fcd_uncalibrated  FCD, k = 1
     raw_counts        detection counts x a count ratio fitted the same way (the naive approach)
   plus raw_counts_uncalibrated (counts, k = 1) as an extra row.
   r_log  = Pearson r of log1p(pred) vs log1p(obs) over points where either is > 0
   mdape  = median |pred - obs| / obs, %, over points with obs >= 10
   bias_log = mean(log1p(pred) - log1p(obs)) over the same points as mdape
2. Seam: monthly MODIS raw, VIIRS raw and harmonized FCD 2008-2016 for the world and the hero
   AOI; test = step across 2012-02 (mean log1p, 24 months after minus 24 before) of the raw
   spliced and the harmonized series, each minus the MODIS-only step (~0 is continuous).
3. Seasonality: per tile, r between the median monthly cycle 2001-2011 (harmonized MODIS) and
   2013-2025 (VIIRS S-NPP).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math
import warnings

import numpy as np

from pipeline import grid
from pipeline.calibrate import S_MODIS, S_SNPP
from pipeline.config import Config
from pipeline.harmonize import SWITCH_DATE, harmonize
from pipeline.series import TileSeries

log = logging.getLogger(__name__)

HERO = {"name": "Chilecito, Argentina (25 km)", "lon": -67.7, "lat": -29.15, "radius_km": 25.0}
SEAM_YEARS = (2008, 2016)
SEAM_WINDOW = 24
MODIS_ERA = (2001, 2011)
VIIRS_ERA = (2013, 2025)
MIN_CYCLE = 12.0
SPARSE_MODIS = 10.0  # mean monthly MODIS FCD in the seam windows below which the test is flagged  # FCD per year in both cycles for a tile to count in seasonality


def monthly(arr: np.ndarray, t0: int) -> tuple[int, np.ndarray]:
    """(..., nT) dekads -> (y0, (..., n_years, 12)) monthly sums; NaN where a month has < 3 dekads."""
    n_t = arr.shape[-1]
    y0, y1 = 2000 + t0 // 36, 2000 + (t0 + n_t - 1) // 36
    out = np.zeros(arr.shape[:-1] + ((y1 - y0 + 1) * 12,))
    cnt = np.zeros((y1 - y0 + 1) * 12)
    mi = (np.arange(t0, t0 + n_t) // 3) - (y0 - 2000) * 12
    np.add.at(np.moveaxis(out, -1, 0), mi, np.moveaxis(arr, -1, 0))
    np.add.at(cnt, mi, 1)
    out[..., cnt < 3] = np.nan
    return y0, out.reshape(arr.shape[:-1] + (y1 - y0 + 1, 12))


def _years_slice(y0: int, a: np.ndarray, ya: int, yb: int) -> np.ndarray:
    return a[..., ya - y0: yb - y0 + 1, :]


# ---------------------------------------------------------------------- LOYO
def metrics(pred: np.ndarray, obs: np.ndarray) -> dict:
    pred, obs = np.ravel(pred), np.ravel(obs)
    ok = np.isfinite(pred) & np.isfinite(obs)
    pred, obs = pred[ok], obs[ok]
    keep = (pred > 0) | (obs > 0)
    lp, lo = np.log1p(pred[keep]), np.log1p(obs[keep])
    r = float(np.corrcoef(lp, lo)[0, 1]) if keep.sum() > 2 and lp.std() > 0 and lo.std() > 0 \
        else None
    sel = obs >= 10
    mdape = float(np.median(np.abs(pred[sel] - obs[sel]) / obs[sel]) * 100) if sel.any() else None
    bias = float(np.mean(np.log1p(pred[sel]) - np.log1p(obs[sel]))) if sel.any() else None
    rnd = (lambda x, n: None if x is None else round(x, n))
    return {"r_log": rnd(r, 4), "mdape": rnd(mdape, 2), "bias_log": rnd(bias, 4),
            "n_points": int(keep.sum()), "n_mdape": int(sel.sum())}


def loyo_predict(num: np.ndarray, den: np.ndarray, min_n: float,
                 fb_num: np.ndarray | None = None, fb_den: np.ndarray | None = None) -> np.ndarray:
    """num/den: (units, nY, 12). Prediction of num for each held-out year from the others.
    Units whose other-year den < min_n for a month fall back to the ratio of fb_num/fb_den (nY, 12)."""
    pred = np.full(num.shape, np.nan)
    n_y = num.shape[1]
    for j in range(n_y):
        others = [i for i in range(n_y) if i != j]
        sn, sd = num[:, others].sum(1), den[:, others].sum(1)  # (units, 12)
        with np.errstate(invalid="ignore", divide="ignore"):
            k = np.where(sd > 0, sn / np.where(sd > 0, sd, 1), np.nan)
        if fb_num is not None:
            fn, fd = fb_num[others].sum(0), fb_den[others].sum(0)
            with np.errstate(invalid="ignore", divide="ignore"):
                kg = np.where(fd > 0, fn / np.where(fd > 0, fd, 1), np.nan)
            k = np.where(sd >= min_n, k, kg[None, :])
        pred[:, j] = np.where(den[:, j] > 0, k * den[:, j], 0.0)
    return pred


def loyo(ts: TileSeries, cfg: Config) -> dict:
    ya, yb = int(cfg.cal_start[:4]), int(cfg.cal_end[:4])
    y0, f = monthly(ts.fcd, ts.t0)
    _, d = monthly(ts.det, ts.t0)
    f, d = _years_slice(y0, f, ya, yb), _years_slice(y0, d, ya, yb)  # (tiles, 4, nY, 12)
    mn = cfg.cal_min_modis_fcd
    levels = []
    for level in ("global", "tile"):
        if level == "global":
            fv, fm = f[:, S_SNPP].sum(0)[None], f[:, S_MODIS].sum(0)[None]
            dv, dm = d[:, S_SNPP].sum(0)[None], d[:, S_MODIS].sum(0)[None]
            fb = {}
            fbc = {}
        else:
            fv, fm, dv, dm = f[:, S_SNPP], f[:, S_MODIS], d[:, S_SNPP], d[:, S_MODIS]
            fb = {"fb_num": fv.sum(0), "fb_den": fm.sum(0)}
            fbc = {"fb_num": dv.sum(0), "fb_den": dm.sum(0)}
        active = ((fv + fm).reshape(len(fv), -1).sum(1) > 0)
        fv, fm, dv, dm = fv[active], fm[active], dv[active], dm[active]
        levels.append({
            "level": level,
            "n_series": int(active.sum()),
            "calibrated": metrics(loyo_predict(fv, fm, mn, **fb), fv),
            "fcd_uncalibrated": metrics(fm, fv),
            "raw_counts": metrics(loyo_predict(dv, dm, mn, **fbc), dv),
            "raw_counts_uncalibrated": metrics(dm, dv),
        })
    return {"levels": levels, "years": [ya, yb]}


# ---------------------------------------------------------------------- seam
def _month_labels(ya: int, yb: int) -> list[str]:
    return [f"{y}-{m:02d}" for y in range(ya, yb + 1) for m in range(1, 13)]


def _step(series: dict[str, float], months: list[str], i_switch: int, w: int) -> float | None:
    vals = np.array([np.nan if series[m] is None else series[m] for m in months], dtype=float)
    before, after = vals[i_switch - w:i_switch], vals[i_switch:i_switch + w]
    if i_switch - w < 0 or len(after) < w or np.isnan(before).any() or np.isnan(after).any():
        return None
    return float(np.mean(np.log1p(after)) - np.mean(np.log1p(before)))


def seam_scope(name: str, per_tile: np.ndarray, tiles: list[str], t0: int, manifest: dict,
               cal: dict | None) -> dict:
    h = harmonize(per_tile, tiles, t0, manifest, cal)
    lab = {}
    for r in h["rows"]:
        if r is not None and not r["partial"]:
            lab[f"{r['year']}-{r['month'] + 1:02d}"] = r
    ya, yb = SEAM_YEARS
    months = [m for m in _month_labels(ya, yb) if m in lab]
    snpp_start = "2012-01"

    def col(key, cond=lambda m: True):
        return [round(lab[m][key], 3) if cond(m) else None for m in months]

    out = {"name": name, "months": months,
           "modis_raw": col("modis"),
           "viirs_raw": col("snpp", lambda m: m >= snpp_start),
           "harmonized": col("harmonized"),
           "harmonized_lo": col("lo"), "harmonized_hi": col("hi"),
           "spliced_raw": col("spliced"),
           "k_strata": sorted({k["stratum"] for k in h["k_modis"]}),
           "k_modis": [None if not math.isfinite(k["k"]) else round(k["k"], 4)
                       for k in h["k_modis"]]}
    # test over the full record, not only the plotted window
    all_months = sorted(lab)
    sw = SWITCH_DATE[:7]
    w = SEAM_WINDOW
    if sw in all_months:
        i = all_months.index(sw)
        get = {key: {m: lab[m][key] for m in all_months} for key in ("modis", "spliced", "harmonized")}
        d_m = _step(get["modis"], all_months, i, w)
        d_s = _step(get["spliced"], all_months, i, w)
        d_h = _step(get["harmonized"], all_months, i, w)
        out["test"] = {
            "window_months": w, "step_modis": _r(d_m), "step_spliced_raw": _r(d_s),
            "step_harmonized": _r(d_h),
            "mean_log_diff_before": _r(None if d_s is None or d_m is None else d_s - d_m),
            "mean_log_diff_after": _r(None if d_h is None or d_m is None else d_h - d_m)}
        mean_m = float(np.mean([lab[m]["modis"] for m in all_months[max(i - w, 0):i + w]]))
        # below ~10 MODIS FCD a month, log1p steps measure zeros, not the seam
        out["test"]["mean_modis_fcd_per_month"] = round(mean_m, 2)
        out["test"]["sparse"] = mean_m < SPARSE_MODIS
    return out


def _r(x, n=4):
    return None if x is None else round(float(x), n)


# --------------------------------------------------------------- seasonality
def seasonality(ts: TileSeries, cal: dict | None, cfg: Config) -> dict:
    y0, f = monthly(ts.fcd, ts.t0)
    y_last = y0 + f.shape[2] - 1
    va, vb = VIIRS_ERA[0], min(VIIRS_ERA[1], y_last)
    ma, mb = max(MODIS_ERA[0], y0), MODIS_ERA[1]
    g = (cal or {}).get("global", {})
    rs = []
    for i, tl in enumerate(ts.tiles):
        b = (cal or {}).get("tile", {}).get(tl)
        k = np.array([
            (b["k"][m] if b and b["k"][m] is not None and b["n_modis"][m] >= cfg.cal_min_modis_fcd
             else (g.get("k") or [np.nan] * 12)[m]) for m in range(12)], dtype=float)
        hm = _years_slice(y0, f[i, S_MODIS], ma, mb) * k[None, :]
        vv = _years_slice(y0, f[i, S_SNPP], va, vb)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            c1, c2 = np.nanmedian(hm, axis=0), np.nanmedian(vv, axis=0)
        if not (np.isfinite(c1).all() and np.isfinite(c2).all()):
            continue
        if c1.sum() < MIN_CYCLE or c2.sum() < MIN_CYCLE or c1.std() == 0 or c2.std() == 0:
            continue
        rs.append(float(np.corrcoef(c1, c2)[0, 1]))
    q = (lambda p: round(float(np.percentile(rs, p)), 4) if rs else None)
    return {"median_r": q(50), "p25_r": q(25), "p75_r": q(75), "n_tiles": len(rs),
            "modis_years": [ma, mb], "viirs_years": [va, vb], "min_annual_fcd": MIN_CYCLE}


# ---------------------------------------------------------------------- main
def validate(ts: TileSeries, hero: TileSeries | None, cal: dict | None, cfg: Config,
             manifest: dict) -> dict:
    scopes = [seam_scope("global", ts.fcd, ts.tiles, ts.t0, manifest, cal)]
    if hero is not None and hero.fcd.sum() > 0:
        scopes.append(seam_scope(HERO["name"], hero.fcd, hero.tiles, hero.t0, manifest, cal))
        tl = grid.tile10(HERO["lat"], HERO["lon"])
        if tl in ts.tiles:  # an active area around the hero, where the test has power
            i = ts.tiles.index(tl)
            scopes.append(seam_scope(f"10° tile {tl} (contains Chilecito)", ts.fcd[i:i + 1],
                                     [tl], ts.t0, manifest, cal))
    test = scopes[0].get("test", {})
    return {
        "loyo": loyo(ts, cfg),
        "seam": {"scopes": scopes,
                 "test": {"window_months": SEAM_WINDOW,
                          "mean_log_diff_before": test.get("mean_log_diff_before"),
                          "mean_log_diff_after": test.get("mean_log_diff_after"),
                          "scope": "global"}},
        "seasonality": seasonality(ts, cal, cfg),
        "params": {"overlap": [cfg.cal_start, cfg.cal_end],
                   "min_modis_fcd": cfg.cal_min_modis_fcd,
                   "switch": SWITCH_DATE, "snpp_end": cfg.snpp_end,
                   "hero": HERO,
                   "built_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "dekad_range": [ts.t0, ts.t0 + ts.n_t - 1],
                   "record_end": grid.dekad_range(ts.t0 + ts.n_t - 1)[1].isoformat()},
    }


def write_validation(ts: TileSeries, hero: TileSeries | None, cal: dict | None, cfg: Config,
                     manifest: dict) -> dict:
    v = validate(ts, hero, cal, cfg, manifest)
    path = cfg.processed / "validation.json"
    path.write_text(json.dumps(v, separators=(",", ":")), encoding="utf-8")
    for lv in v["loyo"]["levels"]:
        log.info("LOYO %-6s n=%d | calibrated %s | fcd k=1 %s | count ratio %s",
                 lv["level"], lv["n_series"], _short(lv["calibrated"]),
                 _short(lv["fcd_uncalibrated"]), _short(lv["raw_counts"]))
    for sc in v["seam"]["scopes"]:
        t = sc.get("test", {})
        log.info("seam %s: step raw-modis %s -> harmonized-modis %s", sc["name"],
                 t.get("mean_log_diff_before"), t.get("mean_log_diff_after"))
    log.info("seasonality: median r %s over %d tiles", v["seasonality"]["median_r"],
             v["seasonality"]["n_tiles"])
    return v


def _short(m: dict) -> str:
    return f"r={m['r_log']} mdape={m['mdape']}% bias={m['bias_log']}"
