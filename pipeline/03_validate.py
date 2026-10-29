"""Stage 3: check the tables before anything is published.

A check either fails the build or records a warning. The split matters: a
duplicated key or a lost school is a defect, while a school type that publishes
very little is just how the data is. Silent staleness and silent shrinkage are
release failures, so both are checked here rather than noticed later.
"""

import importlib
import json
import math
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
import shapely.geometry

sys.path.insert(0, str(Path(__file__).resolve().parent))
cfg = importlib.import_module("00_config")

REPORT = cfg.BUILD / "validation.json"

# Key parts that may be empty without the row being broken.
NULLABLE_KEY_PARTS = {"report_type"}


class Report:
    def __init__(self):
        self.failures = []
        self.warnings = []
        self.facts = {}

    def fail(self, check, detail):
        self.failures.append({"check": check, "detail": detail})
        print(f"[validate] FAIL {check}: {detail}", flush=True)

    def warn(self, check, detail):
        self.warnings.append({"check": check, "detail": detail})
        print(f"[validate] warn {check}: {detail}", flush=True)

    def fact(self, key, value):
        self.facts[key] = value
        print(f"[validate] {key}: {value}", flush=True)

    @property
    def ok(self):
        return not self.failures


def load_tables():
    names = ["schools", "metrics", "observations", "programs",
             "program_priorities", "sources"]
    return {n: pd.read_csv(cfg.BUILD / f"{n}.csv", dtype=str, low_memory=False)
            for n in names}


def check_keys(tables, report):
    """Every table has a declared grain. Test it rather than trust it."""
    grains = {
        "schools": ["dbn"],
        "metrics": ["metric_id"],
        # A school with middle and high school grades files two reports and
        # publishes the same metric in both, so the report type is part of the
        # grain rather than a duplicate to be collapsed.
        "observations": ["dbn", "school_year", "metric_id", "report_type"],
        "programs": ["dbn", "program_id"],
        "program_priorities": ["dbn", "program_id", "rank"],
        "sources": ["source_id"],
    }
    for name, keys in grains.items():
        frame = tables[name]
        if frame.empty:
            report.fail("key.empty", f"{name} has no rows")
            continue
        missing = [k for k in keys if k not in frame.columns]
        if missing:
            report.fail("key.missing_column", f"{name} is missing {missing}")
            continue
        duplicated = frame.duplicated(subset=keys).sum()
        if duplicated:
            example = frame[frame.duplicated(subset=keys, keep=False)].head(3)
            report.fail("key.duplicate",
                        f"{name} has {duplicated:,} duplicate rows on {keys}. "
                        f"First: {example[keys].to_dict('records')}")
        # Some key parts are legitimately absent: a demographic figure belongs
        # to a school and a year but to no quality report.
        required = [k for k in keys if k not in NULLABLE_KEY_PARTS]
        nulls = frame[required].isna().any(axis=1).sum()
        if nulls:
            report.fail("key.null", f"{name} has {nulls:,} rows with an empty key")


def check_references(tables, report):
    schools = set(tables["schools"]["dbn"])
    metrics = set(tables["metrics"]["metric_id"])

    orphan_obs = set(tables["observations"]["dbn"]) - schools
    if orphan_obs:
        report.fail("ref.observation_school",
                    f"{len(orphan_obs):,} observation DBNs are not in the school table, "
                    f"for example {sorted(orphan_obs)[:3]}")

    unknown_metrics = set(tables["observations"]["metric_id"]) - metrics
    if unknown_metrics:
        report.fail("ref.observation_metric",
                    f"{len(unknown_metrics):,} observed metrics are not in the manifest, "
                    f"for example {sorted(unknown_metrics)[:3]}")

    orphan_programs = set(tables["programs"]["dbn"]) - schools
    if orphan_programs:
        report.warn("ref.program_school",
                    f"{len(orphan_programs):,} program DBNs are not in the school "
                    f"universe and will not be published, for example "
                    f"{sorted(orphan_programs)[:3]}")

    program_keys = set(zip(tables["programs"]["dbn"], tables["programs"]["program_id"]))
    priority_keys = set(zip(tables["program_priorities"]["dbn"],
                            tables["program_priorities"]["program_id"]))
    orphan_priorities = priority_keys - program_keys
    if orphan_priorities:
        report.fail("ref.priority_program",
                    f"{len(orphan_priorities):,} priority rows point at no program")


