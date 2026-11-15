"""calibrate / harmonize / analytics / validate on small synthetic series."""

import datetime as dt
import math

import numpy as np
import pytest

from pipeline import analytics, calibrate, grid
from pipeline.config import Config
from pipeline.harmonize import harmonize, month_percentile
from pipeline.series import TileSeries
from pipeline.validate import loyo, monthly, seam_scope, seasonality

T = lambda s: grid.dekad_index(dt.date.fromisoformat(s))
T0, T1 = T("2000-11-01"), T("2026-11-14")
NT = T1 - T0 + 1
MANIFEST = {"overlap": {"start": "2013-01-01", "end": "2021-12-31"},
            "snpp_end": "2026-11-02", "min_modis_fcd": 200}


def synthetic(modis=10.0, snpp=25.0, n20=20.0) -> np.ndarray:
    """Same AOI as web/src/lib/harmonize.test.ts: one tile, constant per dekad."""
    a = np.zeros((1, 4, NT))
    t = np.arange(T0, T1 + 1)
    a[0, 0] = modis
    a[0, 1] = np.where(t >= T("2012-01-21"), snpp, 0)
    a[0, 2] = np.where(t >= T("2018-04-01"), n20, 0)
    return a


def test_mulberry32_matches_js():
    # values printed by the TS mulberry32 (node) for seed 1005
    r = calibrate.mulberry32(1005)
    assert [r() for _ in range(3)] == [0.41839275509119034, 0.6922517050988972, 0.5468205728102475]


def test_fit_ratio_ratio_of_sums_and_band():
    num = np.zeros(NT)
    den = np.zeros(NT)
    t = np.arange(T0, T1 + 1)
    yrs = 2000 + t // 36
    den[:] = 10
    num[:] = 10 * (2 + (yrs - 2013) * 0.1)  # k drifts by year: 2.0 ... 2.8 over 2013-2021
    f = calibrate.fit_ratio(num, den, T0, T("2013-01-01"), T("2021-12-31"))
    assert f["k"][0] == pytest.approx(2.4)
    assert f["den"][0] == 9 * 3 * 10
    assert 2.0 < f["lo"][0] < 2.4 < f["hi"][0] < 2.8


def test_fit_ratio_partial_year_months_skip_absent_years():
    # n20 window starts in June: Jan-May of 2020 must not count 2020 as a year
    num = np.ones(NT)
    f = calibrate.fit_ratio(num, num, T0, T("2020-06-01"), T("2021-12-31"))
    yrs = calibrate.month_year_sums(num, num, T0, T("2020-06-01"), T("2021-12-31"))
    assert len(yrs[0][0]) == 1 and len(yrs[6][0]) == 2
    assert f["k"][0] == 1.0


def test_harmonize_matches_web_synthetic():
    h = harmonize(synthetic(), ["S30W070"], T0, MANIFEST, None)
    row = lambda y, m: h["rows"][(y - h["years"][0]) * 12 + m]
    assert h["k_modis"][0]["stratum"] == "aoi"
    assert h["k_modis"][0]["k"] == pytest.approx(2.5)
    assert row(2011, 11)["harmonized"] == pytest.approx(row(2012, 2)["harmonized"])
    assert row(2011, 11)["spliced"] == pytest.approx(30)
    assert row(2012, 2)["spliced"] == 75
    assert row(2012, 0)["era"] == "modis" and row(2012, 1)["era"] == "snpp"
    # the dekad containing snpp_end (Nov 1-10 2026) is NOAA-20 era, scaled by 25/20
    assert row(2026, 10)["era"] == "n20"
    assert h["k_n20"][10]["k"] == pytest.approx(1.25)
    assert row(2026, 10)["harmonized"] == pytest.approx(2 * 25)
    assert row(2026, 10)["partial"]


