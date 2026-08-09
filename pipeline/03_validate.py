"""Stage 3: check the tables before anything is published.

A check either fails the build or records a warning. The split matters: a
duplicated key or a lost school is a defect, while a school type that publishes
very little is just how the data is. Silent staleness and silent shrinkage are
release failures, so both are checked here rather than noticed later.
"""

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

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


def check_freshness(tables, report):
    """Freshness comes from the data period, never from the day the job ran."""
    obs = tables["observations"]
    periods = {}
    for source_id, subset in obs.groupby("source_id"):
        periods[source_id] = str(subset["school_year"].max())
    report.fact("latest_periods", periods)

    newest = periods.get("sqr")
    if newest:
        # The school year label is "2024-25", and a year's report is published
        # in the autumn after it ends. Before September the newest report that
        # can exist covers the year that ended fifteen months ago.
        now = datetime.now(timezone.utc)
        expected = now.year - 1 if now.month >= 9 else now.year - 2
        start = int(str(newest)[:4])
        behind = expected - start
        if behind >= 2:
            report.fail("freshness.sqr",
                        f"the newest quality report period is {newest}, "
                        f"{behind} releases behind the expected {expected}-"
                        f"{str(expected + 1)[-2:]}")
        elif behind == 1:
            report.warn("freshness.sqr",
                        f"the newest quality report period is {newest}, "
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

    # A metric that disappears takes a profile section with it.
    was_metrics = set(previous.get("metric_ids", []))
    if was_metrics:
        lost = was_metrics - set(tables["metrics"]["metric_id"])
        if lost:
            report.fail("regression.metrics",
                        f"{len(lost)} published metrics are gone, "
                        f"for example {sorted(lost)[:5]}")


def main():
    report = Report()
    tables = load_tables()

    check_keys(tables, report)
    check_references(tables, report)
    check_missing_data_rules(tables, report)
    check_coverage(tables, report)
    check_freshness(tables, report)
    check_against_published(tables, report)

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
