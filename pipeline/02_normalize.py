"""Stage 2: turn the cached sources into the project's tables.

The output is five tables with declared grains:

    schools              one row per DBN
    metrics              one row per metric ID
    observations         one row per DBN, school year, and metric ID
    programs             one row per DBN and program
    program_priorities   one row per DBN, program, and priority rank

Two rules run through the whole stage. Join on the DBN and never on a school
name. Keep missing, suppressed, and not applicable as three different things,
and never let any of them become a zero.
"""

import importlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
cfg = importlib.import_module("00_config")

DBN_RE = re.compile(cfg.DBN_PATTERN)


def log(message):
    print(f"[normalize] {message}", flush=True)


# ---- Small helpers ---------------------------------------------------------

def clean_text(value):
    """Trim a source string, returning None for a blank or a null marker."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    if text.lower() in cfg.NULL_MARKERS:
        return None
    return text


def to_number(value):
    """Parse a number, treating the sources' own null markers as no value.

    A value that cannot be parsed returns None. It never returns 0, because a
    failed parse and a real zero are different facts.
    """
    text = clean_text(value)
    if text is None:
        return None
    text = text.replace(",", "").replace("%", "").strip()
    try:
        return float(text)
    except ValueError:
        return None


def censored_bound(value):
    """Return the source's own bound text, if the cell holds one instead of a number.

    The demographic snapshot writes "Above 95%" or "Below 5%" where an exact
    figure would risk identifying students. That is a published fact about the
    school, so it is kept rather than flattened into a missing value.
    """
    text = clean_text(value)
    if text is None:
        return None
    return cfg.CENSORED_VALUES.get(text.lower())


def school_year_label(start):
    """Turn the source's 2024 into the 2024-25 that people actually use."""
    start = int(start)
    return f"{start}-{str(start + 1)[-2:]}"


def borough_of(dbn):
    return cfg.BOROUGH_BY_CODE.get(dbn[2], None)


# ---- Schools ---------------------------------------------------------------

def read_sqr():
    """Load the School Quality Reports export with typed, renamed columns."""
    log("reading the quality reports export")
    frame = pd.read_csv(
        cfg.RAW / cfg.SOURCES["sqr"]["cache"],
        dtype={"School Year": str, "Report Year": str},
        low_memory=False,
    )
    # Rename by name. Selecting columns by position is how the personal
    # workbook's own analysis went wrong, and pandas returns usecols in file
    # order rather than the order asked for.
    frame = frame.rename(columns={
        "School Year": "school_year_start",
        "Report Year": "report_year",
        "District, Borough and School Number (DBN)": "dbn",
        "School Name": "school_name",
        "Report Type": "report_type",
        "School Type": "school_type",
        "Metric Variable Name": "metric_id",
        "Metric Display Name": "metric_label",
        "Number of Students": "n",
        "Metric Value": "value",
        "Comparison Group Average": "comparison",
        "Metric Score": "source_score",
    })
    frame["dbn"] = frame["dbn"].astype(str).str.strip().str.upper()
    frame = frame[frame["dbn"].str.match(DBN_RE)].copy()
    frame["school_year"] = frame["school_year_start"].map(school_year_label)
    log(f"  {len(frame):,} rows, {frame['dbn'].nunique():,} schools")
    return frame


def read_demographics():
    log("reading the demographic snapshot")
    source = cfg.SOURCES["demographics"]
    frame = pd.read_excel(cfg.RAW / source["cache"], sheet_name=source["sheet"], dtype=str)
    frame.columns = [str(c).strip() for c in frame.columns]
    frame["dbn"] = frame["DBN"].astype(str).str.strip().str.upper()
    frame = frame[frame["dbn"].str.match(DBN_RE)].copy()
    frame["school_year"] = frame["Year"].astype(str).str.strip()
    log(f"  {len(frame):,} rows, {frame['dbn'].nunique():,} schools")
    return frame


def read_directory(key):
    source = cfg.SOURCES[key]
    frame = pd.read_excel(cfg.RAW / source["cache"], sheet_name=source["sheet"], dtype=str)
    frame.columns = [str(c).strip() for c in frame.columns]
    dbn_col = source["dbn_column"]
    frame["dbn"] = frame[dbn_col].astype(str).str.strip().str.upper()
    kept = frame[frame["dbn"].str.match(DBN_RE)].copy()
    log(f"  {key}: {len(frame):,} rows in, {len(kept):,} with a school DBN, "
        f"{kept['dbn'].nunique():,} schools")
    return kept