def check_missing_data_rules(tables, report):
    """Missing is not zero, suppressed is not zero, and a status must be honest."""
    obs = tables["observations"]

    unknown = set(obs["status"].dropna()) - set(cfg.STATUS_LABELS)
    if unknown:
        report.fail("status.unknown", f"unrecognised status values {sorted(unknown)}")

    has_value = obs["value"].notna() & (obs["value"] != "")
    reported = obs["status"] == cfg.STATUS_OK

    lying_ok = (reported & ~has_value).sum()
    if lying_ok:
        report.fail("status.ok_without_value",
                    f"{lying_ok:,} rows are marked reported but carry no value")

    lying_missing = (~reported & has_value).sum()
    if lying_missing:
        report.fail("status.value_without_ok",
                    f"{lying_missing:,} rows carry a value but are not marked reported")

    # A censored row is a published bound. It must carry the bound text and no
    # number, or it is not censored, it is broken.
    if "bound" in obs.columns:
        censored = obs["status"] == cfg.STATUS_CENSORED
        has_bound = obs["bound"].notna() & (obs["bound"] != "")
        if (censored & ~has_bound).sum():
            report.fail("status.censored_without_bound",
                        f"{int((censored & ~has_bound).sum()):,} censored rows have no bound text")
        if (censored & has_value).sum():
            report.fail("status.censored_with_value",
                        f"{int((censored & has_value).sum()):,} censored rows also carry a number")
        if (~censored & has_bound).sum():
            report.fail("status.bound_without_censored",
                        f"{int((~censored & has_bound).sum()):,} rows carry a bound but are not censored")
        report.fact("observations_censored", int(censored.sum()))

    report.fact("observations", int(len(obs)))
    report.fact("observations_reported", int(reported.sum()))
    report.fact("observations_suppressed",
                int((obs["status"] == cfg.STATUS_SUPPRESSED).sum()))
    report.fact("observations_missing",
                int((obs["status"] == cfg.STATUS_MISSING).sum()))


def check_coverage(tables, report):
    schools = tables["schools"]
    obs = tables["observations"]

    report.fact("schools", int(len(schools)))
    report.fact("schools_open", int((schools["status"] == "open").sum()))
    report.fact("schools_with_coordinates", int(schools["latitude"].notna().sum()))
    report.fact("metrics", int(len(tables["metrics"])))
    report.fact("programs", int(len(tables["programs"])))

    for key in cfg.UNIVERSE_SOURCES:
        source = cfg.SOURCES[key]
        subset = obs[obs["source_id"] == source["source_id"]]
        if len(subset) < source.get("min_rows", 0):
            report.fail("coverage.rows",
                        f"{key} produced {len(subset):,} rows, below the floor of "
                        f"{source['min_rows']:,}")
        if subset["dbn"].nunique() < source.get("min_dbns", 0):
            report.fail("coverage.schools",
                        f"{key} covers {subset['dbn'].nunique():,} schools, below the "
                        f"floor of {source['min_dbns']:,}")

    reported = obs[obs["status"] == cfg.STATUS_OK]
    per_school = reported.groupby("dbn").size()
    silent = set(schools["dbn"]) - set(per_school.index)
    if silent:
        report.warn("coverage.no_values",
                    f"{len(silent):,} schools have no reported value at all, "
                    f"for example {sorted(silent)[:3]}")
    thin = per_school[per_school < cfg.VALIDATION["thin_profile_values"]]
    if len(thin):
        report.warn("coverage.thin_profiles",
                    f"{len(thin):,} schools have fewer than "
                    f"{cfg.VALIDATION['thin_profile_values']} reported values")

    unnamed = schools["name"].isna().sum()
    if unnamed:
        report.fail("coverage.unnamed", f"{unnamed:,} schools have no name")

    # Every open school should carry an address. A school without one is
    # published with the address section absent, never with a placeholder.
    open_schools = schools[schools["status"] == "open"]
    no_address = open_schools["address"].isna().sum()
    if no_address:
        report.warn("coverage.no_address",
                    f"{no_address:,} open schools have no published address")


