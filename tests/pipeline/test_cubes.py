import gzip
import struct

import numpy as np
import pytest

from pipeline import cubes


def _random_cube(rng, n, level):
    keys = rng.choice(4 * 1000 * cubes.MAX_CELL[level], size=n, replace=False)
    s, rest = np.divmod(keys, 1000 * cubes.MAX_CELL[level])
    t, c = np.divmod(rest, cubes.MAX_CELL[level])
    v = rng.integers(1, 5000, size=n)
    return s, t, c, v


@pytest.mark.parametrize("level", [cubes.LEVEL_L01, cubes.LEVEL_L10])
def test_roundtrip(tmp_path, level):
    rng = np.random.default_rng(0)
    s, t, c, v = _random_cube(rng, 5000, level)
    path = tmp_path / "x.bin.gz"
    r = cubes.write_cube(path, level, s, t, c, v)
    assert r["n"] == 5000 and r["saturated"] == 0
    cube = cubes.read_cube(path)
    assert cube.level == level and len(cube) == 5000
    order = np.lexsort((c, t, s))
    np.testing.assert_array_equal(cube.s, s[order])
    np.testing.assert_array_equal(cube.t, t[order])
    np.testing.assert_array_equal(cube.c, c[order])
    np.testing.assert_array_equal(cube.v, v[order])
    # sorted by (s, t, c)
    key = cube.s.astype(np.int64) << 32 | cube.t.astype(np.int64) << 16 | cube.c
    assert np.all(np.diff(key) > 0)


def test_byte_layout_matches_contract(tmp_path):
    path = tmp_path / "x.bin.gz"
    cubes.write_cube(path, 10, [1, 0], [40, 31], [64799, 3], [7, 70000])
    raw = gzip.decompress(path.read_bytes())
    assert raw[:4] == b"EMBC"
    assert struct.unpack_from("<BBHI", raw, 4) == (1, 10, 0, 2)
    n = 2
    assert len(raw) == 12 + 7 * n
    assert list(raw[12:12 + n]) == [0, 1]
    assert struct.unpack_from("<2H", raw, 12 + n) == (31, 40)
    assert struct.unpack_from("<2H", raw, 12 + 3 * n) == (3, 64799)
    assert struct.unpack_from("<2H", raw, 12 + 5 * n) == (65535, 7)  # saturated


def test_deterministic_and_drops_zeros(tmp_path):
    a, b = tmp_path / "a.bin.gz", tmp_path / "b.bin.gz"
    cubes.write_cube(a, 1, [0, 0, 1], [5, 5, 5], [1, 2, 3], [1, 0, 2])
    cubes.write_cube(b, 1, [1, 0, 0], [5, 5, 5], [3, 2, 1], [2, 0, 1])
    assert a.read_bytes() == b.read_bytes()
    assert len(cubes.read_cube(a)) == 2


def test_empty(tmp_path):
    p = tmp_path / "e.bin.gz"
    cubes.write_cube(p, 1, [], [], [], [])
    assert len(cubes.read_cube(p)) == 0


@pytest.mark.parametrize("bad", [
    {"c": [10000]}, {"t": [70000]}, {"v": [-1]}, {"s": [300]},
])
def test_rejects_out_of_range(tmp_path, bad):
    cols = {"s": [0], "t": [0], "c": [0], "v": [1]} | bad
    with pytest.raises(ValueError):
        cubes.encode_cube(1, **cols)


def test_rejects_duplicates():
    with pytest.raises(ValueError):
        cubes.encode_cube(1, [0, 0], [1, 1], [2, 2], [1, 1])


def test_decode_rejects_garbage():
    with pytest.raises(ValueError):
        cubes.decode_cube(b"NOPE" + bytes(8))
