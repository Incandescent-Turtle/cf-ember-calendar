"""MODIS -> VIIRS-equivalent calibration (HARMONIZATION.md step 3) -> calibration.json.

k[s, m] = sum over overlap years of VIIRS_SNPP FCD / sum of MODIS FCD, per stratum s and
calendar month m (ratio of sums). Band = year bootstrap, 200 resamples, 5th/95th percentile.
n20 = the same fit of S-NPP over NOAA-20 on 2020-06 ... the dekad before snpp_end.

The bootstrap uses the same generator as the web (mulberry32, seed 1000 + month, linear-
interpolated percentiles), so for the same sums Python and TypeScript give identical bands.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math

import numpy as np

from pipeline import grid
from pipeline.config import Config
from pipeline.series import TileSeries

log = logging.getLogger(__name__)

BOOT_N = 200
SEED_BASE = 1000
N20_FIT = ("2020-06-01", "2026-10-31")
S_MODIS, S_SNPP, S_N20 = 0, 1, 2


# --------------------------------------------------------------- bootstrap RNG
def mulberry32(seed: int):
    """Bit-exact twin of mulberry32 in web/src/lib/harmonize.ts."""
    state = seed & 0xFFFFFFFF
    m32 = 0xFFFFFFFF

    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & m32
        x = ((state ^ (state >> 15)) * (1 | state)) & m32
        x = ((x + (((x ^ (x >> 7)) * (61 | x)) & m32)) & m32) ^ x
        return ((x ^ (x >> 14)) & m32) / 4294967296

    return rnd


_IDX_CACHE: dict[tuple[int, int], np.ndarray] = {}


def boot_indices(month: int, n_years: int) -> np.ndarray:
    """(BOOT_N, n_years) year indices, in the order the web draws them."""
    key = (month, n_years)
    if key not in _IDX_CACHE:
        rnd = mulberry32(SEED_BASE + month)
        _IDX_CACHE[key] = np.array(
            [[math.floor(rnd() * n_years) for _ in range(n_years)] for _ in range(BOOT_N)],
            dtype=np.int64).reshape(BOOT_N, n_years)
    return _IDX_CACHE[key]


# ------------------------------------------------------------------ ratio fit
def month_year_sums(num: np.ndarray, den: np.ndarray, t0: int, t_a: int, t_b: int):
    """Per calendar month: (years, N[..., nY], D[..., nY]) over dekads in [t_a, t_b] ∩ record.

    `num`/`den` are (..., nT) arrays starting at t0. A year appears for a month only if at
    least one dekad of that month falls inside the range (same as the web's Map)."""
    n_t = num.shape[-1]
    lo, hi = max(t_a, t0), min(t_b, t0 + n_t - 1)
    out = []
    for m in range(12):
        years: list[int] = []
        ns, ds = [], []
        for t in range(lo, hi + 1):
            if grid.dekad_month(t) != m:
                continue
            y = t // 36
            if not years or years[-1] != y:
                years.append(y)
                ns.append(np.zeros(num.shape[:-1]))
                ds.append(np.zeros(num.shape[:-1]))
            ns[-1] = ns[-1] + num[..., t - t0]
            ds[-1] = ds[-1] + den[..., t - t0]
        shape = num.shape[:-1] + (0,)
        out.append((years,
                    np.stack(ns, axis=-1) if ns else np.zeros(shape),
                    np.stack(ds, axis=-1) if ds else np.zeros(shape)))
    return out


def fit_ratio(num: np.ndarray, den: np.ndarray, t0: int, t_a: int, t_b: int) -> dict:
    """Ratio of sums per calendar month with the year-bootstrap band.

    num/den: (..., nT). Returns dict of arrays shaped (..., 12): k, lo, hi, den (NaN = undefined).
    """
    lead = num.shape[:-1]
    res = {key: np.full(lead + (12,), np.nan) for key in ("k", "lo", "hi", "den")}
    for m, (years, n_sum, d_sum) in enumerate(month_year_sums(num, den, t0, t_a, t_b)):
        big_n, big_d = n_sum.sum(-1), d_sum.sum(-1)
        res["den"][..., m] = big_d
        with np.errstate(invalid="ignore", divide="ignore"):
            res["k"][..., m] = np.where(big_d > 0, big_n / np.where(big_d > 0, big_d, 1), np.nan)
        if not years:
            continue
        idx = boot_indices(m, len(years))
        bn = n_sum[..., idx].sum(-1)  # (..., BOOT_N)
        bd = d_sum[..., idx].sum(-1)
        with np.errstate(invalid="ignore", divide="ignore"):
            ratio = np.where(bd > 0, bn / np.where(bd > 0, bd, 1), np.nan)
        valid = np.isfinite(ratio).any(-1)
        if valid.any():
            q = np.full(lead + (2,), np.nan)
            q[valid] = np.nanquantile(ratio[valid], [0.05, 0.95], axis=-1).T
            res["lo"][..., m] = q[..., 0]
            res["hi"][..., m] = q[..., 1]
    return res


# ------------------------------------------------------------------- windows
def overlap_window(cfg: Config) -> tuple[int, int]:
    return (grid.dekad_index(dt.date.fromisoformat(cfg.cal_start)),
            grid.dekad_index(dt.date.fromisoformat(cfg.cal_end)))


def n20_window(cfg: Config) -> tuple[int, int]:
    t_n20 = grid.dekad_index(dt.date.fromisoformat(cfg.snpp_end))
    return (grid.dekad_index(dt.date.fromisoformat(N20_FIT[0])),
            min(grid.dekad_index(dt.date.fromisoformat(N20_FIT[1])), t_n20 - 1))


# --------------------------------------------------------------------- JSON
def _num(x: float, nd: int = 6) -> float | None:
    return round(float(x), nd) if np.isfinite(x) else None


def _block(fit: dict, i=None, with_n: bool = True) -> dict:
    get = (lambda key: fit[key]) if i is None else (lambda key: fit[key][i])
    b = {key: [_num(v) for v in get(key)] for key in ("k", "lo", "hi")}
    if with_n:
        b["n_modis"] = [int(v) for v in get("den")]
    return b


def calibrate(ts: TileSeries, cfg: Config) -> dict:
    t_a, t_b = overlap_window(cfg)
    fit_t = fit_ratio(ts.fcd[:, S_SNPP], ts.fcd[:, S_MODIS], ts.t0, t_a, t_b)
    tot = ts.total()
    fit_g = fit_ratio(tot[S_SNPP], tot[S_MODIS], ts.t0, t_a, t_b)
    n_a, n_b = n20_window(cfg)
    fit_nt = fit_ratio(ts.fcd[:, S_SNPP], ts.fcd[:, S_N20], ts.t0, n_a, n_b)
    fit_ng = fit_ratio(tot[S_SNPP], tot[S_N20], ts.t0, n_a, n_b)

    tile = {tl: _block(fit_t, i) for i, tl in enumerate(ts.tiles)
            if fit_t["den"][i].sum() > 0}
    n20_tile = {tl: _block(fit_nt, i) for i, tl in enumerate(ts.tiles)
                if fit_nt["den"][i].sum() > 0}
    return {
        "global": _block(fit_g),
        "tile": tile,
        "n20": {"global": _block(fit_ng), "tile": n20_tile},
        "params": {
            "overlap": [cfg.cal_start, cfg.cal_end],
            "n20_fit": [grid.dekad_range(n_a)[0].isoformat(),
                        grid.dekad_range(min(n_b, ts.t0 + ts.n_t - 1))[1].isoformat()],
            "min_modis_fcd": cfg.cal_min_modis_fcd,
            "bootstrap": {"n": BOOT_N, "rng": "mulberry32(1000 + month)",
                          "percentiles": [5, 95], "interpolation": "linear"},
        },
    }


def summarize(cal: dict, min_n: int) -> dict:
    """Numbers for the log / handoff note."""
    g = cal["global"]
    tk = [k for b in cal["tile"].values() for k, n in zip(b["k"], b["n_modis"])
          if k is not None and n >= min_n]
    n20 = [k for k in cal["n20"]["global"]["k"] if k is not None]
    return {
        "global_k": [g["k"][m] for m in range(12)],
        "global_k_range": [min(x for x in g["k"] if x is not None),
                           max(x for x in g["k"] if x is not None)] if any(g["k"]) else None,
        "tile_k_p5_p50_p95": [round(float(np.percentile(tk, q)), 3) for q in (5, 50, 95)]
        if tk else None,
        "n_tiles": len(cal["tile"]),
        "n_tile_months_usable": len(tk),
        "k_n20_range": [min(n20), max(n20)] if n20 else None,
    }


def write_calibration(ts: TileSeries, cfg: Config) -> dict:
    cal = calibrate(ts, cfg)
    path = cfg.processed / "calibration.json"
    path.write_text(json.dumps(cal, separators=(",", ":")), encoding="utf-8")
    s = summarize(cal, cfg.cal_min_modis_fcd)
    log.info("calibration: global k %s..%s | tile k p5/p50/p95 %s (%d tile-months >= %d) | "
             "k_N20 %s | %d tiles -> %s",
             *(s["global_k_range"] or [None, None]), s["tile_k_p5_p50_p95"],
             s["n_tile_months_usable"], cfg.cal_min_modis_fcd, s["k_n20_range"],
             s["n_tiles"], path)
    return s