def directory_identity(key, frame):
    """One identity row per DBN, taking the first stated value for each field.

    The elementary file repeats a school once per entry point, and the fields
    are populated on different rows: grade span on the kindergarten row, total
    students on another. Coalescing per field recovers a complete record.
    """
    fields = cfg.DIRECTORY_IDENTITY[key]
    out = {}
    for canonical, column in fields.items():
        if column not in frame.columns:
            continue
        series = frame[column].map(clean_text)
        out[canonical] = series.groupby(frame["dbn"]).apply(
            lambda s: next((v for v in s if v is not None), None))
    result = pd.DataFrame(out)
    result.index.name = "dbn"
    result["directory_source"] = key
    return result.reset_index()


# The elementary directory writes the DBN into the school name, as in
# "P.S. 20 Anna Silver (01M020)". Strip it: the DBN is shown as its own field.
NAME_DBN_SUFFIX = re.compile(r"\s*\(\d{2}[MXKQR]\d{3}\)\s*$")


def build_schools(sqr, demo, directories):
    """Assemble one row per DBN from every source that describes the school."""
    log("building the school table")

    # The universe: any DBN the Department of Education has published data
    # about. Directory-only codes are excluded on purpose.
    universe = sorted(set(sqr["dbn"]) | set(demo["dbn"]))
    schools = pd.DataFrame({"dbn": universe})

    # Identity from the quality reports: the most recent name and report type.
    latest_sqr = (sqr.sort_values("school_year_start")
                     .groupby("dbn")
                     .agg(sqr_name=("school_name", "last"),
                          report_type=("report_type", "last"),
                          school_type=("school_type", "last"),
                          sqr_first_year=("school_year", "min"),
                          sqr_last_year=("school_year", "max")))
    # Every report type a school has ever filed under, which is how a K-8 that
    # became a middle school stays legible.
    latest_sqr["report_types"] = (sqr.groupby("dbn")["report_type"]
                                     .apply(lambda s: "|".join(sorted(set(s)))))
    schools = schools.merge(latest_sqr.reset_index(), on="dbn", how="left")

    # Identity from the demographic snapshot: the most recent name, enrollment,
    # and the grades the school actually served.
    demo_sorted = demo.sort_values("school_year")
    latest_demo = demo_sorted.groupby("dbn").last()
    schools = schools.merge(
        pd.DataFrame({
            "dbn": latest_demo.index,
            "demo_name": latest_demo["School Name"].map(clean_text).values,
            "demo_year": latest_demo["school_year"].values,
            "demo_enrollment": latest_demo["Total Enrollment"].map(to_number).values,
            "demo_grades": [grades_served(row) for _, row in latest_demo.iterrows()],
        }), on="dbn", how="left")
    schools["demo_first_year"] = schools["dbn"].map(
        demo.groupby("dbn")["school_year"].min())
    schools["demo_last_year"] = schools["dbn"].map(
        demo.groupby("dbn")["school_year"].max())

    # Identity from the directories, in the order a school should be described:
    # high school first, then middle, then elementary. A K-12 school appears in
    # more than one file and the later grades carry the fuller record.
    for key in ("directory_es", "directory_ms", "directory_hs"):
        ident = directory_identity(key, directories[key])
        ident = ident.add_prefix(key.replace("directory_", "dir_") + "_")
        ident = ident.rename(columns={f"{key.replace('directory_', 'dir_')}_dbn": "dbn"})
        schools = schools.merge(ident, on="dbn", how="left")

    def coalesce(row, field, order=("hs", "ms", "es")):
        for prefix in order:
            value = row.get(f"dir_{prefix}_{field}")
            if value is not None and not (isinstance(value, float) and pd.isna(value)):
                return value
        return None

    for field in ("name", "address", "grades", "accessibility", "website",
                  "directory_url", "phone", "overview", "start_time", "end_time",
                  "languages", "subway", "bus", "shared_building", "neighborhood"):
        schools[f"dir_{field}"] = schools.apply(lambda r: coalesce(r, field), axis=1)

    # Name: prefer the directory spelling, which is the one families see, then
    # the demographic snapshot, then the quality reports.
    schools["name"] = (schools["dir_name"]
                       .fillna(schools["demo_name"])
                       .fillna(schools["sqr_name"]))
    schools["name"] = schools["name"].map(
        lambda v: NAME_DBN_SUFFIX.sub("", v).strip() if isinstance(v, str) else v)

    schools["boro_code"] = schools["dbn"].str[2]
    schools["boro"] = schools["dbn"].map(borough_of)
    schools["district"] = schools["dbn"].str[:2]
    schools["district_label"] = schools["district"].map(
        lambda d: cfg.SPECIAL_DISTRICTS.get(d.lstrip("0") or d,
                                            f"District {int(d)}"))

    schools["grades"] = schools["dir_grades"].fillna(schools["demo_grades"])
    schools["enrollment"] = schools["demo_enrollment"]
    schools["enrollment_year"] = schools["demo_year"]

    # A school is listed as currently open when it appears in the newest
    # demographic snapshot or in a current directory. Anything else is carried
    # as a closed or former school, with its history intact.
    newest_demo_year = demo["school_year"].max()
    in_current_demo = set(demo.loc[demo["school_year"] == newest_demo_year, "dbn"])
    in_directory = set().union(*[set(d["dbn"]) for d in directories.values()])
    schools["status"] = [
        "open" if (d in in_current_demo or d in in_directory) else "former"
        for d in schools["dbn"]
    ]
    schools["in_directory"] = schools["dbn"].isin(in_directory)

    # School years are strings such as "2024-25", which sort correctly but do
    # not survive a numeric reduction alongside a missing value.
    def span(row, columns, pick):
        values = [row[c] for c in columns if isinstance(row[c], str) and row[c]]
        return pick(values) if values else None

    schools["last_year"] = schools.apply(
        lambda r: span(r, ["sqr_last_year", "demo_last_year"], max), axis=1)
    schools["first_year"] = schools.apply(
        lambda r: span(r, ["sqr_first_year", "demo_first_year"], min), axis=1)

    keep = [
        "dbn", "name", "boro", "boro_code", "district", "district_label",
        "report_type", "report_types", "school_type", "grades", "status",
        "enrollment", "enrollment_year", "in_directory",
        "first_year", "last_year",
        "dir_address", "dir_phone", "dir_website", "dir_directory_url",
        "dir_accessibility", "dir_overview", "dir_start_time", "dir_end_time",
        "dir_languages", "dir_subway", "dir_bus", "dir_shared_building",
        "dir_neighborhood",
    ]
    schools = schools[keep].rename(columns={
        "dir_address": "address", "dir_phone": "phone", "dir_website": "website",
        "dir_directory_url": "directory_url", "dir_accessibility": "accessibility",
        "dir_overview": "overview", "dir_start_time": "start_time",
        "dir_end_time": "end_time", "dir_languages": "languages",
        "dir_subway": "subway", "dir_bus": "bus",
        "dir_shared_building": "shared_building", "dir_neighborhood": "neighborhood",
    })
    log(f"  {len(schools):,} schools, {int((schools['status'] == 'open').sum()):,} open")
    return schools