def check_sqr_results(tables, report):
    """Checks on the quality report workbooks that a shape test cannot make.

    Required columns are matched when the workbooks are read. Here the values
    are tested: enough schools, the City's four rating words, and ranges that
    a misread column would break.
    """
    obs = tables["observations"]
    results = obs[obs["source_id"] == "sqr_results"].copy()
    if results.empty:
        report.fail("sqr_results.empty", "no rows from the quality report workbooks")
        return
    results["number"] = pd.to_numeric(results["value"], errors="coerce")
    formats = tables["metrics"].set_index("metric_id")["format"]
    results["format"] = results["metric_id"].map(formats)

    newest = results["school_year"].max()
    latest = results[results["school_year"] == newest]
    for report_type, floor in cfg.SOURCES["sqr_results"]["min_dbns"].items():
        count = latest.loc[latest["report_type"] == report_type, "dbn"].nunique()
        report.fact(f"sqr_results_{report_type.lower()}_schools_{newest}", count)
        if count < floor:
            report.fail("sqr_results.schools",
                        f"the {newest} {report_type} workbook has {count:,} schools, "
                        f"below the floor of {floor:,}")

    rated = results[results["text"].notna() & (results["text"] != "")]
    words = set(cfg.RATING_WORDS.values())
    unknown = set(rated["text"]) - words
    if unknown:
        report.fail("sqr_results.rating_words", f"unrecognised rating words {sorted(unknown)}")
    # The City sets the word from the first digit of the score, so a mismatch
    # means a word and a score were read from different rows or columns.
    expected = rated["number"].map(lambda v: cfg.RATING_WORDS.get(int(v)) if pd.notna(v) else None)
    mismatched = rated[expected != rated["text"]]
    if len(mismatched):
        report.fail("sqr_results.rating_digit",
                    f"{len(mismatched):,} rating words disagree with their score, for example "
                    f"{mismatched[['dbn', 'metric_id', 'value', 'text']].head(3).to_dict('records')}")
    stray = set(rated["metric_id"]) - set(m["metric_id"] for m in cfg.SQR_RESULTS_METRICS
                                          if m.get("text"))
    if stray:
        report.fail("sqr_results.text_metric", f"rating words on unrated metrics {sorted(stray)}")

    def out_of_range(mask, check, what):
        bad = results[mask]
        if len(bad):
            report.fail(check, f"{len(bad):,} {what}, for example "
                               f"{bad[['dbn', 'metric_id', 'value']].head(3).to_dict('records')}")

    number, fmt = results["number"], results["format"]
    low, high = cfg.RATING_RANGE
    out_of_range((fmt == "index_unit") & ((number < 0) | (number > cfg.INDEX_UNIT_MAX)),
                 "sqr_results.index_range",
                 f"Impact or Performance values outside 0 to {cfg.INDEX_UNIT_MAX}")
    out_of_range((fmt == "rating_score") & ((number < low) | (number > high)),
                 "sqr_results.rating_range", f"rating scores outside {low} to {high}")
    # The City publishes a few enrollment shares above 100%. Past 1.5 the value
    # is a misread column, not the City's figure.
    out_of_range((fmt == "pct_unit") & ((number < 0) | (number > 1.5)),
                 "sqr_results.pct_range", "percentages outside 0 to 1.5")
    over = results[(fmt == "pct_unit") & (number > 1)]
    if len(over):
        report.warn("sqr_results.pct_over_one",
                    f"{len(over):,} percentages above 100% as published, for example "
                    f"{over[['dbn', 'school_year', 'metric_id', 'value']].head(3).to_dict('records')}")
    averages = pd.to_numeric(results["comparison"], errors="coerce")
    out_of_range((averages < 0) | (averages > 1), "sqr_results.average_range",
                  "City averages outside 0 to 1")


