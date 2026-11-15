"""Configuration from environment variables (see .env.example).

A `.env` file in the repo root is read if present; real env vars win.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path = REPO_ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.split(" #", 1)[0].strip()
        os.environ.setdefault(key.strip(), value)


_load_dotenv()


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value if value else default


@dataclass(frozen=True)
class Config:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "./data")))
    modis_min_conf: int = field(default_factory=lambda: int(_env("MODIS_MIN_CONF", "30")))
    viirs_keep_conf: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            c.strip().lower() for c in _env("VIIRS_KEEP_CONF", "n,h").split(",") if c.strip()
        )
    )
    cal_start: str = field(default_factory=lambda: _env("CAL_START", "2013-01-01"))
    cal_end: str = field(default_factory=lambda: _env("CAL_END", "2021-12-31"))
    cal_min_modis_fcd: int = field(default_factory=lambda: int(_env("CAL_MIN_MODIS_FCD", "200")))
    snpp_end: str = field(default_factory=lambda: _env("SNPP_END", "2026-11-02"))
    duckdb_memory_limit: str = field(default_factory=lambda: _env("DUCKDB_MEMORY_LIMIT", "10GB"))
    duckdb_threads: str = field(default_factory=lambda: _env("DUCKDB_THREADS", ""))
    tmp_dir: str = field(default_factory=lambda: _env("EMBER_TMP_DIR", ""))

    # Layout under data_dir
    @property
    def interim(self) -> Path:
        return self.data_dir / "interim"

    @property
    def processed(self) -> Path:
        return self.data_dir / "processed"

    @property
    def staging_dir(self) -> Path:
        return self.interim / "staging"

    @property
    def hotspots_dir(self) -> Path:
        return self.interim / "hotspots"

    @property
    def fcd_dir(self) -> Path:
        return self.interim / "fcd_daily"

    @property
    def logs_dir(self) -> Path:
        return self.interim / "logs"


def connect(cfg: Config | None = None) -> duckdb.DuckDBPyConnection:
    """DuckDB connection with memory limit (and temp spill dir) from config."""
    cfg = cfg or Config()
    con = duckdb.connect()
    con.execute(f"SET memory_limit = '{cfg.duckdb_memory_limit}'")
    con.execute("SET preserve_insertion_order = false")
    if cfg.duckdb_threads:
        con.execute(f"SET threads = {int(cfg.duckdb_threads)}")
    spill = cfg.interim / "duckdb_tmp"
    spill.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET temp_directory = '{spill.as_posix()}'")
    return con