def grades_served(row):
    """Read the grade span off the enrollment counts, low grade to high grade."""
    present = []
    for label, column in cfg.GRADE_COLUMNS:
        value = to_number(row.get(column))
        if value is not None and value > 0:
            present.append(label)
    if not present:
        return None
    return present[0] if len(present) == 1 else f"{present[0]}-{present[-1]}"


# ---- Coordinates -----------------------------------------------------------

def load_geocode_cache():
    path = cfg.RAW / cfg.SOURCES["geosearch"]["cache"]
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_geocode_cache(cache):
    path = cfg.RAW / cfg.SOURCES["geosearch"]["cache"]
    path.write_text(json.dumps(cache, indent=1, sort_keys=True))


def coordinates_from_hs(directories):
    """Pull the coordinates the high school file already publishes.

    They arrive inside a text field, as
    "220 HENRY STREET, MANHATTAN NY 10002 (40.713362,-73.986051)".
    """
    frame = directories["directory_hs"]
    column = cfg.DIRECTORY_IDENTITY["directory_hs"]["location"]
    found = {}
    if column not in frame.columns:
        return found
    pattern = re.compile(cfg.HS_LOCATION_COORDS)
    for dbn, text in zip(frame["dbn"], frame[column]):
        text = clean_text(text)
        if not text:
            continue
        match = pattern.search(text)
        if match:
            found[dbn] = (float(match.group(1)), float(match.group(2)), "source")
    return found


