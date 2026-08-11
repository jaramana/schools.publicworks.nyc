"""Stage 4: write the site's JSON and the public downloads.

Everything here comes from the same validated tables, so the website, the
workbook, and the CSV archive cannot disagree. Outputs are written to a staging
directory first and moved into place only once the whole set exists, which keeps
a half-written build from ever being served.
"""

import importlib
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
cfg = importlib.import_module("00_config")


FLOAT_PLACES = 4


def log(message):
    print(f"[export] {message}", flush=True)


def clean(value):
    """JSON-safe scalar: pandas nulls become null, numbers stay numbers.

    Floats are rounded. The sources publish proportions at float64 precision,
    so a value arrives as 0.4670855700969696 when four decimals is already finer
    than the measurement. Carrying the rest cost about a tenth of the published
    bytes and told a reader nothing.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, float):
        return round(value, FLOAT_PLACES)
    return value


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Separators without spaces: these files are read by a browser, not a person,
    # and the saving over two thousand profiles is real.
    path.write_text(json.dumps(payload, separators=(",", ":"), default=str))


def load_tables():
    numeric = {"observations": ["value", "n", "comparison", "source_score"],
               "schools": ["enrollment", "latitude", "longitude"],
               "programs": ["seats_ge", "seats_swd", "applicants_ge", "applicants_swd",
                            "per_seat_ge", "per_seat_swd"],
               "metrics": ["rows", "reported", "low", "high", "schools",
                           "with_comparison"]}
    tables = {}
    for name in ["schools", "metrics", "observations", "programs",
                 "program_priorities", "sources"]:
        frame = pd.read_csv(cfg.BUILD / f"{name}.csv", dtype=str, low_memory=False)
        for column in numeric.get(name, []):
            if column in frame.columns:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
        tables[name] = frame
    return tables


# ---- Site JSON -------------------------------------------------------------

def score_band(score):
    """Band the City's own 1 to 5 score.

    The score is published by New York City Public Schools against a comparison
    group of schools it considers similar. The banding is this project's, the
    number is theirs, and both are shown together on the page so a reader can
    see what the color was derived from.
    """
    if score is None or pd.isna(score):
        return None
    for floor, band, _meaning in cfg.SCORE_BANDS:
        if score >= floor:
            return band
    return None


def school_record(row):
    """The identity block shown at the top of a profile."""
    fields = [
        "dbn", "name", "boro", "district", "district_label", "report_type",
        "report_types", "school_type", "grades", "status", "enrollment",
        "enrollment_year", "address", "phone", "website", "directory_url",
        "accessibility", "overview", "start_time", "end_time", "languages",
        "subway", "bus", "shared_building", "neighborhood",
        "latitude", "longitude", "coordinate_source", "first_year", "last_year",
    ]
    record = {f: clean(row.get(f)) for f in fields}
    for numeric in ("enrollment", "latitude", "longitude"):
        if record[numeric] is not None:
            record[numeric] = float(record[numeric])
    if record["enrollment"] is not None:
        record["enrollment"] = int(record["enrollment"])
    return record


def build_search_index(schools, staging):
    """A small file, loaded once, that powers search and the browse filters."""
    rows = []
    for _, school in schools.iterrows():
        rows.append({
            "dbn": school["dbn"],
            "name": clean(school["name"]),
            "boro": clean(school["boro"]),
            "district": clean(school["district"]),
            "type": clean(school["school_type"]) or clean(school["report_type"]),
            "grades": clean(school["grades"]),
            "status": clean(school["status"]),
        })
    rows.sort(key=lambda r: (r["name"] or "").upper())
    write_json(staging / "search-index.json", rows)
    size = (staging / "search-index.json").stat().st_size
    log(f"search index: {len(rows):,} schools, {size / 1024:.0f} KB")
    return rows


def build_metrics_json(metrics, staging):
    payload = {}
    for _, metric in metrics.iterrows():
        payload[metric["metric_id"]] = {
            "label": clean(metric["label"]),
            # No pre-composed description here: it was a third of this file for
            # a sentence the browser assembles from the fields below. The full
            # text is still in the data dictionary and the downloads.
            "source_label": clean(metric.get("source_label")),
            "category": clean(metric["category"]),
            "category_label": clean(metric["category_label"]),
            # The base measure and the student group it describes, so a profile
            # can lead with the all-students figure and order the breakdowns.
            "base_id": clean(metric.get("base_id")),
            "base_label": clean(metric.get("base_label")),
            "subgroup": clean(metric.get("subgroup")),
            "theme": clean(metric.get("subgroup_theme")),
            "theme_rank": int(float(metric.get("theme_rank") or 99)),
            "format": clean(metric["format"]),
            "format_source": clean(metric["format_source"]),
            "unit": clean(metric["unit"]),
            "applies_to": (clean(metric["applies_to"]) or "").split("|"),
            "first_year": clean(metric.get("first_year")),
            "last_year": clean(metric.get("last_year")),
            "headline": str(metric.get("headline")).lower() == "true",
            "lower_is_better": str(metric.get("lower_is_better")).lower() == "true",
            "comparability_note": clean(metric.get("comparability_note")),
            "source_id": clean(metric["source_id"]),
        }
    write_json(staging / "metrics.json", payload)
    size = (staging / "metrics.json").stat().st_size
    log(f"metric manifest: {len(payload):,} metrics, {size / 1024:.0f} KB")
    return payload


def build_school_files(schools, observations, programs, priorities, staging):
    """One file per school, holding only what that profile shows."""
    published = observations[observations["status"].isin(cfg.SITE["site_statuses"])]
    by_school = dict(tuple(published.groupby("dbn")))
    programs_by_school = dict(tuple(programs.groupby("dbn"))) if len(programs) else {}
    priorities_by_school = (dict(tuple(priorities.groupby("dbn")))
                            if len(priorities) else {})

    out_dir = staging / "schools"
    out_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0

    for _, school in schools.iterrows():
        dbn = school["dbn"]
        payload = {"school": school_record(school), "series": {}, "programs": []}

        subset = by_school.get(dbn)
        if subset is not None:
            for metric_id, rows in subset.groupby("metric_id"):
                rows = rows.sort_values(["school_year", "report_type"])
                statuses = list(rows["status"])
                series = {
                    "y": list(rows["school_year"]),
                    "v": [clean(v) for v in rows["value"]],
                }
                # Only carry the status array when something in it is not a
                # plain reported value. The client assumes reported when the
                # array is absent, which is most series.
                if any(s != cfg.STATUS_OK for s in statuses):
                    series["st"] = statuses
                # A school with middle and high school grades reports the same
                # metric twice in a year, once per report. Carry the report type
                # so the profile can label the two rather than pick one.
                if rows["report_type"].nunique(dropna=True) > 1:
                    series["rt"] = [clean(v) for v in rows["report_type"]]
                # Only carry the extra columns when the source actually
                # published them, so an empty array never implies a zero.
                if rows["n"].notna().any():
                    series["n"] = [clean(v) for v in rows["n"]]
                # The source's own bound, where it published one instead of a
                # number. Carried so the page can print "Above 95%" rather than
                # claiming the figure was never reported.
                if "bound" in rows.columns and rows["bound"].notna().any():
                    series["bd"] = [clean(v) for v in rows["bound"]]
                if rows["comparison"].notna().any():
                    series["c"] = [clean(v) for v in rows["comparison"]]
                if rows["source_score"].notna().any():
                    series["s"] = [clean(v) for v in rows["source_score"]]
                    # The band is banded here rather than in the browser, so
                    # the thresholds live with the rest of the configuration.
                    series["b"] = [score_band(v) for v in rows["source_score"]]
                payload["series"][metric_id] = series

        school_programs = programs_by_school.get(dbn)
        if school_programs is not None:
            ranks = priorities_by_school.get(dbn)
            for _, program in school_programs.iterrows():
                record = {
                    "id": clean(program["program_id"]),
                    "code": clean(program["program_code"]),
                    "name": clean(program["program_name"]),
                    "level": clean(program["level"]),
                    "method": clean(program["admissions_method"]),
                    "eligibility": clean(program["eligibility"]),
                    "description": clean(program["description"]),
                    "seats_ge": clean(program.get("seats_ge")),
                    "seats_swd": clean(program.get("seats_swd")),
                    "applicants_ge": clean(program.get("applicants_ge")),
                    "applicants_swd": clean(program.get("applicants_swd")),
                    "per_seat_ge": clean(program.get("per_seat_ge")),
                    "per_seat_swd": clean(program.get("per_seat_swd")),
                    "source_id": clean(program["source_id"]),
                    "priorities": [],
                }
                if ranks is not None:
                    mine = ranks[ranks["program_id"] == program["program_id"]]
                    mine = mine.sort_values("rank", key=lambda s: s.astype(int))
                    record["priorities"] = [clean(p) for p in mine["priority"]]
                payload["programs"].append(record)

        path = out_dir / f"{dbn}.json"
        write_json(path, payload)
        total_bytes += path.stat().st_size

    log(f"school profiles: {len(schools):,} files, {total_bytes / 1e6:.1f} MB total, "
        f"{total_bytes / max(len(schools), 1) / 1024:.0f} KB average")


def build_sources_json(sources, staging):
    payload = []
    for _, source in sources.iterrows():
        payload.append({k: clean(v) for k, v in source.items()})
    write_json(staging / "sources.json", payload)
    log(f"sources: {len(payload)} entries")
    return payload


def build_status_json(tables, sources_payload, staging, validation):
    """What the site says about itself: periods, counts, and staleness."""
    observations = tables["observations"]
    now = datetime.now(timezone.utc)

    periods = {}
    for source_id, subset in observations.groupby("source_id"):
        periods[source_id] = str(subset["school_year"].max())
    for key in ("directory_es", "directory_ms", "directory_hs"):
        periods[key] = "Fall 2025"

    stale = []
    for source in sources_payload:
        retrieved = source.get("retrieved")
        if not retrieved:
            continue
        try:
            age = (now.date() - datetime.strptime(retrieved, "%Y-%m-%d").date()).days
        except ValueError:
            continue
        limit = cfg.STALENESS_DAYS.get(source["source_id"])
        if limit and age > limit:
            stale.append({"source_id": source["source_id"], "days": age, "limit": limit})

    payload = {
        "generated": now.strftime("%Y-%m-%d"),
        "periods": periods,
        "counts": {
            "schools": int(len(tables["schools"])),
            "schools_open": int((tables["schools"]["status"] == "open").sum()),
            "metrics": int(len(tables["metrics"])),
            "observations": int(len(observations)),
            "observations_reported": int((observations["status"] == cfg.STATUS_OK).sum()),
            "programs": int(len(tables["programs"])),
        },
        "metric_ids": sorted(tables["metrics"]["metric_id"]),
        "stale_sources": stale,
        # Display constants the browser needs but should not hard-code, so a
        # change in 00_config.py reaches the page without a code edit.
        "display": {
            "scale_max": cfg.SCALE_MAX,
            "index_max": cfg.INDEX_MAX,
            "score_bands": [
                {"from": floor, "band": band, "meaning": meaning}
                for floor, band, meaning in cfg.SCORE_BANDS
            ],
            "themes": {key: label for key, label, _ in cfg.SUBGROUP_THEMES},
            "demographic_themes": dict(cfg.DEMOGRAPHIC_THEMES),
            "category_order": cfg.CATEGORY_ORDER,
            "theme_order": cfg.SUBGROUP_THEME_ORDER,
            "max_compare": cfg.SITE["max_compare"],
        },
        "validation": {
            "passed": validation.get("passed"),
            "warnings": len(validation.get("warnings", [])),
        },
        "downloads": cfg.SITE["downloads"],
    }
    write_json(staging / "status.json", payload)
    log(f"status: {payload['counts']['schools']:,} schools, "
        f"{payload['counts']['observations']:,} observations, "
        f"{len(stale)} stale sources")
    return payload


# ---- Downloads -------------------------------------------------------------

def data_dictionary(tables):
    """Every published field, in one table, for both downloads and the site."""
    rows = []

    school_fields = [
        ("dbn", "District, borough, and school number. The stable identifier for a school.", "text", "All schools"),
        ("name", "School name as the current directory writes it.", "text", "All schools"),
        ("boro", "Borough, read from the third character of the DBN.", "text", "All schools"),
        ("district", "Administrative district, read from the first two characters of the DBN.", "text", "All schools"),
        ("school_type", "School type as the School Quality Reports classify it.", "text", "Schools with a quality report"),
        ("report_type", "Which quality report the school files. Decides which metrics apply.", "text", "Schools with a quality report"),
        ("grades", "Grades served. From the directory where available, otherwise read from the enrollment counts.", "text", "All schools"),
        ("status", "open when the school is in the newest snapshot or a current directory, otherwise former.", "text", "All schools"),
        ("enrollment", "Total students in the most recent demographic snapshot.", "count", "Schools in the snapshot"),
        ("address", "Street address from the current directory.", "text", "Schools in a directory"),
        ("latitude", "Latitude. Published by the source for high schools, matched from the address for other schools.", "degrees", "Schools with an address"),
        ("longitude", "Longitude. Same provenance as latitude.", "degrees", "Schools with an address"),
        ("coordinate_source", "source when the Department of Education published the coordinate, geocoded when this project matched it.", "text", "Schools with a coordinate"),
    ]
    for field, description, unit, applies in school_fields:
        rows.append({"table": "schools", "field": field, "description": description,
                     "unit": unit, "applies_to": applies, "missing_means": "The source did not publish this field for this school."})

    observation_fields = [
        ("dbn", "The school the value belongs to.", "text"),
        ("school_year", "The school year the value describes, such as 2024-25.", "text"),
        ("metric_id", "Which metric. Defined in the metrics table.", "text"),
        ("report_type", "Which quality report the value came from. A school with middle and high school grades reports the same metric in both, for different students. Empty for demographic figures, which are one per school.", "text"),
        ("value", "The published value, in the metric's own unit. Empty means no value, never zero.", "varies"),
        ("n", "Number of students the value is calculated over.", "count"),
        ("comparison", "The source's own comparison group average, where it publishes one.", "varies"),
        ("source_score", "The source's own score for this metric, where it publishes one.", "varies"),
        ("status", "reported, suppressed, censored, or missing. Suppressed means withheld to protect a small group. Censored means the source published a bound instead of a number.", "text"),
        ("bound", "The bound the source published in place of a number, such as \"Above 95%\". Present only where status is censored.", "text"),
        ("source_id", "Which source the row came from.", "text"),
    ]
    for field, description, unit in observation_fields:
        rows.append({"table": "observations", "field": field, "description": description,
                     "unit": unit, "applies_to": "All observations",
                     "missing_means": "Empty means the value was not published. It does not mean zero."})

    for _, metric in tables["metrics"].iterrows():
        note = metric.get("comparability_note")
        description = metric.get("description") or metric.get("label")
        if isinstance(note, str) and note:
            description = f"{description} {note}"
        if metric.get("format_source") == "inferred":
            description = (f"{description} The unit was inferred from the range of "
                           f"published values rather than stated by the source.")
        rows.append({
            "table": "metric",
            "field": metric["metric_id"],
            "description": description,
            "unit": metric["unit"],
            "applies_to": str(metric["applies_to"]).replace("|", ", "),
            "missing_means": "Not published for this school and year.",
        })

    return pd.DataFrame(rows)


def write_workbook(tables, dictionary, staging):
    """The public workbook: five sheets, no ranks, no personal fields."""
    path = staging / cfg.SITE["downloads"]["xlsx"]
    schools = tables["schools"]
    observations = tables["observations"]

    headline = observations[observations["metric_id"].isin(cfg.HEADLINE_METRICS)].copy()
    headline = headline[["dbn", "school_year", "metric_id", "report_type", "value",
                         "n", "comparison", "source_score", "status", "source_id"]]
    headline = headline.rename(columns={"comparison": "comparison_group_average"})

    programs = tables["programs"]
    priorities = tables["program_priorities"]
    if len(priorities):
        joined = (priorities.sort_values("rank", key=lambda s: s.astype(int))
                  .groupby(["dbn", "program_id"])["priority"]
                  .apply(lambda s: " | ".join(s)).rename("priorities").reset_index())
        programs = programs.merge(joined, on=["dbn", "program_id"], how="left")

    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        schools.to_excel(writer, sheet_name="Schools", index=False)
        headline.to_excel(writer, sheet_name="Historical Metrics", index=False)
        programs.to_excel(writer, sheet_name="Programs and Admissions", index=False)
        dictionary.to_excel(writer, sheet_name="Data Dictionary", index=False)
        tables["sources"].to_excel(writer, sheet_name="Sources and Coverage", index=False)

        book = writer.book
        header = book.add_format({"bold": True, "bg_color": "#F2F0EB", "border": 1,
                                  "text_wrap": True, "valign": "top"})
        for name, frame in [("Schools", schools), ("Historical Metrics", headline),
                            ("Programs and Admissions", programs),
                            ("Data Dictionary", dictionary),
                            ("Sources and Coverage", tables["sources"])]:
            sheet = writer.sheets[name]
            sheet.freeze_panes(1, 0)
            sheet.autofilter(0, 0, len(frame), max(len(frame.columns) - 1, 0))
            for index, column in enumerate(frame.columns):
                sheet.write(0, index, column, header)
                width = min(max(12, len(str(column)) + 2), 48)
                sheet.set_column(index, index, width)

    log(f"workbook: {path.name}, {path.stat().st_size / 1e6:.1f} MB, "
        f"{len(headline):,} historical rows")
    if len(headline) > 1_000_000:
        raise RuntimeError(
            "the Historical Metrics sheet is past Excel's row limit. Narrow "
            "HEADLINE_METRICS in 00_config.py.")


CSV_README = """Schools (schools.publicworks.nyc), public data archive
======================================================

