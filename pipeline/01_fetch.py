"""Stage 1: fetch source files into the local cache.

Nothing is parsed here. The stage downloads, records what it got, and stops.
Keeping retrieval separate means a normalization change can be re-run without
pulling a hundred megabytes again, and a source that moves fails loudly in one
place instead of halfway through a transform.
"""

import hashlib
import importlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
cfg = importlib.import_module("00_config")

MANIFEST = cfg.BUILD / "fetch-manifest.json"

# Sources fetched as whole files. The geocoder is not one of them: it is called
# per address during normalization and keeps its own cache.
FILE_SOURCES = ["sqr", "demographics", "directory_es", "directory_ms", "directory_hs",
                "school_points"]

# Sources spread over several InfoHub workbooks whose names change each year.
INFOHUB_SOURCES = ["sqr_results"]


def log(message):
    print(f"[fetch] {message}", flush=True)


def digest(path):
    """Return a short content hash, used to tell a real update from a re-download."""
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def resolve_attachment(source):
    """Find the current download address of an Open Data file attachment.

    Returns a copy of the source with `url` pointing at the file, plus the
    file's own name, which carries the snapshot date.
    """
    meta = requests.get(source["url"], timeout=cfg.HTTP_TIMEOUT).json()
    blob, name = meta.get("blobId"), meta.get("blobFilename")
    if not blob or not name:
        raise RuntimeError(
            f"{source['source_id']}: the dataset has no file attachment. Check {source['page']}")
    resolved = dict(source)
    resolved["url"] = (f"https://{cfg.SOCRATA_DOMAIN}/api/views/{source['dataset_id']}"
                       f"/files/{blob}?download=true&filename={name}")
    return resolved, name


def find_infohub_links(source):
    """Read the file links an InfoHub report page carries for this source.

    Returns {year: {part: url}} for every link matching `finder`. An empty
    result means the page could not be read or no longer links the files, and
    the caller falls back to the pinned URLs.
    """
    try:
        response = requests.get(source["page"], timeout=cfg.HTTP_TIMEOUT,
                                headers={"User-Agent": "Mozilla/5.0 (schools.publicworks.nyc)"})
        response.raise_for_status()
    except Exception as error:
        log(f"{source['source_id']}: could not read {source['page']}: {error}")
        return {}
    found = {}
    for href in re.findall(r'href="([^"]+)"', response.text):
        match = re.search(source["finder"], href, re.IGNORECASE)
        if match:
            year, part = match.group(1), match.group(2).lower()
            found.setdefault(year, {})[part] = urljoin(source["page"], href)
    return found


def infohub_files(source):
    """Choose the workbooks to fetch: the newest years, from the page or pinned.

    The page usually links the newest year only. Earlier years come from
    `pinned`, so a page that drops a year, or cannot be read, still builds.
    """
    found = find_infohub_links(source)
    years = sorted(set(found) | set(source["pinned"]), reverse=True)[:source["years"]]
    files = []
    for year in years:
        for part in source["parts"]:
            url = found.get(year, {}).get(part)
            resolved = "page"
            if not url:
                if year not in source["pinned"]:
                    raise RuntimeError(
                        f"{source['source_id']}: {source['page']} lists {year} but no "
                        f"{part} workbook, and no pinned URL covers it")
                url = source["pinned"][year].format(part=part)
                resolved = "pinned"
            files.append({"year": year, "part": part, "url": url, "resolved": resolved})
    newest = years[0] if years else None
    log(f"{source['source_id']}: newest year {newest}, "
        f"{sum(f['resolved'] == 'page' for f in files)} links from the page, "
        f"{sum(f['resolved'] == 'pinned' for f in files)} pinned")
    return files


def fetch_infohub(source, force=False):
    """Fetch each workbook of a multi-file InfoHub source. Returns manifest records."""
    records = []
    for chosen in infohub_files(source):
        one = dict(source)
        one["url"] = chosen["url"]
        one["cache"] = source["cache"].format(year=chosen["year"], part=chosen["part"])
        target = cfg.RAW / one["cache"]
        target.parent.mkdir(parents=True, exist_ok=True)
        # A republished file keeps its year but may change its name, so a
        # cached copy fetched from another address is replaced.
        previous = target.with_suffix(".url")
        stale = not previous.exists() or previous.read_text() != chosen["url"]
        record = download(one, force=force or stale)
        previous.write_text(chosen["url"])
        record.update({"year": chosen["year"], "part": chosen["part"],
                       "resolved": chosen["resolved"]})
        check_shape(one, record)
        records.append(record)
    return records


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

    if path.suffix in (".xlsx", ".zip") and not head.startswith(b"PK"):
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
        filename = None
        if source.get("attachment"):
            source, filename = resolve_attachment(source)
            # A new upload has a new name, so a cached copy of the old one is
            # replaced rather than kept.
            previous = cfg.RAW / (source["cache"] + ".name")
            stale = not previous.exists() or previous.read_text() != filename
            record = download(source, force=force or stale)
            previous.write_text(filename)
            record["filename"] = filename
        else:
            record = download(source, force=force)
        check_shape(source, record)
        records.append(record)

    for key in INFOHUB_SOURCES:
        records.extend(fetch_infohub(cfg.SOURCES[key], force=force))

    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": records,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    log(f"wrote {MANIFEST.relative_to(cfg.ROOT)}")
    return manifest


if __name__ == "__main__":
    main(force="--force" in sys.argv)