def test_harmonize_fallbacks():
    a = synthetic(modis=1.0)  # 27 MODIS FCD per month in the overlap < 200
    tile = {"k": [3.0] * 12, "lo": [2.0] * 12, "hi": [4.0] * 12, "n_modis": [500] * 12}
    glob = {"k": [2.0] * 12, "lo": [1.5] * 12, "hi": [2.5] * 12}
    cal = {"global": glob, "tile": {"S30W070": tile}, "n20": {"global": glob, "tile": {}}}
    h = harmonize(a, ["S30W070"], T0, MANIFEST, cal)
    assert h["k_modis"][0]["stratum"] == "tile" and h["k_modis"][0]["k"] == 3.0
    cal["tile"]["S30W070"]["n_modis"] = [100] * 12  # tile below threshold -> global
    h = harmonize(a, ["S30W070"], T0, MANIFEST, cal)
    assert h["k_modis"][0]["stratum"] == "global" and h["k_modis"][0]["k"] == 2.0
    h = harmonize(a, ["S30W070"], T0, MANIFEST, None)
    assert h["k_modis"][0]["stratum"] == "aoi-sparse"
    assert h["k_modis"][0]["k"] == pytest.approx(25.0)


def test_month_percentile_mid_rank():
    h = harmonize(synthetic(), ["S30W070"], T0, MANIFEST, None)
    # every complete July is 75 FCD -> a tie with all of them is the 50th percentile
    assert month_percentile(h, 6, 75, 2026) == pytest.approx(50)
    assert month_percentile(h, 6, 1000, 2026) == 100


def test_calibrate_tiles_and_global():
    fcd = np.concatenate([synthetic(), synthetic(modis=0.0)], axis=0)
    ts = TileSeries(tiles=["S30W070", "S40W070"], t0=T0, fcd=fcd, det=fcd * 3)
    cal = calibrate.calibrate(ts, Config())
    assert cal["global"]["k"][0] == pytest.approx(5.0)  # tile 2 adds S-NPP, no MODIS
    assert cal["tile"]["S30W070"]["n_modis"][0] == 270
    assert "S40W070" not in cal["tile"]  # no overlap MODIS at all -> not written
    assert cal["n20"]["global"]["k"][5] == pytest.approx(1.25)


def test_analytics_rules():
    assert analytics.quantile([1, 2, 3, 4], 0.5) == 2.5
    clim = analytics.climatology([0, 0, 0])
    assert analytics.label(0, clim) == "normal"
    assert analytics.label(5, clim) == "extreme"
    cp = analytics.critical_period([0, 0, 0, 0, 0, 10, 50, 30, 10, 0, 0, 0])
    assert cp["start_month"] == 6 and cp["length"] == 2
    cp = analytics.critical_period([40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40])  # wraps
    assert cp["start_month"] == 11 and cp["length"] == 2
    tr = analytics.trend(list(range(2001, 2011)), [10 + 2 * i for i in range(10)])
    assert tr["slope_per_year"] == 2 and tr["p"] < 0.01
    assert analytics.mann_kendall([1, 1, 1])["z"] == 0
    mtd = analytics.month_to_date([5, 5], [[1, 1, 100], [2, 2, 100], [3, 3, 100]])
    assert mtd["ratio"] == pytest.approx(2.5) and mtd["percentile"] == 100


def test_monthly_marks_partial_months():
    y0, m = monthly(np.ones(NT), T0)
    assert y0 == 2000 and math.isnan(m[0, 0]) and m[0, 10] == 3
    assert math.isnan(m[26, 10])  # Nov 2026: 2 dekads


def test_validate_on_synthetic():
    fcd = np.concatenate([synthetic(), synthetic(modis=40.0, snpp=60.0)], axis=0)
    ts = TileSeries(tiles=["S30W070", "S40W070"], t0=T0, fcd=fcd, det=fcd * 2)
    lv = {x["level"]: x for x in loyo(ts, Config())["levels"]}
    assert lv["tile"]["calibrated"]["mdape"] == pytest.approx(0)
    assert lv["tile"]["fcd_uncalibrated"]["mdape"] > 30
    sc = seam_scope("t", fcd[:1], ["S30W070"], T0, MANIFEST, None)
    assert sc["test"]["mean_log_diff_after"] == pytest.approx(0, abs=1e-9)
    assert sc["test"]["mean_log_diff_before"] > 0.5
    assert seasonality(ts, None, Config())["n_tiles"] == 0  # flat cycles are skipped
