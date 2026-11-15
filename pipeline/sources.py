"""Find FIRMS input files and expose their CSVs to DuckDB.

Inputs are either plain CSVs or zips (FIRMS yearly country zips, Archive
Download zips). Zip members are extracted to a temporary directory one source at
a time and deleted as soon as DuckDB has read them — nothing is unzipped
permanently.
"""

from __future__ import annotations

import contextlib
import shutil
import tempfile
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Source:
    path: Path

    @property
    def name(self) -> str:
        return self.path.stem

    @property
    def is_zip(self) -> bool:
        return self.path.suffix.lower() == ".zip"


def discover(root: Path) -> list[Source]:
    """All zips and CSVs under `root`.

    A CSV is skipped when it sits inside a directory that has a sibling zip of
    the same name (e.g. `DL_FIRE_M-C61_1/` next to `DL_FIRE_M-C61_1.zip`), so an
    extracted copy is never ingested twice.
    """
    root = Path(root)
    if root.is_file():
        return [Source(root)]
    zips = sorted(root.rglob("*.zip"))
    zip_stems = {(z.parent / z.stem).resolve() for z in zips}
    csvs = [
        c
        for c in sorted(root.rglob("*.csv"))
        if not any(p.resolve() in zip_stems for p in c.parents)
    ]
    return [Source(p) for p in zips + csvs]


def csv_members(src: Source) -> list[str]:
    if not src.is_zip:
        return [src.path.name]
    with zipfile.ZipFile(src.path) as zf:
        return [i.filename for i in zf.infolist() if i.filename.lower().endswith(".csv")]


@contextlib.contextmanager
def csv_files(src: Source, tmp_root: str | None = None) -> Iterator[list[Path]]:
    """Yield local CSV paths for a source; zip members live only inside the block."""
    if not src.is_zip:
        yield [src.path]
        return
    tmp = Path(tempfile.mkdtemp(prefix="ember_", dir=tmp_root or None))
    try:
        out: list[Path] = []
        with zipfile.ZipFile(src.path) as zf:
            for i, info in enumerate(zf.infolist()):
                if not info.filename.lower().endswith(".csv") or info.file_size == 0:
                    continue
                # flatten names; keep the basename so processing can be inferred from it
                dest = tmp / f"{i:05d}_{Path(info.filename).name}"
                with zf.open(info) as fin, open(dest, "wb") as fout:
                    shutil.copyfileobj(fin, fout, 1 << 20)
                out.append(dest)
        yield out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def sql_list(paths: list[Path]) -> str:
    return "[" + ", ".join("'" + p.as_posix().replace("'", "''") + "'" for p in paths) + "]"