def check_freshness(tables, report):
    """Freshness comes from the data period, never from the day the job ran."""
    obs = tables["observations"]
    periods = {}
    for source_id, subset in obs.groupby("source_id"):
        periods[source_id] = str(subset["school_year"].max())
    report.fact("latest_periods", periods)

    # The school year label is "2024-25", and a year's report is published in
    # the autumn after it ends. Before September the newest report that can
    # exist covers the year that ended fifteen months ago.
    now = datetime.now(timezone.utc)
    expected = now.year - 1 if now.month >= 9 else now.year - 2
    for source_id in ("sqr", "sqr_results"):
        newest = periods.get(source_id)
        if not newest:
            continue
        behind = expected - int(str(newest)[:4])
        if behind >= 2:
            report.fail(f"freshness.{source_id}",
                        f"the newest {source_id} period is {newest}, "
                        f"{behind} releases behind the expected {expected}-"
                        f"{str(expected + 1)[-2:]}")
        elif behind == 1:
            report.warn(f"freshness.{source_id}",
                        f"the newest {source_id} period is {newest}, "
                        f"one release behind the expected {expected}-"
                        f"{str(expected + 1)[-2:]}")


def check_against_published(tables, report):
    """Compare with what is already live and refuse a large unexplained loss."""
    status_path = cfg.SITE_DATA / "status.json"
    if not status_path.exists():
        report.fact("previous_build", "none, this is the first publish")
        return
    previous = json.loads(status_path.read_text())
    before = previous.get("counts", {})

    now_schools = len(tables["schools"])
    was_schools = before.get("schools")
    if was_schools:
        loss = (was_schools - now_schools) / was_schools
        report.fact("school_change", f"{was_schools:,} to {now_schools:,}")
        if loss > cfg.VALIDATION["max_school_loss"]:
            report.fail("regression.schools",
                        f"the school count fell {loss:.1%}, past the "
                        f"{cfg.VALIDATION['max_school_loss']:.0%} tolerance")

    now_obs = len(tables["observations"])
    was_obs = before.get("observations")
    if was_obs:
        loss = (was_obs - now_obs) / was_obs
        report.fact("observation_change", f"{was_obs:,} to {now_obs:,}")
        if loss > cfg.VALIDATION["max_row_shrinkage"]:
            report.fail("regression.observations",
                        f"the observation count fell {loss:.1%}, past the "
                        f"{cfg.VALIDATION['max_row_shrinkage']:.0%} tolerance")

    now_coords = int(tables["schools"]["latitude"].notna().sum())
    was_coords = before.get("schools_with_coordinates")
    if was_coords:
        loss = (was_coords - now_coords) / was_coords
        report.fact("coordinate_change", f"{was_coords:,} to {now_coords:,}")
        if loss > cfg.VALIDATION["max_coordinate_loss"]:
            report.fail("regression.coordinates",
                        f"schools with a coordinate fell {loss:.1%}, past the "
                        f"{cfg.VALIDATION['max_coordinate_loss']:.0%} tolerance")

    # A metric that disappears takes a profile section with it.
    was_metrics = set(previous.get("metric_ids", []))
    if was_metrics:
        lost = was_metrics - set(tables["metrics"]["metric_id"])
        if lost:
            report.fail("regression.metrics",
                        f"{len(lost)} published metrics are gone, "
                        f"for example {sorted(lost)[:5]}")


# ---- School zones ----------------------------------------------------------

# Square miles per square degree at New York's latitude. Within the city's
# span this is good to about half a percent, which is enough for thresholds.
SQ_MI_PER_SQ_DEG = 111.05 * 84.51 / 2.589988