def geocode_one(address, session):
    """Look up one address. Returns a coordinate, None for a real no-match, or
    raises so the caller can leave it out of the cache and try again next run."""
    response = session.get(cfg.SOURCES["geosearch"]["url"],
                           params={"text": address, "size": 1},
                           timeout=cfg.GEOCODE_TIMEOUT)
    response.raise_for_status()
    features = response.json().get("features") or []
    if not features:
        return None
    lon, lat = features[0]["geometry"]["coordinates"]
    return {"lat": lat, "lon": lon}


def geocode_all(addresses, cache):
    """Resolve the addresses that are not cached yet.

    The service answers in about three seconds, so several hundred addresses in
    series would take longer than the rest of the build put together. A small
    pool keeps it to a few minutes without leaning on a free public service.
    The cache is written as results arrive, so an interrupted run keeps its work.
    """
    pending = [a for a in addresses if a not in cache]
    if not pending:
        return
    log(f"  geocoding {len(pending):,} new addresses with "
        f"{cfg.GEOCODE_WORKERS} parallel requests")

    session = requests.Session()
    done = 0
    with ThreadPoolExecutor(max_workers=cfg.GEOCODE_WORKERS) as pool:
        futures = {pool.submit(geocode_one, address, session): address
                   for address in pending}
        for future in as_completed(futures):
            address = futures[future]
            try:
                cache[address] = future.result()
            except Exception as error:
                # Not cached, so the next run retries rather than recording a
                # failed request as "this address has no coordinate".
                log(f"  geocoder failed for {address!r}: {error}")
            done += 1
            if done % cfg.GEOCODE_SAVE_EVERY == 0:
                save_geocode_cache(cache)
                log(f"  {done:,} of {len(pending):,} resolved")
    save_geocode_cache(cache)


def add_coordinates(schools, directories):
    log("resolving coordinates")
    published = coordinates_from_hs(directories)
    cache = load_geocode_cache()

    # Only schools without a published coordinate need the geocoder.
    wanted = sorted({
        address for dbn, address in zip(schools["dbn"], schools["address"])
        if dbn not in published and isinstance(address, str) and address.strip()
    })
    geocode_all(wanted, cache)

    lats, lons, sources = [], [], []
    for dbn, address in zip(schools["dbn"], schools["address"]):
        if dbn in published:
            lat, lon, origin = published[dbn]
            lats.append(lat); lons.append(lon); sources.append(origin)
            continue
        hit = cache.get(address) if isinstance(address, str) else None
        if hit:
            lats.append(hit["lat"]); lons.append(hit["lon"]); sources.append("geocoded")
        else:
            lats.append(None); lons.append(None); sources.append(None)

    schools["latitude"] = lats
    schools["longitude"] = lons
    # Provenance travels with the value: a coordinate the Department of
    # Education published is not the same fact as one matched from an address.
    schools["coordinate_source"] = sources
    have = schools["latitude"].notna().sum()
    published_count = sum(1 for s in sources if s == "source")
    log(f"  {have:,} of {len(schools):,} schools have a coordinate "
        f"({published_count:,} published by the source, "
        f"{have - published_count:,} matched from an address)")
    return schools


# ---- Metrics ---------------------------------------------------------------

def categorize(metric_id):
    for pattern, key, label in cfg.METRIC_CATEGORIES:
        if re.search(pattern, metric_id):
            return key, label
    return cfg.METRIC_CATEGORY_FALLBACK


def infer_format(metric_id, low, high):
    """Decide how a value should be written, and say where the decision came from.

    An explicit rule in the configuration always wins. Otherwise the range of
    the published values decides, and the metric is marked as inferred so the
    data dictionary can say so.
    """
    for pattern, fmt in cfg.FORMAT_OVERRIDES.items():
        if re.search(pattern, metric_id):
            return fmt, "declared"
    if high is None or pd.isna(high):
        return "number", "unknown"
    if low >= 0 and high <= 1.0001:
        return "pct_unit", "inferred"
    if low >= 0 and high <= 4.6:
        return "scale", "inferred"
    if low >= 0 and high <= 100.001:
        return "index_100", "inferred"
    return "number", "inferred"


