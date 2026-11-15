"""The five solver tests from REKINDLE.md §3 (written before tuning the solver)."""

import math

import numpy as np
import pytest

from rekindle import ellipse
from rekindle.fuels import fuel_bed
from rekindle.levelset import SolverConfig, run_levelset
from rekindle.rothermel import FTMIN_TO_MS, MS_TO_FTMIN, head_fire, spread_params
from rekindle.scenario import Domain, Ignition, Moisture, Scenario, WindSample
from rekindle.simulators import LevelSetRothermel
from rekindle.verify import column_width, n_components, ray_front, ray_rate

M = Moisture()
R0 = spread_params(fuel_bed(1), M.as_tuple()).r0 * FTMIN_TO_MS  # FM 1, m/s


def expected_head(u10: float, fm: int = 1) -> tuple[float, float]:
    """(R_head m/s, LB) for a 10 m wind on flat ground."""
    p = spread_params(fuel_bed(fm), M.as_tuple())
    u_mid = u10 / 1.15 * 0.4 * MS_TO_FTMIN
    hf = head_fire(p, u_mid, 0.0, 0.0, 0.0)
    return float(hf.r_head) * FTMIN_TO_MS, float(
        ellipse.length_to_breadth(float(hf.u_eff) * FTMIN_TO_MS)
    )


def test_1_circle():
    dx, n = 10.0, 201
    dom = Domain.uniform(n, n, dx, fuel=1)
    c = n * dx / 2
    t_end = 850.0 / R0
    res = LevelSetRothermel().run(dom, Scenario((Ignition(c, c),), duration_s=t_end))
    arr = res.arrival_time_s
    assert not res.metrics["edge_reached"]
    t = 700.0 / R0
    radii = [ray_front(arr, dom, c, c, az, t, 990.0) for az in range(0, 360, 15)]
    for r in radii:
        assert abs(r - R0 * t) <= 2 * dx
    axis = np.mean([ray_rate(arr, dom, c, c, az, 100, 650) for az in (0, 90, 180, 270)])
    diag = np.mean([ray_rate(arr, dom, c, c, az, 100, 650) for az in (45, 135, 225, 315)])
    assert abs(axis - diag) / axis < 0.05
    assert axis == pytest.approx(R0, rel=0.05)
    assert diag == pytest.approx(R0, rel=0.05)


@pytest.mark.parametrize("u10", [6.0, 12.0])
def test_2_uniform_wind_ellipse(u10):
    r_head, lb = expected_head(u10)
    r_back = float(ellipse.backing_rate(r_head, ellipse.eccentricity(lb)))
    dx = 20.0
    t_end = 4000.0 / r_head
    ny = int(2 * (4000.0 / lb) / dx * 0.6) + 40
    nx = int((4000.0 + r_back * t_end) / dx) + 40
    dom = Domain.uniform(ny, nx, dx, fuel=1)
    x0, y0 = (r_back * t_end + 300.0), ny * dx / 2
    sc = Scenario((Ignition(x0, y0),), duration_s=t_end, wind=(WindSample(0, u10, 270.0),))
    res = run_levelset(dom, sc)
    arr = res.arrival_time_s
    head = ray_rate(arr, dom, x0, y0, 90.0, 500, 3500)
    assert head == pytest.approx(r_head, rel=0.05)
    t1, t2 = 0.4 * t_end, 0.95 * t_end
    length = [ray_front(arr, dom, x0, y0, 90, t, 4200) + ray_front(arr, dom, x0, y0, 270, t, 1500)
              for t in (t1, t2)]
    width = [column_width(arr, dom, t) for t in (t1, t2)]
    lb_sim = (length[1] - length[0]) / (width[1] - width[0])
    assert lb_sim == pytest.approx(lb, rel=0.10)


