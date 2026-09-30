"""Fetch school district boundaries for the map. Run by hand, not by the pipeline.

District lines change rarely, so the daily refresh does not fetch them. Run this
when NYC Open Data shows a newer update to School Districts (8ugf-3d8u):

    pip install requests shapely
    python tools/fetch_districts.py

It writes docs/data/districts.json, a GeoJSON FeatureCollection with one feature
per district, a label point inside each district, the outline of the whole
city, and the date the dataset was last updated.
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import requests
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

DATASET = "8ugf-3d8u"
DOMAIN = "https://data.cityofnewyork.us"
OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "districts.json"

# About 10 metres. Finer detail is invisible at city zoom and costs file size
# on every map load.
TOLERANCE = 0.0001
PLACES = 5


def fetch():
    meta = requests.get(f"{DOMAIN}/api/views/{DATASET}.json", timeout=60).json()
    updated = datetime.fromtimestamp(meta["rowsUpdatedAt"], timezone.utc)
    data = requests.get(f"{DOMAIN}/resource/{DATASET}.geojson", timeout=120).json()
    return data["features"], meta, updated


def simplify(points, tolerance):
    """Douglas-Peucker. Keeps the first and last point of the ring."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    far, index = -1, 0
    for i, (x, y) in enumerate(points[1:-1], 1):
        d = (abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length if length
             else math.hypot(x - x1, y - y1))
        if d > far:
            far, index = d, i
    if far <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def simplify_ring(ring):
    # A closed ring starts and ends on the same point, which gives the line
    # test nothing to measure against, so split it at its middle first.
    mid = len(ring) // 2
    out = simplify(ring[:mid + 1], TOLERANCE)[:-1] + simplify(ring[mid:], TOLERANCE)
    out = [[round(x, PLACES), round(y, PLACES)] for x, y in out]
    return out if len(out) >= 4 else None


def ring_area(ring):
    return sum(x1 * y2 - x2 * y1
               for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def inside(point, rings):
    """Even-odd test, so a point in a hole counts as outside."""
    x, y = point
    hit = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                hit = not hit
    return hit


def edge_distance(point, rings):
    x, y = point
    best = math.inf
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            dx, dy = x2 - x1, y2 - y1
            t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy or 1)))
            best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return best


def label_point(polys):
    """The point deepest inside the largest part.

    A centroid can fall outside a curved district, such as the Rockaways, so
    the label goes where it is farthest from any edge.
    """
    rings = max(polys, key=lambda p: abs(ring_area(p[0])))
    xs = [x for x, _ in rings[0]]
    ys = [y for _, y in rings[0]]
    steps = 60
    best, best_d = None, -1
    for i in range(steps + 1):
        for j in range(steps + 1):
            p = (min(xs) + (max(xs) - min(xs)) * i / steps,
                 min(ys) + (max(ys) - min(ys)) * j / steps)
            if inside(p, rings):
                d = edge_distance(p, rings)
                if d > best_d:
                    best, best_d = p, d
    return [round(best[0], PLACES), round(best[1], PLACES)]


def main():
    raw, meta, updated = fetch()

    # A district can arrive as more than one feature, so parts are merged.
    parts = {}
    for feature in raw:
        code = f"{int(float(feature['properties']['schooldist'])):02d}"
        for poly in feature["geometry"]["coordinates"]:
            rings = [r for r in (simplify_ring(ring) for ring in poly) if r]
            if rings and len(rings[0]) >= 4:
                parts.setdefault(code, []).append(rings)

    features = []
    for code in sorted(parts):
        polys = parts[code]
        features.append({
            "type": "Feature",
            "properties": {"district": code, "label": label_point(polys)},
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        })

    # The city's outer edge, merged from the unsimplified districts so shared
    # edges cancel exactly. The map fades everything outside it.
    city = unary_union([shape(f["geometry"]) for f in raw]).buffer(0)
    city = city.simplify(TOLERANCE * 3, preserve_topology=True)
    parts = city.geoms if city.geom_type == "MultiPolygon" else [city]
    # Islets too small to see at city zoom are left out of the outline.
    outline = [[[round(x, PLACES), round(y, PLACES)] for x, y in p.exterior.coords]
               for p in parts if p.area > 2e-6]

    payload = {
        "type": "FeatureCollection",
        "outline": outline,
        "source": {
            "title": meta["name"],
            "agency": meta.get("attribution"),
            "dataset_id": DATASET,
            "page": f"{DOMAIN}/d/{DATASET}",
            "updated": updated.strftime("%Y-%m-%d"),
            "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
        "features": features,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"{len(features)} districts, updated {payload['source']['updated']}, "
          f"{OUT.stat().st_size / 1024:.0f} KB -> {OUT}")


if __name__ == "__main__":
    main()