def build_metrics(sqr):
    log("building the metric manifest")
    grouped = sqr.groupby("metric_id")
    metrics = grouped.agg(
        label=("metric_label", "first"),
        rows=("value", "size"),
        reported=("value", "count"),
        low=("value", "min"),
        high=("value", "max"),
        schools=("dbn", "nunique"),
        with_comparison=("comparison", "count"),
    ).reset_index()

    metrics["applies_to"] = grouped["report_type"].apply(
        lambda s: "|".join(sorted(set(s)))).values
    metrics["school_types"] = grouped["school_type"].apply(
        lambda s: "|".join(sorted(set(s)))).values
    metrics["first_year"] = grouped["school_year"].min().values
    metrics["last_year"] = grouped["school_year"].max().values

    cats = metrics["metric_id"].map(categorize)
    metrics["category"] = [c[0] for c in cats]
    metrics["category_label"] = [c[1] for c in cats]

    formats = [infer_format(m, lo, hi) for m, lo, hi
               in zip(metrics["metric_id"], metrics["low"], metrics["high"])]
    metrics["format"] = [f[0] for f in formats]
    metrics["format_source"] = [f[1] for f in formats]
    metrics["unit"] = metrics["format"].map(lambda f: cfg.FORMATS[f]["unit"])

    metrics["source_label"] = metrics["label"]

    # Split each measure into a base name and the student group it describes,
    # so a profile can lead with the all-students figure and keep the group
    # breakdowns under it in a stated order.
    split = [split_subgroup(label) for label in metrics["label"]]
    metrics["base_label"] = [s[0] for s in split]
    metrics["subgroup"] = [s[1] for s in split]
    metrics["subgroup_theme"] = [s[2] for s in split]
    metrics["theme_rank"] = [
        cfg.SUBGROUP_THEME_ORDER.index(t) if t in cfg.SUBGROUP_THEME_ORDER else 99
        for t in metrics["subgroup_theme"]
    ]

    # Measures that share a base name within a category belong together on
    # screen: one card for "Percentage of Students at Level 3 or 4, ELA" holding
    # the all-students figure and every group breakdown of it.
    #
    # The report scope is deliberately not part of the key. The all-students
    # variant is often published for a wider set of report types than its own
    # breakdowns are, and keying on scope would separate a measure from its own
    # subgroups. Where one base does hold two scopes, as elementary and high
    # school attendance do, the site labels the rows rather than splitting them.
    metrics["base_id"] = [
        f"{cat}:{base}" for cat, base in zip(
            metrics["metric_id"].map(lambda m: categorize(m)[0]), metrics["base_label"])
    ]

    metrics["label"] = disambiguate_labels(metrics)
    metrics["lower_is_better"] = [
        any(re.search(p, m) for p in cfg.LOWER_IS_BETTER) for m in metrics["metric_id"]
    ]
    metrics["source_id"] = "sqr"
    metrics["headline"] = metrics["metric_id"].isin(cfg.HEADLINE_METRICS)
    metrics["comparability_note"] = metrics["metric_id"].map(cfg.COMPARABILITY_BREAKS)
    metrics["description"] = metrics.apply(describe_metric, axis=1)
    return metrics


# Group name to theme, built once from the configuration. Matching is done on a
# lowercase, whitespace-collapsed key so the source's own spelling variants
# ("Multiracial" and "Multi-Racial", "Disabilites") all land in one place.
SUBGROUP_LOOKUP = {}
for _key, _label, _names in cfg.SUBGROUP_THEMES:
    for _name in _names:
        SUBGROUP_LOOKUP[" ".join(_name.lower().split())] = (_key, _name)

GRADE_SUFFIX = re.compile(r",\s*(Grade\s+\d+)\s*$", re.IGNORECASE)


