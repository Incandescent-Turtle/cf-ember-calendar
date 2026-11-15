import math

import numpy as np
import pytest

from rekindle.fuels import IGBP_TO_FM, anderson13, fuel_bed, igbp_to_fuel
from rekindle.rothermel import (
    FTMIN_TO_MS,
    MS_TO_FTMIN,
    TONS_AC_TO_LB_FT2,
    FuelBed,
    head_fire,
    ros_si,
    spread_params,
    wind_10m_to_midflame,
    wind_from_to_toward_az,
)

DRY = (0.06, 0.07, 0.08, 0.60, 0.90)


# Published reference: Andrews 2018 (RMRS-GTR-371) Table 17, rows 1-3 (BehavePlus 6).
# Inputs (table + footnote): 2 ton/ac total dead load, 1-h SAV 2500, 10-h SAV 109, depth 1 ft,
# dead moisture 5 %, Mx 20 %, midflame wind 5 mi/h, no slope, no live fuel.
@pytest.mark.parametrize(
    ("w1h", "w10h", "sigma", "beta_op", "ratio", "phi_w", "ros"),
    [
        (2.0, 0.0, 2500, 0.0055, 0.5195, 17.8, 81.6),
        (1.0, 1.0, 2400, 0.0057, 0.5025, 17.9, 40.2),
        (0.1, 1.9, 1417, 0.0088, 0.3263, 20.8, 32.0),
    ],
)
def test_andrews2018_table17(w1h, w10h, sigma, beta_op, ratio, phi_w, ros):
    t = TONS_AC_TO_LB_FT2
    bed = FuelBed(
        w0=(w1h * t, w10h * t, 0, 0, 0),
        sav=(2500, 109 if w10h else 0, 0, 0, 0),
        depth=1.0,
        mx_dead=0.20,
    )
    p = spread_params(bed, (0.05, 0.05, 0.05, 0, 0))
    hf = head_fire(p, 5 * 88.0, 0.0, 0.0, 0.0)
    assert p.rho_b == pytest.approx(0.0918, abs=5e-5)
    assert p.beta == pytest.approx(0.0029, abs=5e-5)
    assert p.sigma == pytest.approx(sigma, abs=0.5)
    assert p.beta / p.beta_ratio == pytest.approx(beta_op, abs=5e-5)
    assert p.beta_ratio == pytest.approx(ratio, abs=5e-5)
    assert float(p.phi_wind(440.0)) == pytest.approx(phi_w, abs=0.05)
    assert float(hf.r_head) == pytest.approx(ros, rel=0.01)


# Regression (NOT published values): our own implementation's output, frozen on 2026-11-15
# after the Table 17 check above passed. Guards against accidental changes.
@pytest.mark.parametrize(
    ("fm", "r0", "ir", "r_head"),
    [(1, 4.604659257521551, 825.4621925470148, 120.33491859191423),
     (4, 4.897229199358372, 12001.168845372034, 102.05893838471987)],
)
def test_regression_fm1_fm4(fm, r0, ir, r_head):
    p = spread_params(fuel_bed(fm), DRY)
    hf = head_fire(p, 5 * 88.0, 0.0, 0.3, 0.0)
    assert p.r0 == pytest.approx(r0, rel=1e-9)
    assert p.ir == pytest.approx(ir, rel=1e-9)
    assert float(hf.r_head) == pytest.approx(r_head, rel=1e-9)


@pytest.mark.parametrize("fm", range(1, 14))
def test_monotone_wind_slope_moisture(fm):
    bed = fuel_bed(fm)
    p = spread_params(bed, DRY)
    assert p.r0 > 0
    winds = np.array([0, 50, 200, 500, 1000.0])
    r_w = head_fire(p, winds, 0.0, 0.0, 0.0).r_head
    assert np.all(np.diff(r_w) > 0)
    slopes = np.tan(np.radians([0, 10, 20, 30, 40.0]))
    r_s = head_fire(p, 0.0, 0.0, slopes, 0.0).r_head
    assert np.all(np.diff(r_s) > 0)
    r_m = [spread_params(bed, (m, m + 0.01, m + 0.02, 0.6, 0.9)).r0 for m in (0.03, 0.06, 0.09)]
    assert r_m[0] > r_m[1] > r_m[2]