def in_ring(x, y, ring):
    """The browser's even-odd test, on numpy arrays, with the same arithmetic."""
    xi, yi = ring[:, 0], ring[:, 1]
    xj, yj = np.roll(xi, 1), np.roll(yi, 1)
    crosses = (yi > y) != (yj > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        hits = crosses & (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    return bool(np.count_nonzero(hits) % 2)


def browser_contains(zone, x, y):
    b = zone["b"]
    if x < b[0] or x > b[2] or y < b[1] or y > b[3]:
        return False
    for polygon in zone["rings"]:
        if in_ring(x, y, polygon[0]) and not any(in_ring(x, y, hole) for hole in polygon[1:]):
            return True
    return False


def browser_lookup(published, by_file, level, x, y):
    """The zone a browser finds at a point, through the grid, or None."""
    grid = published["grid"]
    col = math.floor((x - grid["x0"]) / grid["step"])
    row = math.floor((y - grid["y0"]) / grid["step"])
    if not (0 <= col < grid["cols"] and 0 <= row < grid["rows"]):
        return None
    for file_index in grid["sets"][grid["cells"][row * grid["cols"] + col]]:
        for zone in by_file[published["files"][file_index]][level]:
            if browser_contains(zone, x, y):
                return zone["id"]
    return None


def load_source_zones(manifest):
    """The source polygons, repaired only, by level: (zone ids, kinds, shapes)."""
    out = {}
    for record in manifest["sources"]:
        if not record["source_id"].startswith("zones_"):
            continue
        level = record["level"]
        key = cfg.ZONE_LEVELS[level]["id"]
        features = json.loads((cfg.ROOT / record["path"]).read_text())["features"]
        out[level] = (
            [int(float(f["properties"][key])) for f in features],
            [shapely.make_valid(shapely.geometry.shape(f["geometry"])) for f in features],
        )
    return out


def check_lookup(published, table, source, schools, report):
    """Published files and grid give the zone the source gives, point by point.

    Points are seeded at random across the grid, plus every open school. The
    published side uses the browser's own test. A disagreement within about a
    metre of a line is rounding and is counted, not failed.
    """
    rng = random.Random(cfg.ZONE_CHECKS["lookup_seed"])
    grid = published["grid"]
    span_x, span_y = grid["cols"] * grid["step"], grid["rows"] * grid["step"]
    points = [(grid["x0"] + rng.random() * span_x, grid["y0"] + rng.random() * span_y)
              for _ in range(cfg.ZONE_CHECKS["lookup_points"])]
    located = schools[(schools["status"] == "open") & schools["latitude"].notna()]
    points += list(zip(located["longitude"].astype(float), located["latitude"].astype(float)))

    by_file = {f: {level: [] for level in cfg.ZONE_LEVELS} for f in published["files"]}
    for zone in published["zones"]:
        zone["rings"] = [[np.array(ring) for ring in polygon] for polygon in zone["g"]]
        by_file[zone["file"]][zone["level"]].append(zone)

    land = set(zip(table.loc[table["kind"] == "land", "level"],
                   table.loc[table["kind"] == "land", "zone_id"].astype(int)))
    xs, ys = np.array([p[0] for p in points]), np.array([p[1] for p in points])
    edge, wrong, found = 0, [], 0
    for level, (ids, shapes) in source.items():
        tree = shapely.STRtree(shapes)
        pairs = tree.query(shapely.points(xs, ys), predicate="intersects")
        expected = {}
        for p, g in zip(*pairs):
            if (level, ids[g]) not in land:
                expected.setdefault(int(p), set()).add(int(g))
        for p, (x, y) in enumerate(points):
            got = browser_lookup(published, by_file, level, x, y)
            want = {ids[g] for g in expected.get(p, ())}
            if got is not None:
                found += 1
            if (got is None and not want) or got in want:
                continue
            near = [shapes[g] for g in expected.get(p, ())]
            if got is not None:
                near += [shapes[ids.index(got)]]
            point = shapely.Point(x, y)
            if near and min(s.boundary.distance(point) for s in near) < cfg.ZONE_CHECKS["edge_degrees"]:
                edge += 1
            else:
                wrong.append({"level": level, "point": [round(x, 6), round(y, 6)],
                              "published": got, "source": sorted(want)})
    report.fact("zones_lookup_points", len(points))
    report.fact("zones_lookup_found", found)
    report.fact("zones_lookup_edge", edge)
    if wrong:
        report.fail("zones.lookup",
                    f"{len(wrong):,} points find a different zone in the published files than "
                    f"in the source, for example {wrong[:3]}")


def check_geometry(published, table, source, report):
    """Each published zone covers the area its source polygon covers.

    Random points miss a small zone, so every zone is also compared whole.
    Rounding to six decimals moves a line by about 10 cm, so the area that
    differs should stay under 20 cm times the zone's perimeter.
    """
    metres = math.sqrt(SQ_MI_PER_SQ_DEG * 2.589988e6)
    expected = set(zip(table.loc[table["kind"] != "land", "level"],
                       table.loc[table["kind"] != "land", "zone_id"].astype(int)))
    shown = {(z["level"], z["id"]): z for z in published["zones"]}
    if expected != set(shown):
        report.fail("zones.published_set", f"zones missing from the site files "
                                           f"{sorted(expected - set(shown))[:5]}, or extra "
                                           f"{sorted(set(shown) - expected)[:5]}")
    invalid, drifted, worst = 0, [], 0.0
    for level, (ids, shapes) in source.items():
        for zone_id, original in zip(ids, shapes):
            zone = shown.get((level, zone_id))
            if not zone:
                continue
            shape = shapely.geometry.shape({"type": "MultiPolygon", "coordinates": zone["g"]})
            if not shape.is_valid:
                invalid += 1
                continue
            differs = shape.symmetric_difference(original).area * metres ** 2
            allowed = original.length * metres * 0.2
            worst = max(worst, differs / allowed if allowed else 0)
            if differs > allowed:
                drifted.append(f"{level} {zone_id}: {differs:,.0f} sq m")
    report.fact("zones_geometry_worst_share_of_allowance", round(worst, 3))
    if invalid:
        report.fail("zones.geometry", f"{invalid} published zones are not valid polygons")
    if drifted:
        report.fail("zones.geometry_drift", f"{len(drifted)} published zones differ from the "
                                            f"source by more than rounding: {drifted[:5]}")


def zone_diff(published, report):
    """What this build changes against the published zones, by district.

    Written to build/zones-diff.json for the new-zone runbook. Zones are
    matched by level and number, which held for 765 of 770 elementary zones
    from 2023-24 to 2024-25.
    """
    served = cfg.SITE_DATA / "zones"
    index_path = served / "index.json"
    if not index_path.exists():
        diff = {"against": None, "note": "first publish"}
    else:
        index = json.loads(index_path.read_text())
        before = {}
        for name in index["files"]:
            path = served / index["current"] / f"{name}.json"
            if path.exists():
                payload = json.loads(path.read_text())
                for level in cfg.ZONE_LEVELS:
                    for zone in payload.get(level, []):
                        before[(level, zone["id"])] = zone
        after = {(z["level"], z["id"]): z for z in published["zones"]}
        changes = {}

        def note(kind, key, zone):
            district = zone.get("dist") or "no district"
            changes.setdefault(district, {}).setdefault(kind, []).append(f"{key[0]} {key[1]}")

        for key in sorted(set(after) - set(before)):
            note("added", key, after[key])
        for key in sorted(set(before) - set(after)):
            note("removed", key, before[key])
        for key in sorted(set(after) & set(before)):
            old, new = before[key], after[key]
            if old["g"] != new["g"]:
                note("reshaped", key, new)
            if old.get("dbns") != new["dbns"]:
                note("schools", key, new)
            if old.get("remark") != new.get("remark"):
                note("remark", key, new)
        diff = {"against": index["current"], "year": published["year"],
                "districts": dict(sorted(changes.items()))}
    (cfg.BUILD / "zones-diff.json").write_text(json.dumps(diff, indent=2))
    counts = {}
    for kinds in diff.get("districts", {}).values():
        for kind, keys in kinds.items():
            counts[kind] = counts.get(kind, 0) + len(keys)
    report.fact("zones_diff", {"against": diff["against"], **counts})


def check_zones(tables, report):
    """The checks in "Data integrity checks" of ZONES-PLAN.md."""
    manifest = json.loads((cfg.BUILD / "fetch-manifest.json").read_text())
    table = pd.read_csv(cfg.BUILD / "zones.csv", dtype=str, keep_default_na=False)
    published = json.loads((cfg.BUILD / "zones.json").read_text())
    year = published["year"]
    schools = tables["schools"]
    status = dict(zip(schools["dbn"], schools["status"]))
    report.fact("zones_year", year)

    for level, floor in cfg.ZONE_CHECKS["min_features"].items():
        count = int((table["level"] == level).sum())
        report.fact(f"zones_{level}_features", count)
        if count < floor:
            report.fail("zones.features", f"{level} has {count:,} zones, below the floor of {floor:,}")

    duplicated = table[table.duplicated(["zone_year", "level", "zone_id"], keep=False)]
    if len(duplicated):
        report.fail("zones.key", f"zone numbers repeat: "
                                 f"{duplicated[['level', 'zone_id']].head(5).to_dict('records')}")

    named = {(level, d) for level, v in zip(table["level"], table["dbns"]) if v
             for d in v.split("|")}
    unknown = sorted({d for _, d in named} - set(status))
    if unknown:
        report.fail("zones.dbn_join", f"{len(unknown)} zone DBNs are not schools on the site: "
                                      f"{unknown[:10]}")

    overrides = cfg.ZONE_FORMER.get(year, {})
    closed = sorted({d for _, d in named if status.get(d) == "former"})
    unlisted = [d for d in closed if d not in overrides]
    if unlisted:
        report.fail("zones.former", f"zoned schools listed as closed with no entry in "
                                    f"ZONE_FORMER: {unlisted}")
    stale = sorted(set(overrides) - set(closed))
    if stale:
        report.warn("zones.former_stale", f"ZONE_FORMER lists schools that are open or no "
                                          f"longer zoned: {stale}")
    report.fact("zones_closed_schools", closed)

    # A rule is blank only for a zone that names a school and has no remark.
    unclassified = table[(table["rule"] == "") & ((table["remark"] != "") | (table["dbns"] == ""))]
    if len(unclassified):
        report.fail("zones.remarks", f"{len(unclassified)} remarks fit no rule in ZONE_RULES: "
                                     f"{sorted(set(unclassified['remark']))[:5]}")
    report.fact("zones_rules", {f"{level} {rule or 'no remark'}": int(n) for (level, rule), n
                                in table.groupby(["level", "rule"]).size().items()})

    for change in published["changes"]:
        if change["missing"]:
            report.fail("zones.changes", f"the District {change['district']} change names "
                                         f"schools no zone holds: {change['missing']}")
        gone = [d for d in change["schools"] if d not in status]
        if gone:
            report.fail("zones.changes", f"the District {change['district']} change names "
                                         f"schools not on the site: {gone}")

    source = load_source_zones(manifest)
    check_geometry(published, table, source, report)

    city =shapely.union_all([shapely.make_valid(shapely.geometry.shape(f["geometry"]))
                              for f in json.loads((cfg.SITE_DATA / "districts.json").read_text())
                              ["features"]])
    for level, (ids, shapes) in source.items():
        tree = shapely.STRtree(shapes)
        left, right = tree.query(shapes, predicate="intersects")
        overlap = sum(shapes[a].intersection(shapes[b]).area
                      for a, b in zip(left, right) if a < b) * SQ_MI_PER_SQ_DEG
        report.fact(f"zones_{level}_overlap_sq_mi", round(overlap, 4))
        if overlap > cfg.ZONE_CHECKS["max_overlap_sq_mi"]:
            report.fail("zones.overlap", f"{level} zones overlap by {overlap:.3f} sq mi, past "
                                         f"{cfg.ZONE_CHECKS['max_overlap_sq_mi']}")
        covered = shapely.union_all(shapes).intersection(city).area / city.area
        report.fact(f"zones_{level}_coverage", round(covered, 4))
        floor = cfg.ZONE_CHECKS["min_coverage"].get(level)
        if floor and covered < floor:
            report.fail("zones.coverage", f"{level} zones cover {covered:.1%} of the district "
                                          f"outlines, under {floor:.0%}")

    priorities = tables["program_priorities"]
    for level, (source_id, pattern) in cfg.ZONE_DIRECTORY.items():
        directory = set(priorities.loc[(priorities["source_id"] == source_id)
                                       & priorities["priority"].str.contains(pattern, case=False,
                                                                             regex=True), "dbn"])
        zoned = {d for lvl, d in named if lvl == level}
        report.fact(f"zones_{level}_directory_agreement", f"{len(directory & zoned)} of {len(zoned)}")
        if directory != zoned:
            report.warn("zones.directory",
                        f"{level}: directory zone priority without a zone {sorted(directory - zoned)}; "
                        f"a zone without directory zone priority {sorted(zoned - directory)}")

    previous_path = cfg.SITE_DATA / "zones" / "index.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
    for level, now in published["inside"].items():
        report.fact(f"zones_{level}_inside_own_zone", f"{now['inside']} of {now['of']}")
        was = previous.get("inside", {}).get(level)
        if was and was["of"] and now["of"]:
            drop = was["inside"] / was["of"] - now["inside"] / now["of"]
            if drop > cfg.ZONE_CHECKS["max_inside_drop"]:
                report.warn("zones.inside", f"{level}: schools inside their own zone fell "
                                            f"{drop:.1%} from the published year")
    if previous.get("current") and year < previous["current"]:
        report.fail("zones.year", f"the zone year {year} is older than the published "
                                  f"{previous['current']}")

    summary = manifest.get("zones", {})
    if summary.get("next"):
        report.warn("zones.newer_year", f"Open Data lists School Zones {summary['next']}, which "
                                        f"is not in ZONE_YEARS. Review it before building it.")
    if summary.get("listed") is None:
        report.warn("zones.catalog", "the Open Data catalog could not be read, so newer zone "
                                     "years were not looked for")
    elif year in summary["listed"] and summary["listed"][year] != cfg.ZONE_YEARS[year]:
        report.warn("zones.dataset_ids", f"the catalog lists {summary['listed'][year]} for "
                                         f"{year}, not {cfg.ZONE_YEARS[year]}")
    now = datetime.now(timezone.utc)
    current = now.year if now.month >= 9 else now.year - 1
    if int(year[:4]) < current:
        report.warn("zones.freshness", f"the newest zones are for {year}; the current school "
                                       f"year is {current}-{str(current + 1)[-2:]}")

    check_lookup(published, table, source, schools, report)
    zone_diff(published, report)


def main():
    report = Report()
    tables = load_tables()

    check_keys(tables, report)
    check_references(tables, report)
    check_missing_data_rules(tables, report)
    check_coverage(tables, report)
    check_sqr_results(tables, report)
    check_freshness(tables, report)
    check_against_published(tables, report)
    check_zones(tables, report)

    result = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "passed": report.ok,
        "failures": report.failures,
        "warnings": report.warnings,
        "facts": report.facts,
    }
    REPORT.write_text(json.dumps(result, indent=2, default=str))
    print(f"[validate] {'passed' if report.ok else 'FAILED'} with "
          f"{len(report.failures)} failures and {len(report.warnings)} warnings",
          flush=True)
    return result


if __name__ == "__main__":
    outcome = main()
    sys.exit(0 if outcome["passed"] else 1)