def test_3_two_ignitions_merge():
    dx, n = 10.0, 161
    dom = Domain.uniform(n, n, dx, fuel=1)
    c = n * dx / 2
    sep = 600.0
    igs = (Ignition(c - sep / 2, c), Ignition(c + sep / 2, c))
    t_end = 450.0 / R0
    res = run_levelset(dom, Scenario(igs, duration_s=t_end))
    arr = res.arrival_time_s
    assert n_components(np.isfinite(arr)) == 1
    early = arr <= 200.0 / R0
    assert n_components(early) == 2  # still two fires before they meet
    j_mid = int(c // dx)
    i_mid = n - 1 - int(c // dx)
    t_meet = (sep / 2 - 1.5 * dx) / R0
    assert arr[i_mid, j_mid] == pytest.approx(t_meet, rel=0.08)


@pytest.mark.parametrize("width", [1, 3])
def test_4_nonburnable_strip(width):
    dx, ny, nx = 10.0, 81, 121
    fuel = np.ones((ny, nx), dtype=np.int16)
    j0 = 60
    fuel[:, j0 : j0 + width] = 0
    dom = Domain(fuel=fuel, dx=dx)
    sc = Scenario((Ignition(30 * dx, ny * dx / 2),), duration_s=1e9,
                  wind=(WindSample(0, 10.0, 270.0),))
    res = run_levelset(dom, sc, SolverConfig(stop_at_edge=False))
    arr = res.arrival_time_s
    assert np.isfinite(arr[:, j0 - 1]).all()  # the front reached the strip along its whole length
    assert not np.isfinite(arr[:, j0:]).any()  # nothing in or behind the strip burned
    assert res.metrics["t_end_s"] < 1e9  # stopped once nothing could burn


def test_4b_edge_flag():
    dom = Domain.uniform(41, 41, 10.0, fuel=1)
    res = run_levelset(dom, Scenario((Ignition(205, 205),), duration_s=1e6))
    assert res.metrics["edge_reached"]
    assert res.metrics["t_end_s"] < 1e6


def _circle_error(dx: float) -> float:
    """Mean |T − T_exact| (s) on the ring 300–700 m, fixed 100 m ignition radius."""
    L = 1600.0
    n = int(L / dx)
    dom = Domain.uniform(n, n, dx, fuel=1)
    c = n * dx / 2
    res = run_levelset(dom, Scenario((Ignition(c, c),), duration_s=750 / R0),
                       SolverConfig(ignition_radius_m=100.0))
    x, y = dom.xy()
    r = np.hypot(x - c, y - c)
    ring = (r > 300) & (r < 700)
    exact = (r[ring] - 100.0) / R0
    return float(np.mean(np.abs(res.arrival_time_s[ring] - exact)))


def test_5_convergence():
    errs = [_circle_error(dx) for dx in (40.0, 20.0, 10.0)]
    orders = [math.log2(errs[i] / errs[i + 1]) for i in range(2)]
    assert errs[0] > errs[1] > errs[2]
    assert min(orders) > 0.5, (errs, orders)


# ---- S6: slope, wind shift, ROS multiplier, fuel interface, determinism ------------------


def test_6_slope_upslope_head():
    from rekindle.verify import slope_case

    r = slope_case()
    assert not r["edge_reached"]
    assert abs(r["head_err"]) <= 0.05
    assert r["back_ms"] < 0.5 * r["head_ms"]


def test_7_wind_shift_turns_head():
    from rekindle.verify import wind_shift_case

    r = wind_shift_case()
    rh = r["expected_head_ms"]
    assert not r["edge_reached"]
    assert r["early_E_ms"] == pytest.approx(rh, rel=0.10)
    assert r["early_N_ms"] < 0.5 * rh
    assert r["late_N_ms"] == pytest.approx(rh, rel=0.10)
    assert r["late_E_ms"] < 0.5 * rh


def test_8_ros_multiplier_scales_time():
    from rekindle.verify import multiplier_case

    r = multiplier_case(2.0)
    assert r["median_rel"] < 0.01
    assert r["frac_within_cell"] > 0.99
    assert r["burned_cells_2"] == pytest.approx(r["burned_cells_1"], rel=0.02)


def test_9_fuel_interface():
    from rekindle.verify import fuel_interface_case

    r = fuel_interface_case()
    assert r["rate_a_ms"] == pytest.approx(r["expected_a_ms"], rel=0.05)
    assert r["rate_b_ms"] == pytest.approx(r["expected_b_ms"], rel=0.10)
    assert r["monotone"]


def test_10_determinism():
    dom = Domain.uniform(80, 80, 20.0, fuel=1)
    sc = Scenario((Ignition(800, 800),), duration_s=3600.0, wind=(WindSample(0, 6.0, 250.0),))
    a, b = run_levelset(dom, sc), run_levelset(dom, sc)
    assert np.array_equal(a.arrival_time_s, b.arrival_time_s)
    assert a.params_hash == b.params_hash
