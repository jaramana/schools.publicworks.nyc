"""Stage 1: fetch source files into the local cache.

Nothing is parsed here. The stage downloads, records what it got, and stops.
Keeping retrieval separate means a normalization change can be re-run without
pulling a hundred megabytes again, and a source that moves fails loudly in one
place instead of halfway through a transform.
"""

import hashlib
import importlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
cfg = importlib.import_module("00_config")

MANIFEST = cfg.BUILD / "fetch-manifest.json"

# Sources fetched as whole files. The geocoder is not one of them: it is called
# per address during normalization and keeps its own cache.
FILE_SOURCES = ["sqr", "demographics", "directory_es", "directory_ms", "directory_hs"]


def log(message):
    print(f"[fetch] {message}", flush=True)


def digest(path):
    """Return a short content hash, used to tell a real update from a re-download."""
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def download(source, force=False):
    """Fetch one source into the cache. Returns a record for the manifest."""
    target = cfg.RAW / source["cache"]
    if target.exists() and not force:
        log(f"{source['source_id']}: cached, {target.stat().st_size / 1e6:.1f} MB")
        return {
            "source_id": source["source_id"],
            "url": source["url"],
            "path": str(target.relative_to(cfg.ROOT)),
            "bytes": target.stat().st_size,
            "sha256_short": digest(target),
            "retrieved": datetime.fromtimestamp(
                target.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d"),
            "from_cache": True,
        }

    last_error = None
    for attempt in range(1, cfg.HTTP_RETRIES + 1):
        try:
            log(f"{source['source_id']}: downloading, attempt {attempt}")
            response = requests.get(source["url"], timeout=cfg.HTTP_TIMEOUT, stream=True)
            response.raise_for_status()
            # Write beside the target first so an interrupted download never
            # leaves a half file that looks like a good cache entry.
            partial = target.with_suffix(target.suffix + ".part")
            written = 0
            with open(partial, "wb") as handle:
                for chunk in response.iter_content(1 << 20):
                    handle.write(chunk)
                    written += len(chunk)
            if written == 0:
                raise RuntimeError("the server returned an empty file")
            partial.replace(target)
            break
        except Exception as error:      # network, HTTP status, or empty body
            last_error = error
            if attempt < cfg.HTTP_RETRIES:
                time.sleep(3 * attempt)
    else:
        raise RuntimeError(
            f"could not fetch {source['source_id']} from {source['url']}: {last_error}")

    log(f"{source['source_id']}: {target.stat().st_size / 1e6:.1f} MB")
    return {
        "source_id": source["source_id"],
        "url": source["url"],
        "path": str(target.relative_to(cfg.ROOT)),
        "bytes": target.stat().st_size,
        "sha256_short": digest(target),
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "from_cache": False,
    }


def check_shape(source, record):
    """Cheap sanity checks that do not need the file parsed.

    A Sharepoint-hosted file that has been moved answers with an HTML error page
    and HTTP 200, so a plausible byte count is not enough on its own.
    """
    path = cfg.ROOT / record["path"]
    head = path.open("rb").read(512)

    if path.suffix == ".xlsx" and not head.startswith(b"PK"):
        raise RuntimeError(
            f"{source['source_id']}: expected an Excel workbook but got something else. "
            f"The InfoHub file name probably changed. Check {source['page']}")

    if path.suffix == ".csv":
        # The Socrata CSV export carries display names such as "School Year" and
        # "District, Borough and School Number (DBN)", not the API field names.
        # Compare on letters and digits only so either spelling passes.
        first_line = head.split(b"\n", 1)[0].decode("utf-8", "replace")
        flat = "".join(ch for ch in first_line.lower() if ch.isalnum())
        missing = [c for c in source.get("required_columns", [])
                   if c.replace("_", "") not in flat]
        if missing:
            raise RuntimeError(
                f"{source['source_id']}: the export is missing required columns "
                f"{missing}. The dataset schema changed.")


def main(force=False):
    cfg.RAW.mkdir(parents=True, exist_ok=True)
    records = []
    for key in FILE_SOURCES:
        source = cfg.SOURCES[key]
        record = download(source, force=force)
        check_shape(source, record)
        records.append(record)

    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": records,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    log(f"wrote {MANIFEST.relative_to(cfg.ROOT)}")
    return manifest


if __name__ == "__main__":
    main(force="--force" in sys.argv)