def split_subgroup(label):
    """Separate a measure's base name from the student group it describes.

    Returns (base label, group name or None, theme key). The source writes the
    group after a dash, and a grade after a comma. Anything that is not a known
    group is left alone: "Average Student Attendance - Remote days" is a
    different measure, not a different group of students.
    """
    if not isinstance(label, str):
        return label, None, None

    grade = GRADE_SUFFIX.search(label)
    if grade:
        return label[:grade.start()].strip(), grade.group(1).title(), "grade"

    if " - " in label:
        base, tail = label.rsplit(" - ", 1)
        hit = SUBGROUP_LOOKUP.get(" ".join(tail.lower().split()))
        if hit:
            theme, canonical = hit
            return base.strip(), canonical, theme

    # A few labels run the dash straight against the group, as in
    # "10+ Credits in 1st Year -Multiracial".
    if " -" in label:
        base, tail = label.rsplit(" -", 1)
        hit = SUBGROUP_LOOKUP.get(" ".join(tail.lower().split()))
        if hit:
            theme, canonical = hit
            return base.strip(), canonical, theme

    return label, None, None


def disambiguate_labels(metrics):
    """Make every displayed label unique.

    The source reuses one display name across measures that are not the same
    thing. "Average Student Attendance" is published as one variable for
    elementary and middle grades and another for high schools, over different
    students. Left alone they collide: a comparison table shows two rows with
    the same name, each filled in for different schools, which reads as a
    duplicate rather than as two measures.

    Where a name is shared, the report types it belongs to are added. Where
    that is still not enough, the variable name is.
    """
    counts = metrics["label"].value_counts()
    labels = []
    for _, row in metrics.iterrows():
        label = row["label"]
        if counts.get(label, 0) > 1:
            scope = str(row["applies_to"]).replace("|", ", ")
            label = f"{label} ({scope})"
        labels.append(label)

    # A second pass for the rare case where the report types match too.
    seen = {}
    for index, label in enumerate(labels):
        seen.setdefault(label, []).append(index)
    for label, positions in seen.items():
        if len(positions) > 1:
            for index in positions:
                labels[index] = f"{label} [{metrics.iloc[index]['metric_id']}]"
    return labels


def describe_metric(row):
    """A sentence a reader can act on: what it counts and who it covers."""
    covers = ", ".join(cfg.REPORT_TYPES.get(r, r).lower()
                       for r in str(row["applies_to"]).split("|"))
    # The source's own wording, not the disambiguated display label.
    return (f"{row.get('source_label') or row['label']}. Published for {covers}. "
            f"School years {row['first_year']} to {row['last_year']}.")


def demographic_metrics_frame():
    """The snapshot's columns described in the same shape as the other metrics."""
    theme_order = [key for key, _ in cfg.DEMOGRAPHIC_THEMES]
    theme_labels = dict(cfg.DEMOGRAPHIC_THEMES)
    rows = []
    for metric_id, column, label, fmt, theme in cfg.DEMOGRAPHIC_METRICS:
        rows.append({
            "metric_id": metric_id,
            "label": label,
            "source_label": label,
            # Each demographic figure stands on its own rather than being a
            # group breakdown of something else, so the group is the theme and
            # the base name is the label.
            "base_label": theme_labels.get(theme, theme),
            "base_id": f"demographics:{theme}",
            "subgroup": label,
            "subgroup_theme": theme,
            "theme_rank": theme_order.index(theme) if theme in theme_order else 99,
            "source_column": column,
            "format": fmt,
            "format_source": "declared",
            "unit": cfg.FORMATS[fmt]["unit"],
            "category": "demographics",
            "category_label": "Enrollment and demographics",
            "source_id": "demographics",
            "applies_to": "|".join(sorted(cfg.REPORT_TYPES)),
            "school_types": "",
            "with_comparison": 0,
            "lower_is_better": False,
            "headline": metric_id in cfg.HEADLINE_METRICS,
            "comparability_note": None,
        })
    return pd.DataFrame(rows)


# ---- Observations ----------------------------------------------------------

def status_for(value, n):
    """Classify one cell. Missing, suppressed, and zero are three different things."""
    if value is not None and not pd.isna(value):
        return cfg.STATUS_OK
    # The source published a row and a group size but withheld the value. When
    # the group is small that is suppression, which is a fact about the group
    # rather than an absence of data.
    if n is not None and not pd.isna(n) and n < cfg.SMALL_GROUP_FLOOR:
        return cfg.STATUS_SUPPRESSED
    return cfg.STATUS_MISSING


