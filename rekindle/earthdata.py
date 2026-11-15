"""Minimal NASA Earthdata download helper (Bearer token, sent only to Earthdata hosts).

The token comes from the EARTHDATA_TOKEN environment variable or, failing that, from the
repo's .env file. It is never printed or logged, and it is not forwarded on redirects to
non-Earthdata hosts (e.g. the pre-signed S3 URLs that LP DAAC redirects to).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import requests

_ALLOWED = (".earthdata.nasa.gov", ".earthdatacloud.nasa.gov", ".gesdisc.eosdis.nasa.gov")
_ENV = Path(__file__).resolve().parent.parent / ".env"


def _token() -> str | None:
    tok = os.environ.get("EARTHDATA_TOKEN")
    if tok:
        return tok.strip()
    if _ENV.exists():
        for line in _ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith("EARTHDATA_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def _trusted(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return urlparse(url).scheme == "https" and any(
        host == d.lstrip(".") or host.endswith(d) for d in _ALLOWED
    )


def get(url: str, timeout: float = 120.0, max_hops: int = 8) -> requests.Response:
    """GET with manual redirects; the Authorization header goes to Earthdata hosts only."""
    tok = _token()
    s = requests.Session()
    for _ in range(max_hops):
        headers = {"Authorization": f"Bearer {tok}"} if tok and _trusted(url) else {}
        r = s.get(url, headers=headers, allow_redirects=False, timeout=timeout)
        if r.status_code in (301, 302, 303, 307, 308) and "Location" in r.headers:
            url = requests.compat.urljoin(url, r.headers["Location"])
            continue
        return r
    raise RuntimeError("too many redirects")


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    r = get(url)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code} for {urlparse(url).path}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(r.content)
    tmp.replace(dest)
    return dest
