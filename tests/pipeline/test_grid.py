import datetime as dt
import random

import duckdb
import pytest

from pipeline import grid as g


def test_cell01_boundaries_and_clamp():
    assert g.cell01(-90, -180) == 0
    assert g.cell01(90, 180) == 17999 * 36000 + 35999
    # value exactly on a 0.01 line goes to the cell above/right, despite FP error
    r, q = g.rc01(-29.51, -67.49)
    assert (r, q) == (6049, 11251)


def test_cell01_bounds_inverse():
    rng = random.Random(1)
    for _ in range(2000):
        cell = rng.randrange(18000 * 36000)
        lon, lat = g.cell01_center(cell)
        assert g.cell01(lat, lon) == cell
        w, s, e, n = g.cell01_bounds(cell)
        assert w < lon < e and s < lat < n


@pytest.mark.parametrize(
    "lat,lon,tile",
    [(-29.2, -67.5, "S30W070"), (-20.0001, -60.0001, "S30W070"), (0, 0, "N00E000"),
     (-0.001, -0.001, "S10W010"), (89.99, 179.99, "N80E170"), (90, 180, "N80E170")],
)
def test_tile10(lat, lon, tile):
    assert g.tile10(lat, lon) == tile
    w, s, e, n = g.tile_bounds(tile)
    assert w <= min(lon, 179.999) < e and s <= min(lat, 89.999) < n


def test_tile_index_roundtrip():
    for tr in range(18):
        for tq in range(36):
            assert g.tile_index(g.tile_id_from_index(tr, tq)) == (tr, tq)


def test_l01_l10():
    tile, c = g.l01_of_cell01(g.cell01(-29.25, -67.55))
    assert tile == "S30W070"
    assert c == 7 * 100 + 24  # row = floor(0.75/0.1)=7, col = floor(2.45/0.1)=24
    w, s, e, n = g.l01_bounds(tile, c)
    assert (round(w, 6), round(s, 6)) == (-67.6, -29.3)
    assert g.l10_cell(-29.25, -67.55) == 60 * 360 + 112
    assert g.l10_bounds(60 * 360 + 112) == (-68, -30, -67, -29)
    assert g.l10_cell(90, 180) == 64799


def test_dekads():
    assert g.dekad_index(dt.date(2000, 1, 1)) == 0
    assert g.dekad_index(dt.date(2000, 11, 1)) == 30
    assert g.dekad_index(dt.date(2000, 11, 11)) == 31
    assert g.dekad_index(dt.date(2012, 2, 29)) == 12 * 36 + 3 + 2
    assert g.dekad_range(g.dekad_index(dt.date(2024, 2, 29))) == (
        dt.date(2024, 2, 21), dt.date(2024, 2, 29))
    d = dt.date(2000, 1, 1)
    while d < dt.date(2030, 1, 1):
        t = g.dekad_index(d)
        a, b = g.dekad_range(t)
        assert a <= d <= b
        assert g.dekad_month(t) == d.month - 1 and g.dekad_year(t) == d.year
        d += dt.timedelta(days=1)


def test_sql_twins_match_python():
    rng = random.Random(7)
    pts = [(rng.uniform(-90, 90), rng.uniform(-180, 180)) for _ in range(3000)]
    pts += [(-29.51, -67.49), (90, 180), (-90, -180), (0, 0), (-0.005, 179.995)]
    con = duckdb.connect()
    con.execute("CREATE TABLE p (lat DOUBLE, lon DOUBLE)")
    con.executemany("INSERT INTO p VALUES (?, ?)", pts)
    cell = g.sql_cell01("lat", "lon")
    rows = con.execute(
        f"SELECT lat, lon, {cell}, {g.sql_tile10(cell)}, {g.sql_l01_c(cell)}, {g.sql_l10_c(cell)} FROM p"
    ).fetchall()
    for lat, lon, c01, tile, c1, c10 in rows:
        assert c01 == g.cell01(lat, lon)
        assert (tile, c1) == g.l01_of_cell01(c01)
        assert c10 == g.l10_of_cell01(c01)
    d0 = dt.date(2000, 1, 1)
    days = [d0 + dt.timedelta(days=i) for i in range(0, 11000, 3)]
    con.execute("CREATE TABLE d (d DATE)")
    con.executemany("INSERT INTO d VALUES (?)", [(x,) for x in days])
    for d, t in con.execute(f"SELECT d, {g.sql_dekad('d')} FROM d").fetchall():
        assert t == g.dekad_index(d)
