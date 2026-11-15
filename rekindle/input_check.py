"""Input sanity checks (S6b): observed apparent spread vs Rothermel at our inputs; weather; fuels.

    uv run python -m rekindle.input_check
"""

import numpy as np

from rekindle import domain as dm
from rekindle.fuels import fuel_bed
from rekindle.hindcast import emc_series, ignition_elevation, moisture
from rekindle.rothermel import FTMIN_TO_MS, MS_TO_FTMIN, head_fire, spread_params

for fire in ("chilecito-2026", "cordoba-2024"):
    dom, meta = dm.load(fire)
    d = np.load(dm.DATA / fire / "domain.npz")
    t0 = dm.parse_t(meta["t0"])
    ig = np.array([(g["x_m"], g["y_m"]) for g in meta["ignitions"]])
    rows = []
    for o in meta["observed"]:
        t = (dm.parse_t(o["t"]) - t0).total_seconds()
        if t <= 0:
            continue
        dist = np.min(np.hypot(ig[:, 0] - o["x_m"], ig[:, 1] - o["y_m"]))
        rows.append((t / 3600, dist / 1000))
    r = np.array(rows)
    print(f"\n===== {fire}: {len(meta['observed'])} detections, t0 {meta['t0']}")
    # apparent spread: distance from ignition vs first time seen (upper-bound times => lower-bound speed)
    for hh in (3, 6, 12, 24, 48, 72, 96, 120):
        sel = r[r[:, 0] <= hh]
        if len(sel):
            print(f"  by {hh:3d} h: max distance from ignition {sel[:, 1].max():5.1f} km, "
                  f"p90 {np.percentile(sel[:, 1], 90):5.1f} km  (n={len(sel)})")
    # cumulative detection footprint by day (scan x track)
    t_list = sorted(((dm.parse_t(o["t"]) - t0).total_seconds() / 3600, o["scan"] * o["track"])
                    for o in meta["observed"])
    # weather
    elev = ignition_elevation(fire, meta, dom)
    ser = [(t / 3600, rh, e) for t, rh, e in emc_series(meta, elev) if 0 <= t / 3600 <= 120]
    T = np.array([w["t2m_c"] for w in meta["wind"]])
    U = np.array([w["speed_ms"] for w in meta["wind"]])
    rh = np.array([x[1] for x in ser])
    print(f"  ignition elev {elev:.0f} m; MERRA-2 T2M {T.min():.1f}..{T.max():.1f} C; "
          f"RH {rh.min():.0f}..{rh.max():.0f} % (median {np.median(rh):.0f}); "
          f"10 m wind p50/p90/max {np.percentile(U, 50):.1f}/{np.percentile(U, 90):.1f}/{U.max():.1f} m/s")
    # fuels under detections vs domain
    ny = dom.shape[0]
    fm_det = [int(d["fuel"][int((ny * dom.dx - o["y_m"]) // dom.dx), int(o["x_m"] // dom.dx)])
              for o in meta["observed"]]
    vals, cnt = np.unique(fm_det, return_counts=True)
    vd, cd = np.unique(d["fuel"], return_counts=True)
    print("  fuel models under detections:", dict(zip(vals.tolist(), cnt.tolist())),
          " domain:", {int(k): f"{v / d['fuel'].size:.0%}" for k, v in zip(vd, cd)})
    # Rothermel head ROS at our inputs, flat ground, WAF 0.4
    m = moisture(6).as_tuple()
    for fm in sorted(set(vals.tolist()) - {0}):
        p = spread_params(fuel_bed(fm), m)
        out = []
        for u10 in (np.percentile(U, 50), np.percentile(U, 90)):
            hf = head_fire(p, u10 / 1.15 * 0.4 * MS_TO_FTMIN, 0.0, 0.0, 0.0)
            out.append(float(hf.r_head) * FTMIN_TO_MS * 3.6)
        print(f"  Rothermel FM{fm} @ 6 % dead: R0 {p.r0 * FTMIN_TO_MS * 3.6:.2f} km/h; head at "
              f"wind p50 {out[0]:.2f} km/h, p90 {out[1]:.2f} km/h")
