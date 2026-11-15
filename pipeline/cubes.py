"""Sparse dekad cubes (CONTRACTS.md -> Cube file) and their builder.

    cube/l01/<tile>.bin.gz   0.1-degree cells inside a 10-degree tile
    cube/l10/global.bin.gz   1-degree cells, whole world

Binary (little-endian, then gzip):
    "EMBC" | u8 version=1 | u8 level | u16 reserved=0 | u32 n
    | u8[n] s | u16[n] t | u16[n] c | u16[n] v        sorted by (s, t, c)
"""

from __future__ import annotations

import gzip
import logging
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np

from pipeline import grid
from pipeline.config import Config

log = logging.getLogger(__name__)

MAGIC = b"EMBC"
VERSION = 1
HEADER = struct.Struct("<4sBBHI")  # 12 bytes
U16_MAX = 65535

SERIES = {"MODIS": 0, "VIIRS_SNPP": 1, "VIIRS_NOAA20": 2, "VIIRS_NOAA21": 3}
SERIES_NAMES = ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"]
LEVEL_L01 = 1
LEVEL_L10 = 10
MAX_CELL = {LEVEL_L01: 10000, LEVEL_L10: 64800}


@dataclass
class Cube:
    level: int
    s: np.ndarray  # uint8
    t: np.ndarray  # uint16
    c: np.ndarray  # uint16
    v: np.ndarray  # uint16

    def __len__(self) -> int:
        return len(self.s)


def encode_cube(level: int, s, t, c, v) -> tuple[bytes, int]:
    """Raw (un-gzipped) bytes, sorted by (s, t, c). Returns (bytes, n_saturated)."""
    if level not in MAX_CELL:
        raise ValueError(f"level must be 1 or 10, got {level}")
    s = np.asarray(s, dtype=np.int64)
    t = np.asarray(t, dtype=np.int64)
    c = np.asarray(c, dtype=np.int64)
    v = np.asarray(v, dtype=np.int64)
    if not (len(s) == len(t) == len(c) == len(v)):
        raise ValueError("column lengths differ")
    if len(s):
        if s.min() < 0 or s.max() > 255:
            raise ValueError("series id out of range")
        if t.min() < 0 or t.max() > U16_MAX:
            raise ValueError("dekad index out of range")
        if c.min() < 0 or c.max() >= MAX_CELL[level]:
            raise ValueError("cell id out of range")
        if v.min() < 0:
            raise ValueError("negative value")
    keep = v > 0
    s, t, c, v = s[keep], t[keep], c[keep], v[keep]
    order = np.lexsort((c, t, s))
    s, t, c, v = s[order], t[order], c[order], v[order]
    key = (s << 32) | (t << 16) | c
    if len(key) > 1 and np.any(key[1:] == key[:-1]):
        raise ValueError("duplicate (s, t, c) entries")
    saturated = int(np.count_nonzero(v > U16_MAX))
    n = len(s)
    parts = [
        HEADER.pack(MAGIC, VERSION, level, 0, n),
        s.astype("<u1").tobytes(),
        t.astype("<u2").tobytes(),
        c.astype("<u2").tobytes(),
        np.minimum(v, U16_MAX).astype("<u2").tobytes(),
    ]
    return b"".join(parts), saturated


def decode_cube(raw: bytes) -> Cube:
    magic, version, level, _, n = HEADER.unpack_from(raw, 0)
    if magic != MAGIC:
        raise ValueError("not an EMBC cube")
    if version != VERSION:
        raise ValueError(f"unsupported cube version {version}")
    if len(raw) != 12 + 7 * n:
        raise ValueError(f"bad length {len(raw)} for n={n}")
    o = 12
    s = np.frombuffer(raw, "<u1", n, o)
    t = np.frombuffer(raw, "<u2", n, o + n)
    c = np.frombuffer(raw, "<u2", n, o + 3 * n)
    v = np.frombuffer(raw, "<u2", n, o + 5 * n)
    return Cube(level, s.copy(), t.astype(np.uint16), c.astype(np.uint16), v.astype(np.uint16))