def build_observations(sqr, demo):
    log("building observations")
    # A school serving grades 6 to 12 files two quality reports, one for its
    # middle grades and one for its high school grades, and both publish the
    # same metric for different students. Those are two observations, not a
    # duplicate, so the report type is part of the grain.
    quality = pd.DataFrame({
        "dbn": sqr["dbn"],
        "school_year": sqr["school_year"],
        "metric_id": sqr["metric_id"],
        "report_type": sqr["report_type"],
        "value": sqr["value"],
        "n": sqr["n"],
        "comparison": sqr["comparison"],
        "source_score": sqr["source_score"],
        "bound": None,
        "source_id": "sqr",
    })
    quality["status"] = [status_for(v, n) for v, n in zip(quality["value"], quality["n"])]

    long_rows = []
    for metric_id, column, _label, _fmt, _cat in cfg.DEMOGRAPHIC_METRICS:
        if column not in demo.columns:
            log(f"  demographic column missing from the source: {column}")
            continue
        raw = demo[column]
        values = raw.map(to_number)
        # The snapshot publishes poverty and economic need as "Above 95%" or
        # "Below 5%" at the extremes, to protect privacy. That is a published
        # fact, not an absence, so the bound is carried through.
        bounds = raw.map(censored_bound)
        long_rows.append(pd.DataFrame({
            "dbn": demo["dbn"].values,
            "school_year": demo["school_year"].values,
            "metric_id": metric_id,
            # The snapshot is one figure per school, not per report, so these
            # rows carry no report type.
            "report_type": None,
            "value": values.values,
            "n": demo["Total Enrollment"].map(to_number).values,
            # The snapshot publishes no comparison group and no score. The
            # columns are still typed as numbers so the two sources stack
            # without pandas guessing at an all-empty column.
            "comparison": pd.Series([float("nan")] * len(demo), dtype="float64").values,
            "source_score": pd.Series([float("nan")] * len(demo), dtype="float64").values,
            "bound": bounds.values,
            "source_id": "demographics",
        }))
    demographics = pd.concat(long_rows, ignore_index=True)
    demographics["status"] = [
        cfg.STATUS_OK if v is not None and not pd.isna(v)
        else cfg.STATUS_CENSORED if b
        else cfg.STATUS_MISSING
        for v, b in zip(demographics["value"], demographics["bound"])
    ]
    censored = int((demographics["status"] == cfg.STATUS_CENSORED).sum())
    if censored:
        log(f"  {censored:,} demographic values published as a bound, not a number")

    observations = pd.concat([quality, demographics], ignore_index=True)
    log(f"  {len(observations):,} observations, "
        f"{int((observations['status'] == 'ok').sum()):,} with a value")
    return observations


# ---- Programs --------------------------------------------------------------

def build_programs(directories):
    """Flatten each directory's wide program block into rows.

    Admissions data is program-level, not school-level: one school can run an
    open program and a screened one side by side, and collapsing them would
    invent a school-wide admissions method that does not exist.
    """
    log("building programs")
    programs, priorities = [], []

    for key, frame in directories.items():
        spec = cfg.DIRECTORY_PROGRAMS[key]
        level = {"directory_es": "Elementary", "directory_ms": "Middle",
                 "directory_hs": "High"}[key]
        for _, row in frame.iterrows():
            dbn = row["dbn"]
            for i in range(1, spec["count"] + 1):
                code = clean_text(row.get(spec["code"].format(i=i)))
                name = clean_text(row.get(spec["name"].format(i=i)))
                if not code and not name:
                    continue
                program_id = code or f"{dbn}-{level[:1]}{i}"
                record = {
                    "dbn": dbn,
                    "program_id": program_id,
                    "program_code": code,
                    "program_name": name,
                    "level": level,
                    "admissions_method": clean_text(row.get(spec["method"].format(i=i)))
                        if spec.get("method") else None,
                    "eligibility": clean_text(row.get(spec["eligibility"].format(i=i)))
                        if spec.get("eligibility") else None,
                    "description": clean_text(row.get(spec["description"].format(i=i)))
                        if spec.get("description") else None,
                    "source_id": key,
                }
                for audience in spec["audience"]:
                    for field in ("seats", "applicants", "per_seat"):
                        column = spec[field].get(audience)
                        record[f"{field}_{audience}"] = (
                            to_number(row.get(column.format(i=i))) if column else None)
                    filled_col = spec["filled"].get(audience)
                    record[f"filled_{audience}"] = (
                        clean_text(row.get(filled_col.format(i=i))) if filled_col else None)
                programs.append(record)

                for k in range(1, spec["priorities"] + 1):
                    text = clean_text(row.get(spec["priority"].format(i=i, k=k)))
                    if text:
                        priorities.append({
                            "dbn": dbn, "program_id": program_id,
                            "rank": k, "priority": text, "source_id": key,
                        })

    programs = pd.DataFrame(programs)
    # A school listed at more than one entry point repeats the same program.
    # The program is one thing, so keep one row for it.
    if not programs.empty:
        programs = programs.drop_duplicates(subset=["dbn", "program_id"], keep="first")
    priorities = pd.DataFrame(priorities).drop_duplicates(
        subset=["dbn", "program_id", "rank"], keep="first")
    log(f"  {len(programs):,} programs across {programs['dbn'].nunique():,} schools, "
        f"{len(priorities):,} priority rows")
    return programs, priorities


