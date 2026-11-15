"""Grids and the dekad time axis (CONTRACTS.md -> Grids, Time axis).

All grid ids derive from integer 0.01-degree row/col indices:

    r01 = floor((lat + 90) * 100 + EPS)    clamped to 0..17999
    q01 = floor((lon + 180) * 100 + EPS)   clamped to 0..35999
    cell01 = r01 * 36000 + q01

EPS (1e-9) stops values that sit exactly on a 0.01-degree line from
falling into the cell below because of binary floating point (e.g.
(-29.51 + 90) * 100 = 6048.999999999999). Coarser ids are integer divisions of
r01/q01, so every grid nests exactly. The web port (web/src/lib/grid.ts) must
use the same formulas; tests/golden/time_cases.json checks it.

Python helpers have SQL twins (sql_* functions) that generate DuckDB expressions
with identical semantics.
"""

from __future__ import annotations

import calendar
import datetime as dt
import math

EPS = 1e-9
N_ROWS01 = 18000
N_COLS01 = 36000
TILE_CELLS01 = 1000  # 10 deg / 0.01 deg
L01_DIV = 10  # 0.1 deg / 0.01 deg
L10_DIV = 100  # 1 deg / 0.01 deg


# ---------------------------------------------------------------- 0.01 deg
def _clamp(v: int, hi: int) -> int:
    return 0 if v < 0 else hi if v > hi else v


def rc01(lat: float, lon: float) -> tuple[int, int]:
    r = _clamp(math.floor((lat + 90.0) * 100.0 + EPS), N_ROWS01 - 1)
    q = _clamp(math.floor((lon + 180.0) * 100.0 + EPS), N_COLS01 - 1)
    return r, q


def cell01(lat: float, lon: float) -> int:
    r, q = rc01(lat, lon)
    return r * N_COLS01 + q


def cell01_bounds(cell: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a 0.01-degree cell."""
    r, q = divmod(cell, N_COLS01)
    return (q / 100 - 180, r / 100 - 90, (q + 1) / 100 - 180, (r + 1) / 100 - 90)


def cell01_center(cell: int) -> tuple[float, float]:
    """(lon, lat) of the cell centre; cell01(lat, lon) of it returns `cell`."""
    w, s, e, n = cell01_bounds(cell)
    return ((w + e) / 2, (s + n) / 2)


# ---------------------------------------------------------------- 10 deg tiles
def tile_id_from_index(tr: int, tq: int) -> str:
    south = tr * 10 - 90
    west = tq * 10 - 180
    return f"{'N' if south >= 0 else 'S'}{abs(south):02d}{'E' if west >= 0 else 'W'}{abs(west):03d}"


def tile_index(tile: str) -> tuple[int, int]:
    """Inverse of tile_id_from_index: 'S30W070' -> (6, 11)."""
    south = int(tile[1:3]) * (1 if tile[0] == "N" else -1)
    west = int(tile[4:7]) * (1 if tile[3] == "E" else -1)
    return (south + 90) // 10, (west + 180) // 10


def tile_bounds(tile: str) -> tuple[int, int, int, int]:
    tr, tq = tile_index(tile)
    return (tq * 10 - 180, tr * 10 - 90, tq * 10 - 170, tr * 10 - 80)


def tile10(lat: float, lon: float) -> str:
    r, q = rc01(lat, lon)
    return tile_of_cell01(r * N_COLS01 + q)


def tile_of_cell01(cell: int) -> str:
    r, q = divmod(cell, N_COLS01)
    return tile_id_from_index(r // TILE_CELLS01, q // TILE_CELLS01)


# ---------------------------------------------------------------- L01 / L10
def l01_of_cell01(cell: int) -> tuple[str, int]:
    """(tile id, c) with c = row*100 + col of the 0.1-degree cell inside the tile."""
    r, q = divmod(cell, N_COLS01)
    row = (r // L01_DIV) % 100
    col = (q // L01_DIV) % 100
    return tile_of_cell01(cell), row * 100 + col


def l01_bounds(tile: str, c: int) -> tuple[float, float, float, float]:
    w, s, _, _ = tile_bounds(tile)
    row, col = divmod(c, 100)
    return (w + col / 10, s + row / 10, w + (col + 1) / 10, s + (row + 1) / 10)


def l10_of_cell01(cell: int) -> int:
    r, q = divmod(cell, N_COLS01)
    return (r // L10_DIV) * 360 + q // L10_DIV


def l10_cell(lat: float, lon: float) -> int:
    return l10_of_cell01(cell01(lat, lon))


def l10_bounds(c: int) -> tuple[int, int, int, int]:
    row, col = divmod(c, 360)
    return (col - 180, row - 90, col - 179, row - 89)


# ---------------------------------------------------------------- dekads
def dekad_index(d: dt.date) -> int:
    return (d.year - 2000) * 36 + (d.month - 1) * 3 + min((d.day - 1) // 10, 2)


def dekad_range(t: int) -> tuple[dt.date, dt.date]:
    """Inclusive (first day, last day) of dekad t."""
    year = 2000 + t // 36
    month = (t // 3) % 12 + 1
    k = t % 3
    start = dt.date(year, month, 1 + 10 * k)
    end_day = calendar.monthrange(year, month)[1] if k == 2 else 10 * (k + 1)
    return start, dt.date(year, month, end_day)


def dekad_month(t: int) -> int:
    """Calendar month 0-11 of dekad t."""
    return (t // 3) % 12


def dekad_year(t: int) -> int:
    return 2000 + t // 36


# ---------------------------------------------------------------- SQL twins
def sql_r01(lat: str) -> str:
    return f"least(greatest(floor(({lat} + 90.0) * 100.0 + {EPS})::BIGINT, 0), {N_ROWS01 - 1})"


def sql_q01(lon: str) -> str:
    return f"least(greatest(floor(({lon} + 180.0) * 100.0 + {EPS})::BIGINT, 0), {N_COLS01 - 1})"


def sql_cell01(lat: str, lon: str) -> str:
    return f"({sql_r01(lat)} * {N_COLS01} + {sql_q01(lon)})"


def sql_tile10(cell: str) -> str:
    """Tile id from a cell01 expression."""
    south = f"((({cell}) // {N_COLS01}) // {TILE_CELLS01} * 10 - 90)"
    west = f"((({cell}) % {N_COLS01}) // {TILE_CELLS01} * 10 - 180)"
    return (
        f"(CASE WHEN {south} >= 0 THEN 'N' ELSE 'S' END || lpad(abs({south})::VARCHAR, 2, '0')"
        f" || CASE WHEN {west} >= 0 THEN 'E' ELSE 'W' END || lpad(abs({west})::VARCHAR, 3, '0'))"
    )


def sql_l01_c(cell: str) -> str:
    return (
        f"(((({cell}) // {N_COLS01}) // {L01_DIV}) % 100 * 100"
        f" + ((({cell}) % {N_COLS01}) // {L01_DIV}) % 100)"
    )


def sql_l10_c(cell: str) -> str:
    return f"((({cell}) // {N_COLS01}) // {L10_DIV} * 360 + (({cell}) % {N_COLS01}) // {L10_DIV})"


def sql_dekad(date: str) -> str:
    return (
        f"((year({date}) - 2000) * 36 + (month({date}) - 1) * 3"
        f" + least((day({date}) - 1) // 10, 2))"
    )
