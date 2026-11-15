"""S6c burst-window what-ifs: the pre-registered window rule and the perturbations."""

from rekindle.burst import evaluate, perturb, run_key
from rekindle.scenario import Moisture, MoistureSample, Scenario, WindSample


def _w(err, sor, n, t_k, hit=0.9):
    return {"median_abs_timing_error_h": err, "median_timing_error_h": err, "sorensen": sor,
            "n_pixels": n, "hit_rate": hit, "t_k_h": t_k, "area_km2": 10.0,
            "observed_footprint_km2": 5.0}


def test_rule_picks_own_best_multiplier_and_applies_all_three_tests():
    win = {"gate": {"threshold_h": 3.0}, "window_h": 24.0, "hours": 90.0, "sweep": [
        {"ros_multiplier": 0.5, "windows": [_w(5.0, 0.6, 200, 0), _w(2.0, 0.5, 100, 24),
                                            _w(1.0, 0.2, 100, 48), _w(None, None, 0, 72)]},
        {"ros_multiplier": 1.0, "windows": [_w(4.0, 0.5, 200, 0), _w(2.5, 0.4, 100, 24),
                                            _w(2.0, 0.6, 40, 48), _w(None, None, 0, 72)]},
    ]}
    ev = evaluate(win)
    assert [e["ros_multiplier"] for e in ev[:3]] == [1.0, 0.5, 0.5]
    assert [e["qualifies"] for e in ev] == [False, True, False, False]
    assert "gate" in ev[0]["reasons"][0]
    assert any("Sørensen" in r for r in ev[2]["reasons"])
    assert ev[3]["median_abs_timing_error_h"] is None
    assert any("only 18 h long" in r for r in ev[3]["reasons"])  # 72 → 90 h tail window


def test_perturb_scales_wind_and_shifts_moisture_with_floor():
    sc = Scenario(ignitions=(), duration_s=3600, wind=(WindSample(0, 4.0, 270),),
                  moisture=Moisture(d1=0.03), moisture_series=(MoistureSample(0, 0.03, 0.05, 0.10),))
    p = perturb(sc, 1.5, -2)
    assert p.wind[0].speed_ms == 6.0 and p.wind[0].from_deg == 270
    assert p.moisture_series[0].d1 == 0.02  # floor
    assert abs(p.moisture_series[0].d10 - 0.03) < 1e-12
    assert p.moisture.herb == sc.moisture.herb  # live moisture unchanged
    assert run_key(1, 1.5, -2) == "w1_u150_dm2" and run_key(0, 0.0, 4) == "w0_u000_dp4"