def write_cube(path: Path, level: int, s, t, c, v) -> dict[str, int]:
    raw, saturated = encode_cube(level, s, t, c, v)
    path.parent.mkdir(parents=True, exist_ok=True)
    # no name, mtime=0 -> byte-identical output for identical input
    with open(path, "wb") as fh, gzip.GzipFile(
        filename="", fileobj=fh, mode="wb", compresslevel=9, mtime=0
    ) as gz:
        gz.write(raw)
    return {"n": (len(raw) - 12) // 7, "bytes": path.stat().st_size, "saturated": saturated}


def read_cube(path: Path) -> Cube:
    with gzip.open(path, "rb") as fh:
        return decode_cube(fh.read())


# --------------------------------------------------------------------- builder
def _series_case() -> str:
    whens = " ".join(f"WHEN '{k}' THEN {v}" for k, v in SERIES.items())
    return f"CASE sensor_group {whens} END"


def build_cubes(con: duckdb.DuckDBPyConnection, cfg: Config) -> dict:
    """fcd_daily -> cube/l01/<tile>.bin.gz + cube/l10/global.bin.gz."""
    out = cfg.processed / "cube"
    if out.exists():
        shutil.rmtree(out)
    fcd = f"'{cfg.fcd_dir.as_posix()}/**/*.parquet'"
    t_sql = grid.sql_dekad("acq_date")
    base = f"""SELECT {_series_case()} AS s, {t_sql} AS t, cell01
               FROM read_parquet({fcd}, hive_partitioning=true)"""

    # L01: aggregate once into a sorted intermediate, then slice per tile
    l01_tmp = cfg.interim / "cube_l01.parquet"
    con.execute(f"""
        COPY (
          SELECT {grid.sql_tile10('cell01')} AS tile, s, t, {grid.sql_l01_c('cell01')} AS c,
                 count(*) AS v
          FROM ({base}) GROUP BY ALL ORDER BY tile, s, t, c
        ) TO '{l01_tmp.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    tiles = [r[0] for r in con.execute(
        f"SELECT DISTINCT tile FROM '{l01_tmp.as_posix()}' ORDER BY 1").fetchall()]
    stats: dict = {"tiles": tiles, "l01_entries": 0, "l01_bytes": 0, "saturated": 0}
    for tile in tiles:
        a = con.execute(
            f"SELECT s, t, c, v FROM '{l01_tmp.as_posix()}' WHERE tile = ?", [tile]
        ).fetchnumpy()
        r = write_cube(out / "l01" / f"{tile}.bin.gz", LEVEL_L01, a["s"], a["t"], a["c"], a["v"])
        stats["l01_entries"] += r["n"]
        stats["l01_bytes"] += r["bytes"]
        stats["saturated"] += r["saturated"]

    a = con.execute(f"""
        SELECT s, t, {grid.sql_l10_c('cell01')} AS c, count(*) AS v
        FROM ({base}) GROUP BY ALL""").fetchnumpy()
    r = write_cube(out / "l10" / "global.bin.gz", LEVEL_L10, a["s"], a["t"], a["c"], a["v"])
    stats.update(l10_entries=r["n"], l10_bytes=r["bytes"])
    stats["saturated"] += r["saturated"]
    tmin, tmax = con.execute(f"SELECT min(t), max(t) FROM '{l01_tmp.as_posix()}'").fetchone()
    stats["dekad_range"] = [int(tmin), int(tmax)]
    # totals per series, to check cubes against fcd_daily (exact summation)
    stats["l01_totals"] = dict(con.execute(
        f"SELECT s, sum(v)::BIGINT FROM '{l01_tmp.as_posix()}' GROUP BY 1 ORDER BY 1").fetchall())
    stats["fcd_totals"] = dict(con.execute(
        f"SELECT s, count(*) FROM ({base}) GROUP BY 1 ORDER BY 1").fetchall())
    stats["l10_totals"] = {int(k): int(a["v"][a["s"] == k].sum()) for k in np.unique(a["s"])}
    if stats["saturated"]:
        log.warning("cubes: %d entries saturated at 65535", stats["saturated"])
    log.info("cubes: %d tiles, L01 %d entries %.1f MB, L10 %d entries %.1f MB, dekads %s",
             len(tiles), stats["l01_entries"], stats["l01_bytes"] / 2**20,
             stats["l10_entries"], stats["l10_bytes"] / 2**20, stats["dekad_range"])
    return stats