@pytest.mark.parametrize("fm", [1, 3, 6, 8, 9, 11, 12, 13])  # dead-only models
def test_zero_at_extinction(fm):
    bed = fuel_bed(fm)
    m = bed.mx_dead
    assert spread_params(bed, (m, m, m, 0, 0)).r0 == pytest.approx(0.0, abs=1e-9)
    assert spread_params(bed, (m + 0.05,) * 3 + (0, 0)).r0 == pytest.approx(0.0, abs=1e-9)


def test_live_mx_floor_and_live_damping():
    bed = fuel_bed(2)
    p = spread_params(bed, DRY)
    assert p.mx_live >= bed.mx_dead
    wet = spread_params(bed, (0.06, 0.07, 0.08, 3.0, 3.0))
    assert wet.r0 < p.r0  # wetter live fuel spreads slower


def test_wind_and_slope_vectors():
    p = spread_params(fuel_bed(1), DRY)
    tan = math.tan(math.radians(20))
    aligned = head_fire(p, 300.0, 0.0, tan, 0.0)
    opposed = head_fire(p, 300.0, 0.0, tan, math.pi)
    cross = head_fire(p, 300.0, 0.0, tan, math.pi / 2)
    phw, phs = float(p.phi_wind(300.0)), float(p.phi_slope(tan))
    assert float(aligned.phi_e) == pytest.approx(phw + phs)
    assert float(opposed.phi_e) == pytest.approx(abs(phw - phs))
    assert float(cross.phi_e) == pytest.approx(math.hypot(phw, phs))
    assert float(cross.head_az) == pytest.approx(math.atan2(phs, phw))
    # U_E inverts φ_w: wind alone gives U_E = U.
    assert float(head_fire(p, 300.0, 0.0, 0.0, 0.0).u_eff) == pytest.approx(300.0)


def test_wind_limit_flag():
    p = spread_params(fuel_bed(1), DRY)
    strong = 5000.0  # ft/min, far above 0.9 I_R
    off = head_fire(p, strong, 0.0, 0.0, 0.0)
    on = head_fire(p, strong, 0.0, 0.0, 0.0, wind_limit=True)
    assert not bool(off.wind_limited) and bool(on.wind_limited)
    assert float(on.u_eff) == pytest.approx(0.9 * p.ir)
    assert float(on.r_head) < float(off.r_head)


def test_units_round_trip():
    assert MS_TO_FTMIN * FTMIN_TO_MS == pytest.approx(1.0)
    assert 1.0 * MS_TO_FTMIN == pytest.approx(196.8504, rel=1e-6)
    assert float(wind_10m_to_midflame(11.5, waf=0.4)) == pytest.approx(4.0)
    assert float(wind_from_to_toward_az(270.0)) == pytest.approx(math.pi / 2)  # W wind → east
    assert float(wind_from_to_toward_az(90.0)) == pytest.approx(3 * math.pi / 2)
    out = ros_si(fuel_bed(1), DRY, u_mid_ms=2.0)
    p = spread_params(fuel_bed(1), DRY)
    ref = float(head_fire(p, 2.0 * MS_TO_FTMIN, 0, 0, 0).r_head)
    assert out["r_head_ms"] == pytest.approx(ref * FTMIN_TO_MS)
    assert out["head_deg"] == pytest.approx(0.0)


def test_fuel_table():
    fms = anderson13()
    assert sorted(fms) == list(range(1, 14))
    fm1 = fms[1].bed
    assert fm1.w0[0] == pytest.approx(0.034, abs=1e-4)  # 0.74 t/ac = 0.034 lb/ft²
    assert fm1.sav[0] == 3500 and fm1.depth == 1.0 and fm1.mx_dead == 0.12
    fm4 = fms[4].bed
    assert fm4.w0[4] > 0 and fm4.w0[3] == 0 and fm4.sav[4] == 1500  # live woody
    fm2 = fms[2].bed
    assert fm2.w0[3] > 0 and fm2.sav[3] == 1500  # live herbaceous
    assert fms[7].bed.sav[4] == 1550 and fms[7].bed.mx_dead == 0.40
    assert fms[13].bed.w0[2] == pytest.approx(28.05 * TONS_AC_TO_LB_FT2)


def test_crosswalk():
    assert igbp_to_fuel(1) == 10 and igbp_to_fuel(4) == 9
    assert igbp_to_fuel(6) == 4 and igbp_to_fuel(7) == 6 and igbp_to_fuel(10) == 1
    assert all(igbp_to_fuel(c) == 0 for c in (11, 13, 15, 16, 17, 0, 255))
    assert igbp_to_fuel(10, {10: 3}) == 3
    assert set(IGBP_TO_FM) == set(range(1, 18))
    assert fuel_bed(0) is None
