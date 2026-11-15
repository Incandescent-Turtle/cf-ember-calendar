"""Per-tile dekad series from fcd_daily: the input for calibrate and validate.

    interim/tile_dekad.parquet   tile, s, t, fcd, n_det   (one row per non-zero tile-series-dekad)

`fcd` equals the sum of the L01 cube cells of that tile (same source, exact), so a k
fitted here is the k the browser would fit from the cubes. `n_det` is the number of
cleaned detections, for the "raw counts" baseline in validation.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import duckdb
import numpy as np

from pipeline import grid
from pipeline.config import Config
from pipeline.cubes import SERIES, SERIES_NAMES

log = logging.getLogger(__name__)

N_SERIES = len(SERIES_NAMES)


def _series_case() -> str:
    whens = " ".join(f"WHEN '{k}' THEN {v}" for k, v in SERIES.items())
    return f"CASE sensor_group {whens} END"


def _fcd_glob(cfg: Config) -> str:
    return f"'{cfg.fcd_dir.as_posix()}/**/*.parquet'"


def build_tile_series(con: duckdb.DuckDBPyConnection, cfg: Config) -> int:
    path = cfg.interim / "tile_dekad.parquet"
    con.execute(f"""
        COPY (
          SELECT {grid.sql_tile10('cell01')} AS tile, {_series_case()}::UTINYINT AS s,
                 {grid.sql_dekad('acq_date')}::USMALLINT AS t,
                 count(*)::BIGINT AS fcd, sum(n_det)::BIGINT AS n_det
          FROM read_parquet({_fcd_glob(cfg)}, hive_partitioning=true)
          GROUP BY ALL ORDER BY tile, s, t
        ) TO '{path.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    n = con.execute(f"SELECT count(*) FROM '{path.as_posix()}'").fetchone()[0]
    log.info("tile series: %d rows -> %s", n, path)
    return int(n)


@dataclass
class TileSeries:
    """fcd[i, s, t - t0] and det[i, s, t - t0] for tile i (float64, zeros where absent)."""

    tiles: list[str]
    t0: int
    fcd: np.ndarray
    det: np.ndarray

    @property
    def n_t(self) -> int:
        return self.fcd.shape[2]

    def total(self, which: str = "fcd") -> np.ndarray:
        """(series, nT) summed over all tiles."""
        return getattr(self, which).sum(axis=0)


def load_tile_series(con: duckdb.DuckDBPyConnection, cfg: Config,
                     dekad_range: tuple[int, int] | None = None) -> TileSeries:
    path = cfg.interim / "tile_dekad.parquet"
    if not path.exists():
        build_tile_series(con, cfg)
    a = con.execute(f"SELECT tile, s, t, fcd, n_det FROM '{path.as_posix()}'").fetchnumpy()
    tiles = sorted(set(a["tile"].tolist()))
    if dekad_range is None:
        dekad_range = (int(a["t"].min()), int(a["t"].max()))
    t0, t1 = dekad_range
    idx = {tl: i for i, tl in enumerate(tiles)}
    ti = np.array([idx[x] for x in a["tile"].tolist()], dtype=np.int64)
    fcd = np.zeros((len(tiles), N_SERIES, t1 - t0 + 1))
    det = np.zeros_like(fcd)
    tt = a["t"].astype(np.int64) - t0
    ok = (tt >= 0) & (tt <= t1 - t0)
    fcd[ti[ok], a["s"][ok].astype(np.int64), tt[ok]] = a["fcd"][ok]
    det[ti[ok], a["s"][ok].astype(np.int64), tt[ok]] = a["n_det"][ok]
    return TileSeries(tiles=tiles, t0=t0, fcd=fcd, det=det)


# ----------------------------------------------------------------- point AOIs
def _haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    h = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(h))


def circle_series(con: duckdb.DuckDBPyConnection, cfg: Config, lon: float, lat: float,
                  radius_km: float, dekad_range: tuple[int, int]) -> TileSeries:
    """Series for the 0.1-degree cells whose centre is within radius_km of (lon, lat):
    the same membership rule the web uses (cell centres), split per 10-degree tile."""
    dlat = radius_km / 111.0 + 0.1
    dlon = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.05)) + 0.1
    r_lo = math.floor((lat - dlat + 90) * 100)
    r_hi = math.ceil((lat + dlat + 90) * 100)
    q_lo = math.floor((lon - dlon + 180) * 100)
    q_hi = math.ceil((lon + dlon + 180) * 100)
    a = con.execute(f"""
        SELECT {grid.sql_tile10('cell01')} AS tile, {_series_case()} AS s,
               {grid.sql_dekad('acq_date')} AS t,
               (cell01 // 36000) // 10 AS r10, (cell01 % 36000) // 10 AS q10,
               count(*)::BIGINT AS fcd, sum(n_det)::BIGINT AS n_det
        FROM read_parquet({_fcd_glob(cfg)}, hive_partitioning=true)
        WHERE cell01 // 36000 BETWEEN {r_lo} AND {r_hi}
          AND cell01 % 36000 BETWEEN {q_lo} AND {q_hi}
        GROUP BY ALL""").fetchnumpy()
    clat = (a["r10"] + 0.5) * 0.1 - 90
    clon = (a["q10"] + 0.5) * 0.1 - 180
    inside = _haversine_km(lon, lat, clon, clat) <= radius_km
    t0, t1 = dekad_range
    tiles = sorted(set(a["tile"][inside].tolist()))
    idx = {tl: i for i, tl in enumerate(tiles)}
    fcd = np.zeros((max(len(tiles), 1), N_SERIES, t1 - t0 + 1))
    det = np.zeros_like(fcd)
    for tl, s, t, f, d in zip(a["tile"][inside], a["s"][inside], a["t"][inside],
                              a["fcd"][inside], a["n_det"][inside]):
        if t0 <= t <= t1:
            fcd[idx[tl], s, t - t0] += f
            det[idx[tl], s, t - t0] += d
    return TileSeries(tiles=tiles or ["none"], t0=t0, fcd=fcd, det=det)