Generated {generated} from the sources listed in sources.csv.

Files
-----
schools.csv              One row per DBN. Identity, location, and current attributes.
observations.csv         One row per DBN, school year, and metric. Every published value.
metrics.csv              One row per metric. Definitions, units, and which schools they apply to.
programs.csv             One row per DBN and program, where a directory publishes one.
program_priorities.csv   One row per DBN, program, and priority rank.
sources.csv              Every source, with its period, coverage, and limitations.
data-dictionary.csv      Every field in every file above.

Reading the values
------------------
Join on dbn. Never join on a school name.

An empty value is not a zero. The status column in observations.csv says which
kind of absence it is:

  reported     the source published a value
  suppressed   the source withheld the value to protect a small group
  missing      the source published no value

A metric that does not apply to a school type is absent from these files
entirely rather than present and empty. metrics.csv states which report types
each metric applies to.

Percentages are proportions between 0 and 1 unless metrics.csv says otherwise.

Limits
------
This archive contains no ranking, no score, and no recommendation. Values from
different school years or different metrics are not always comparable; see the
comparability notes in metrics.csv and the methodology page on the site.

Licence and credit
------------------
The underlying data is published by New York City Public Schools and NYC
OpenData. Credit them for the data and Schools (schools.publicworks.nyc) for
the compilation.
"""


def write_csv_archive(tables, dictionary, staging, generated):
    path = staging / cfg.SITE["downloads"]["zip"]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in ["schools", "observations", "metrics", "programs",
                     "program_priorities", "sources"]:
            archive.writestr(f"{name}.csv", tables[name].to_csv(index=False))
        archive.writestr("data-dictionary.csv", dictionary.to_csv(index=False))
        archive.writestr("README.txt", CSV_README.format(generated=generated))
    log(f"csv archive: {path.name}, {path.stat().st_size / 1e6:.1f} MB")


# ---- Publishing ------------------------------------------------------------

def publish(staging):
    """Move the staged build into the served directories in one step."""
    cfg.SITE_DATA.mkdir(parents=True, exist_ok=True)
    cfg.DOWNLOADS.mkdir(parents=True, exist_ok=True)

    # Profiles first, into a fresh directory, so a school that closed and lost
    # its file does not linger as a stale page.
    staged_schools = staging / "schools"
    if staged_schools.exists():
        if cfg.SITE_SCHOOLS.exists():
            shutil.rmtree(cfg.SITE_SCHOOLS)
        shutil.move(str(staged_schools), str(cfg.SITE_SCHOOLS))

    for name in ["search-index.json", "metrics.json", "sources.json", "status.json"]:
        source = staging / name
        if source.exists():
            shutil.move(str(source), str(cfg.SITE_DATA / name))

    # Same rule as the profiles above: a download that is no longer produced
    # should not linger. A renamed file in SITE["downloads"] left its old name
    # sitting in the served directory and in git, undetected, until someone
    # went looking. Anything already in DOWNLOADS that is not one of the
    # current filenames is removed before the new ones are moved in.
    wanted = set(cfg.SITE["downloads"].values())
    for existing in cfg.DOWNLOADS.glob("*"):
        if existing.is_file() and existing.name not in wanted:
            existing.unlink()

    for name in cfg.SITE["downloads"].values():
        source = staging / name
        if source.exists():
            shutil.move(str(source), str(cfg.DOWNLOADS / name))

    log(f"published to {cfg.SITE_DATA.relative_to(cfg.ROOT)} and "
        f"{cfg.DOWNLOADS.relative_to(cfg.ROOT)}")


def main():
    validation_path = cfg.BUILD / "validation.json"
    validation = json.loads(validation_path.read_text()) if validation_path.exists() else {}
    if validation and not validation.get("passed"):
        raise RuntimeError("validation did not pass, so nothing is published")

    staging = cfg.STAGING
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    tables = load_tables()
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    build_search_index(tables["schools"], staging)
    build_metrics_json(tables["metrics"], staging)
    build_school_files(tables["schools"], tables["observations"], tables["programs"],
                       tables["program_priorities"], staging)
    sources_payload = build_sources_json(tables["sources"], staging)
    build_status_json(tables, sources_payload, staging, validation)

    dictionary = data_dictionary(tables)
    write_workbook(tables, dictionary, staging)
    write_csv_archive(tables, dictionary, staging, generated)

    publish(staging)
    return True


if __name__ == "__main__":
    main()
