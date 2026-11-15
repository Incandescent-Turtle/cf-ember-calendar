"""Analytics on a harmonized series (HARMONIZATION.md -> Analytics). Python reference for
the TypeScript implementation; tests/golden/analytics_cases.json pins the rules below.

Rules (the spec, stated once):
- quantile(xs, q): linear interpolation on sorted xs at position (n - 1) * q (numpy "linear").
- climatology per calendar month over the baseline years: median, p10, p25, p75, p90.
- percentile(value, base): mid-rank, 100 * (#below + 0.5 * #equal) / n.
- label(value, clim): value < p25 "below"; value <= p75 "normal"; value < p90 "above";
  else "extreme". Checked in that order, so an all-zero history labels 0 as "normal".
- z = (log1p(value) - mean(log1p(base))) / sd(log1p(base)), sd with ddof = 1; null if
  n < 2 or sd == 0.
- month-to-date: the first d dekads of the current month vs the same d dekads of that
  month in each baseline year; ratio = current / median(base) (null if median is 0),
  percentile and label as above with the climatology of those partial sums.
- critical period: shortest run of consecutive calendar months (wrapping Dec -> Jan)
  whose median sum >= 60 % of the annual median-sum; ties -> larger sum, then earlier start.
  null if the medians sum to 0.
- trend: Theil-Sen slope of annual totals (median of pairwise slopes, per year),
  reported as % of the median annual total per year; Mann-Kendall S with tie-corrected
  variance, z with continuity correction, two-sided p = erfc(|z| / sqrt(2)). Needs n >= 3.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np

LABELS = ("below", "normal", "above", "extreme")
CRITICAL_SHARE = 0.6


def quantile(xs, q: float) -> float:
    xs = sorted(float(x) for x in xs)
    if not xs:
        return math.nan
    pos = (len(xs) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def climatology(base) -> dict:
    return {"median": quantile(base, 0.5), "p10": quantile(base, 0.1), "p25": quantile(base, 0.25),
            "p75": quantile(base, 0.75), "p90": quantile(base, 0.9), "n": len(base)}


def percentile(value: float, base) -> float:
    if not len(base):
        return math.nan
    below = sum(b < value for b in base)
    eq = sum(b == value for b in base)
    return 100 * (below + 0.5 * eq) / len(base)


def label(value: float, clim: dict) -> str | None:
    if clim["n"] == 0:
        return None
    if value < clim["p25"]:
        return "below"
    if value <= clim["p75"]:
        return "normal"
    if value < clim["p90"]:
        return "above"
    return "extreme"


def zscore(value: float, base) -> float | None:
    if len(base) < 2:
        return None
    lb = np.log1p(np.asarray(base, dtype=float))
    sd = float(lb.std(ddof=1))
    if sd == 0:
        return None
    return (math.log1p(value) - float(lb.mean())) / sd


def assess(value: float, base) -> dict:
    clim = climatology(base)
    return {"percentile": percentile(value, base), "label": label(value, clim),
            "z": zscore(value, base), "clim": clim}


def month_to_date(current_dekads, base_years_dekads) -> dict:
    """current_dekads: values of the d dekads observed so far this month.
    base_years_dekads: per baseline year, that month's 3 dekad values."""
    d = len(current_dekads)
    cur = float(sum(current_dekads))
    base = [float(sum(v[:d])) for v in base_years_dekads]
    out = assess(cur, base)
    med = out["clim"]["median"]
    out.update(dekads=d, value=cur, ratio=(cur / med) if med and med > 0 else None)
    return out


def critical_period(medians) -> dict | None:
    m = [float(x) for x in medians]
    total = sum(m)
    if total <= 0:
        return None
    for length in range(1, 13):
        best = None
        for start in range(12):
            s = sum(m[(start + i) % 12] for i in range(length))
            if s >= CRITICAL_SHARE * total - 1e-12 and (best is None or s > best[1]):
                best = (start, s)
        if best:
            return {"start_month": best[0], "length": length,
                    "months": [(best[0] + i) % 12 for i in range(length)],
                    "share": best[1] / total}
    return None  # unreachable: 12 months always reach 100 %


def theil_sen(years, values) -> float:
    slopes = [(values[j] - values[i]) / (years[j] - years[i])
              for i in range(len(years)) for j in range(i + 1, len(years))
              if years[j] != years[i]]
    return quantile(slopes, 0.5)


def mann_kendall(values) -> dict:
    x = [float(v) for v in values]
    n = len(x)
    s = sum((x[j] > x[i]) - (x[j] < x[i]) for i in range(n) for j in range(i + 1, n))
    ties = Counter(x).values()
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in ties)) / 18
    if var <= 0:
        z = 0.0
    elif s > 0:
        z = (s - 1) / math.sqrt(var)
    elif s < 0:
        z = (s + 1) / math.sqrt(var)
    else:
        z = 0.0
    return {"s": s, "var_s": var, "z": z, "p": math.erfc(abs(z) / math.sqrt(2))}


def trend(years, annual) -> dict | None:
    if len(annual) < 3:
        return None
    slope = theil_sen(list(years), [float(a) for a in annual])
    med = quantile(annual, 0.5)
    mk = mann_kendall(annual)
    return {"slope_per_year": slope, "pct_per_year": 100 * slope / med if med > 0 else None,
            "median_annual": med, **mk, "n": len(annual)}