# ---- Sources ---------------------------------------------------------------

def build_sources(observations, schools, programs, fetch_manifest):
    """The Sources and Coverage table, with counts measured from the data."""
    fetched = {r["source_id"]: r for r in fetch_manifest["sources"]}
    rows = []
    for key, source in cfg.SOURCES.items():
        record = {
            "source_id": source["source_id"],
            "agency": source["agency"],
            "title": source["title"],
            "dataset_id": source["dataset_id"],
            "url": source["page"],
            "download_url": source["url"],
            "retrieval": source["retrieval"],
            "cadence": source["cadence"],
            "grain": source["grain"],
            "limitations": source["limitations"],
            "retrieved": fetched.get(key, {}).get("retrieved"),
            "bytes": fetched.get(key, {}).get("bytes"),
        }
        subset = observations[observations["source_id"] == source["source_id"]]
        if len(subset):
            record["rows"] = int(len(subset))
            record["schools"] = int(subset["dbn"].nunique())
            record["latest_period"] = str(subset["school_year"].max())
            record["earliest_period"] = str(subset["school_year"].min())
        elif key.startswith("directory"):
            subset = programs[programs["source_id"] == key]
            record["rows"] = int(len(subset))
            record["schools"] = int(subset["dbn"].nunique()) if len(subset) else 0
            record["latest_period"] = "Fall 2025"
            record["earliest_period"] = "Fall 2025"
        elif key == "geosearch":
            record["rows"] = int(schools["coordinate_source"].eq("geocoded").sum())
            record["schools"] = record["rows"]
            record["latest_period"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            record["earliest_period"] = record["latest_period"]
        rows.append(record)
    return pd.DataFrame(rows)


# ---- Entry point -----------------------------------------------------------

def main():
    fetch_manifest = json.loads((cfg.BUILD / "fetch-manifest.json").read_text())

    sqr = read_sqr()
    demo = read_demographics()
    log("reading the directories")
    directories = {k: read_directory(k)
                   for k in ("directory_es", "directory_ms", "directory_hs")}

    schools = build_schools(sqr, demo, directories)
    schools = add_coordinates(schools, directories)

    metrics = build_metrics(sqr)
    metrics = pd.concat([metrics, demographic_metrics_frame()], ignore_index=True)
    metrics["category_rank"] = metrics["category"].map(
        lambda c: cfg.CATEGORY_ORDER.index(c) if c in cfg.CATEGORY_ORDER else 99)
    metrics = metrics.sort_values(["category_rank", "metric_id"]).reset_index(drop=True)

    observations = build_observations(sqr, demo)
    programs, priorities = build_programs(directories)
    sources = build_sources(observations, schools, programs, fetch_manifest)

    for name, frame in [("schools", schools), ("metrics", metrics),
                        ("observations", observations), ("programs", programs),
                        ("program_priorities", priorities), ("sources", sources)]:
        path = cfg.BUILD / f"{name}.csv"
        frame.to_csv(path, index=False)
        log(f"wrote {path.relative_to(cfg.ROOT)}: {len(frame):,} rows")

    return {"schools": schools, "metrics": metrics, "observations": observations,
            "programs": programs, "program_priorities": priorities, "sources": sources}


if __name__ == "__main__":
    main()
