"""Compare a simulated arrival-time field with the fire's own hotspots (REKINDLE.md §5).

Each detection is a pixel footprint (scan × track km, axis-aligned approximation) seen at
overpass time t_obs, an *upper bound* on when the fire reached that pixel. The simulated
arrival in a pixel is the earliest arrival over the 90 m cells inside its footprint.

- timing error Δ = T_sim − t_obs for each pixel's first detection (ignition pixels excluded).
  Pixels the simulation never reaches get Δ = +inf (they count against |Δ|, never silently
  dropped). Reported: median, IQR, median |Δ|.
- hit rate: share of detections with T_sim ≤ t_obs + time to the next overpass.
- consistent: share of first detections with t_prev_overpass < T_sim ≤ t_obs (the sim arrives
  between the last pass that missed it and the pass that saw it). Extra; not in the gate.
- Sørensen 2|A∩B|/(|A|+|B|) between the simulated burned area at the end and the union of
  all detection footprints up to the end; false-alarm area = simulated burned outside it.
"""

from __future__ import annotations

import numpy as np

from rekindle.domain import parse_t


def _footprint(o: dict, dx: float, ny: int, nx: int) -> tuple[slice, slice]:
    hx = max(o["scan"] * 500.0, dx / 2)  # scan km → half-width m
    hy = max(o["track"] * 500.0, dx / 2)
    j0 = int(np.floor((o["x_m"] - hx) / dx))
    j1 = int(np.ceil((o["x_m"] + hx) / dx))
    i0 = int(np.floor((ny * dx - (o["y_m"] + hy)) / dx))
    i1 = int(np.ceil((ny * dx - (o["y_m"] - hy)) / dx))
    return slice(max(i0, 0), min(i1, ny)), slice(max(j0, 0), min(j1, nx))


def prepare(meta: dict, shape: tuple[int, int], dx: float, t_end_s: float) -> dict:
    """Observation geometry, independent of the run (compute once per fire)."""
    ny, nx = shape
    t0 = parse_t(meta["t0"])
    obs = []
    for o in meta["observed"]:
        t = (parse_t(o["t"]) - t0).total_seconds()
        if t <= t_end_s:
            obs.append((t, _footprint(o, dx, ny, nx), o))
    passes = np.array(sorted({t for t, _, _ in obs}))
    gaps = np.diff(passes)
    # First detection per pixel: group by footprint (same pixel seen again keeps the earliest).
    first: dict[tuple, float] = {}
    for t, fp, _ in obs:
        key = (fp[0].start, fp[0].stop, fp[1].start, fp[1].stop)
        first[key] = min(first.get(key, np.inf), t)
    union = np.zeros(shape, dtype=bool)
    for _, fp, _ in obs:
        union[fp] = True
    return {"obs": obs, "passes": passes, "first": first, "union": union,
            "overpass_median_h": float(np.median(gaps) / 3600) if gaps.size else float("nan"),
            "overpass_mean_h": float(np.mean(gaps) / 3600) if gaps.size else float("nan"),
            "t_end_s": t_end_s, "dx": dx}


def score(arrival_s: np.ndarray, prep: dict) -> dict:
    passes, dx = prep["passes"], prep["dx"]
    t_end = prep["t_end_s"]

    def t_sim(key) -> float:
        a = arrival_s[key[0]:key[1], key[2]:key[3]]
        return float(a.min()) if a.size else np.inf

    deltas, consistent = [], []
    for key, t in prep["first"].items():
        if t <= 0:
            continue  # ignition pixels
        ts = t_sim(key)
        deltas.append(ts - t)
        prev = passes[passes < t]
        t_prev = prev[-1] if prev.size else -np.inf
        consistent.append(t_prev < ts <= t)
    d = np.array(deltas) / 3600.0
    hits = []
    for t, fp, _ in prep["obs"]:
        if t <= 0:
            continue
        nxt = passes[passes > t]
        horizon = nxt[0] if nxt.size else t_end
        a = arrival_s[fp]
        hits.append(bool(a.size and a.min() <= horizon))
    burned = np.isfinite(arrival_s) & (arrival_s <= t_end)
    union = prep["union"]
    inter = int((burned & union).sum())
    cell_km2 = dx * dx / 1e6
    fin = d[np.isfinite(d)]
    return {
        "n_pixels": int(d.size),
        "n_reached": int(fin.size),
        "median_timing_error_h": float(np.median(d)) if d.size else None,
        "iqr_h": [float(np.percentile(d, 25)), float(np.percentile(d, 75))] if d.size else None,
        "median_abs_timing_error_h": float(np.median(np.abs(d))) if d.size else None,
        "hit_rate": float(np.mean(hits)) if hits else None,
        "consistent_rate": float(np.mean(consistent)) if consistent else None,
        "sorensen": 2 * inter / max(int(burned.sum()) + int(union.sum()), 1),
        "false_alarm_km2": float((burned & ~union).sum() * cell_km2),
        "missed_km2": float((union & ~burned).sum() * cell_km2),
        "area_km2": float(burned.sum() * cell_km2),
        "observed_footprint_km2": float(union.sum() * cell_km2),
    }


def json_safe(m: dict) -> dict:
    """inf → None so the dict can go into JSON."""
    out = {}
    for k, v in m.items():
        if isinstance(v, float) and not np.isfinite(v):
            out[k] = None
        elif isinstance(v, list):
            out[k] = [None if isinstance(x, float) and not np.isfinite(x) else x for x in v]
        else:
            out[k] = v
    return out
