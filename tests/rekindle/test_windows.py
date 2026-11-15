"""EXPLORATORY re-initialised windows (hindcast --windows): window construction and scoring."""

import numpy as np

from rekindle import metrics
from rekindle.hindcast import run_windows, window_case, window_starts
from rekindle.scenario import Domain

T0 = "2026-07-27T00:00:00+00:00"


def _obs(x: float, y: float, h: float) -> dict:
    hh, mm = int(h), int(round((h - int(h)) * 60))
    day, hh = divmod(hh, 24)
    return {"x_m": x, "y_m": y, "t": f"2026-07-{27 + day:02d}T{hh:02d}:{mm:02d}:00+00:00",
            "scan": 0.4, "track": 0.4}


def _meta(obs: list[dict]) -> dict:
    wind = [{"t": f"2026-07-{27 + d:02d}T{h:02d}:00:00+00:00", "speed_ms": 0.0, "from_deg": 0.0}
            for d in range(4) for h in range(24)]
    return {"t0": T0, "observed": obs, "ignitions": [dict(obs[0], t_s=0.0)], "wind": wind}


def test_window_starts_and_cases():
    meta = _meta([_obs(5000, 5000, 0), _obs(5500, 5000, 10), _obs(6000, 5000, 30),
                  _obs(9000, 9000, 50)])
    assert window_starts(meta, 60, 24) == [0, 24, 48]
    m, dur, seed = window_case(meta, 24, 24, 60, "restart")
    assert len(m["ignitions"]) == 2 and all(g["t_s"] == 0.0 for g in m["ignitions"])
    assert dur == 24 * 3600 and seed == 0.0
    prep = metrics.prepare(m, (100, 100), 100.0, dur, seed)
    scored = [t for t in prep["first"].values() if t > seed]
    assert scored == [6 * 3600]  # only the 30 h detection, relative to the shifted t0
    m, dur, seed = window_case(meta, 48, 24, 60, "own")
    assert [g["t_s"] for g in m["ignitions"]] == [0, 10 * 3600, 30 * 3600]
    assert dur == 60 * 3600 and seed == 48 * 3600
    prep = metrics.prepare(m, (100, 100), 100.0, dur, seed)
    assert [t for t in prep["first"].values() if t > seed] == [50 * 3600]


def test_run_windows_pools_new_pixels_only():
    dom = Domain.uniform(100, 100, 100.0, fuel=1)
    meta = _meta([_obs(5000, 5000, 0), _obs(5300, 5000, 2), _obs(5000, 5600, 26)])
    r = run_windows(dom, meta, {}, 0.0, 30, 24, 1.0, 6)
    assert [w["t_k_h"] for w in r["windows"]] == [0, 24]
    assert [w["n_pixels"] for w in r["windows"]] == [1, 1]
    assert r["n_pixels"] == 2 and r["n_reached"] == 2
    assert np.isfinite(r["median_abs_timing_error_h"])
