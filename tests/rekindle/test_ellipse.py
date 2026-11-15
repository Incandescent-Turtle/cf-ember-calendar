import numpy as np
import pytest

from rekindle.ellipse import (
    backing_rate,
    eccentricity,
    length_to_breadth,
    ros_normal,
    ros_polar,
)


def test_lb_zero_wind_is_circle():
    assert float(length_to_breadth(0.0)) == pytest.approx(1.0, abs=1e-12)
    assert float(eccentricity(1.0)) == 0.0


def test_lb_monotone_and_clamped():
    u = np.linspace(0, 30, 61)
    lb = length_to_breadth(u)
    assert np.all(np.diff(lb) >= 0)
    assert lb.min() >= 1.0 and lb.max() == 8.0
    # Finney 1998 eq 13 at U = 5 m/s, evaluated directly.
    assert float(length_to_breadth(5.0)) == pytest.approx(
        0.936 * np.exp(0.2566 * 5) + 0.461 * np.exp(-0.1548 * 5) - 0.397
    )


@pytest.mark.parametrize("lb", [1.0, 1.5, 2.5, 5.0, 8.0])
def test_backing_rate_and_polar(lb):
    e = float(eccentricity(lb))
    assert float(ros_polar(10.0, e, 1.0)) == pytest.approx(10.0)
    assert float(ros_polar(10.0, e, -1.0)) == pytest.approx(10.0 * (1 - e) / (1 + e))
    assert float(backing_rate(10.0, e)) == pytest.approx(10.0 * (1 - e) / (1 + e))
    # Length/width of the polar ellipse: head + back over the minor axis = LB.
    a = (10.0 + float(backing_rate(10.0, e))) / 2
    b = a * np.sqrt(1 - e * e)
    assert a / b == pytest.approx(lb)


@pytest.mark.parametrize("lb", [1.0, 2.0, 4.0])
def test_normal_speed_support_function(lb):
    e = float(eccentricity(lb))
    th = np.linspace(-np.pi, np.pi, 721)
    s = ros_normal(10.0, e, lb, np.cos(th), np.sin(th))
    rb = float(backing_rate(10.0, e))
    assert s[360] == pytest.approx(10.0)  # head
    assert s[0] == pytest.approx(rb)  # back
    assert s[180] == pytest.approx((10.0 + rb) / 2 / lb)  # flank = semi-minor b
    # Support function of the polar-ellipse points: max over the curve of p·n.
    phi = np.linspace(0, 2 * np.pi, 4001)
    r = ros_polar(10.0, e, np.cos(phi))
    px, py = r * np.cos(phi), r * np.sin(phi)
    h = np.max(np.outer(np.cos(th), px) + np.outer(np.sin(th), py), axis=1)
    assert np.allclose(s, h, rtol=2e-4, atol=1e-6)
