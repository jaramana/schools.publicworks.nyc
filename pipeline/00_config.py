"""schoolsfinder.nyc: configuration.

Every tunable path, source identifier, threshold, and display rule lives here.
Nothing downstream should hard-code a URL, a cutoff, or a label.
"""

from pathlib import Path

# ---- Paths -----------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent

RAW = ROOT / "data-raw"          # cached downloads, not committed
BUILD = ROOT / "build"           # normalized tables between stages, not committed
STAGING = ROOT / "build" / "staging"   # candidate outputs, validated before publishing
DOCS = ROOT / "docs"             # the published site
SITE_DATA = DOCS / "data"
SITE_SCHOOLS = SITE_DATA / "schools"
DOWNLOADS = DOCS / "downloads"

for _d in (RAW, BUILD, STAGING):
    _d.mkdir(parents=True, exist_ok=True)


# ---- Sources ---------------------------------------------------------------
# Each entry carries what the Sources and Coverage sheet has to publish.
# `url` is what the pipeline fetches. `page` is where a person should look.

SOCRATA_DOMAIN = "data.cityofnewyork.us"
INFOHUB_DOCS = "https://infohub.nyced.org/docs/default-source/default-document-library"

SOURCES = {
    "sqr": {
        "source_id": "sqr",
        "agency": "NYC Public Schools",
        "title": "School Quality Reports Data",
        "dataset_id": "dnpx-dfnc",
        "url": f"https://{SOCRATA_DOMAIN}/api/views/dnpx-dfnc/rows.csv?accessType=DOWNLOAD",
        "page": f"https://{SOCRATA_DOMAIN}/d/dnpx-dfnc",
        "retrieval": "NYC OpenData CSV export",
        "cadence": "Annual",
        "grain": "One row per DBN, school year, and metric variable.",
        "cache": "sqr.csv",
        # Guards. A run that breaks any of these fails rather than publishes.
        "min_rows": 1_200_000,
        "min_dbns": 1_800,
        "required_columns": [
            "school_year", "report_year", "dbn", "school_name", "report_type",
            "school_type", "metric_variable_name", "metric_display_name",
            "number_of_students", "metric_value", "comparison_group_average",
            "metric_score",
        ],
        "limitations": (
            "Coverage depends on report type. Row counts for the 2019 and 2020 school "
            "years are much lower because state testing and some reporting were "
            "suspended. A few metric variables were renamed between the 2017 and 2018 "
            "school years and are not comparable across that boundary."
        ),
    },
    "demographics": {
        "source_id": "demographics",
        "agency": "NYC Public Schools",
        "title": "Demographic Snapshot, school level",
        "dataset_id": "demographic-snapshot-2020-21-to-2024-25-public",
        "url": f"{INFOHUB_DOCS}/demographic-snapshot-2020-21-to-2024-25-public.xlsx",
        "page": "https://infohub.nyced.org/reports/school-quality/information-and-data-overview",
        "retrieval": "InfoHub Excel workbook",
        "cadence": "Annual",
        "grain": "One row per DBN and school year.",
        "cache": "demographics.xlsx",
        # The workbook also holds citywide, borough, and district sheets. Only
        # the school sheet is at the grain this project publishes.
        "sheet": "School",
        "min_rows": 9_000,
        "min_dbns": 1_800,
        "required_columns": ["DBN", "Year", "Total Enrollment"],
        "limitations": (
            "Covers the 2020-21 school year onward only. The category for students who "
            "are neither female nor male was not reported in the earliest years, so an "
            "absent value there means not reported rather than none."
        ),
    },
    # Directory files. The InfoHub file names carry a content hash that changes
    # whenever the office republishes, so these need checking each admissions
    # season. `01_fetch.py` reports a clear error rather than a silent 404.
    "directory_es": {
        "source_id": "directory_es",
        "agency": "NYC Public Schools, Office of Student Enrollment",
        "title": "Elementary School Directory Data, Fall 2025",
        "dataset_id": "fall-2025-es-directory-data",
        "url": f"{INFOHUB_DOCS}/ose/fall-2025---es-directory-dataa1d9858e-15ab-4626-ab0d-928d94c0d722.xlsx",
        "page": "https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data",
        "retrieval": "InfoHub Excel workbook",
        "cadence": "Annual, before each admissions season",
        "grain": "One row per school and entry point. Includes early childhood centers.",
        "cache": "directory_es.xlsx",
        "sheet": "Sheet1",
        "dbn_column": "schooldbn",
        "min_rows": 3_000,
        "programs": 7,
        "limitations": (
            "Includes 3-K and Pre-K early childhood centers whose location codes are not "
            "school DBNs. A school can appear more than once, once per entry point."
        ),
    },
    "directory_ms": {
        "source_id": "directory_ms",
        "agency": "NYC Public Schools, Office of Student Enrollment",
        "title": "Middle School Directory Data, Fall 2025",
        "dataset_id": "fall-2025-middle-school-data",
        "url": f"{INFOHUB_DOCS}/ose/fall-2025-middle-school-data.xlsx",
        "page": "https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data",
        "retrieval": "InfoHub Excel workbook",
        "cadence": "Annual, before each admissions season",
        "grain": "One row per school.",
        "cache": "directory_ms.xlsx",
        "sheet": "Data",
        "dbn_column": "schooldbn",
        "min_rows": 400,
        "programs": 14,
        "limitations": "Covers schools admitting for grade 6 in the Fall 2025 season only.",
    },
    "directory_hs": {
        "source_id": "directory_hs",
        "agency": "NYC Public Schools, Office of Student Enrollment",
        "title": "High School Directory Data, Fall 2025",
        "dataset_id": "fall-2025-hs-directory-data",
        "url": f"{INFOHUB_DOCS}/ose/fall-2025---hs-directory-datab85f64a0-05b9-439a-8e29-052ce60a5d86.xlsx",
        "page": "https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data",
        "retrieval": "InfoHub Excel workbook",
        "cadence": "Annual, before each admissions season",
        "grain": "One row per school.",
        "cache": "directory_hs.xlsx",
        "sheet": "Data",
        "dbn_column": "dbn",
        "min_rows": 400,
        "programs": 11,
        "limitations": (
            "Covers schools admitting for grade 9 in the Fall 2025 season only. A full "
            "stop in a numeric field is the file's own marker for no value."
        ),
    },
    "geosearch": {
        "source_id": "geosearch",
        "agency": "NYC Department of City Planning",
        "title": "GeoSearch address geocoder",
        "dataset_id": "geosearch-v2",
        "url": "https://geosearch.planninglabs.nyc/v2/search",
        "page": "https://geosearch.planninglabs.nyc/",
        "retrieval": "HTTP request per distinct address, cached on disk",
        "cadence": "Continuous",
        "grain": "One coordinate pair per address.",
        "cache": "geocode.json",
        "limitations": (
            "Coordinates are matched from the published street address, so they are a "
            "derived value rather than a value the Department of Education publishes. "
            "An address that fails to match has no coordinate rather than a guess."
        ),
    },
}

# High school addresses arrive with coordinates already embedded in a text
# field, so those schools never reach the geocoder.
HS_LOCATION_COORDS = r"\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)"

# The geocoder answers in about three seconds per address, so the work is
# spread over a few connections. Keep this small: it is a free public service.
GEOCODE_WORKERS = 6
GEOCODE_SAVE_EVERY = 100       # write the cache this often, so a stop keeps its work
GEOCODE_TIMEOUT = 30
HTTP_TIMEOUT = 300
HTTP_RETRIES = 3


# ---- Reference data --------------------------------------------------------

# The third character of a DBN is the borough. This is a property of the
# identifier itself, so it never depends on a lookup file being current.
BOROUGH_BY_CODE = {
    "M": "Manhattan",
    "X": "Bronx",
    "K": "Brooklyn",
    "Q": "Queens",
    "R": "Staten Island",
}

# Report types in the School Quality Reports, and what each one covers.
REPORT_TYPES = {
    "EMS": "Elementary, middle, and K-8 schools",
    "HS": "High schools",
    "HST": "High school transfer schools",
    "EC": "Early childhood schools, kindergarten through grade 1, 2, or 3",
    "D75": "District 75 schools, which serve students with significant disabilities",
    "YABC": "Young Adult Borough Centers",
}

# Districts that are citywide rather than geographic.
SPECIAL_DISTRICTS = {
    "75": "District 75, citywide special education",
    "79": "District 79, alternative schools and programs",
    "84": "Charter schools",
}


# ---- Metric handling -------------------------------------------------------

# Categories are assigned by matching a variable name against these patterns in
# order. First match wins, so the specific patterns come before the general.
METRIC_CATEGORIES = [
    (r"^(attendance|chronic_absent|interaction|attend_increase)", "attendance", "Attendance"),
    # The alternate assessment is taken by students with significant
    # disabilities and is not the same test as the state exams, so it is not
    # filed under them.
    (r"^(nysaa|prof_nysaa|ord_)", "alt_assessments", "Alternate assessments"),
    # Growth is measured between two grades and must be matched before the
    # plain test-result patterns, which would otherwise claim it.
    (r"^(prof_pct_watn|prof_2plus_watn|pctl_med|growth)", "growth", "Student growth"),
    (r"^(prof_pct|rating_mean|prof_2plus)", "state_tests", "State test results"),
    # Every mean_score_ variable that is not a college admissions test is a
    # Regents subject score.
    (r"^(regents|met_reg|pct_regents)", "regents", "Regents examinations"),
    (r"^mean_score_(sat|act|cat)", "college", "College and career readiness"),
    (r"^mean_score_", "regents", "Regents examinations"),
    (r"^(pct_core|pct_accel|pct_accelerated|ele_core|hs_9gr_credits|credit_)", "coursework", "Course work and credits"),
    (r"^(grad_|diploma|dropout|nondropout|pct_degree|hs_4yr|hs_6yr|hs_5yr)", "graduation", "Graduation and diplomas"),
    (r"^(ccr|nocat_cri|cri6|pct_cri|pct_cer|pct_clg|pct_college|pct_cpci|persist3|college|postsec|cuny|mean_score_sat|mean_score_act|mean_score_cat|cohort_pct)", "college", "College and career readiness"),
    (r"^(survey|framework|env_|rigorous|collab|leader|family|trust|safety|supportive)", "climate", "School climate and surveys"),
    (r"^(lre|nyseslat|move_to|ell|swd|iep)", "student_support", "Student support"),
    (r"^(enroll|demo_)", "demographics", "Enrollment and demographics"),
]
METRIC_CATEGORY_FALLBACK = ("other", "Other published measures")

# The order categories appear in a school profile.
CATEGORY_ORDER = [
    "demographics", "attendance", "state_tests", "alt_assessments", "regents",
    "growth", "coursework", "graduation", "college", "climate",
    "student_support", "other",
]

# Display formats. `pct_unit` means a proportion stored as 0 to 1 and shown as a
# percentage. Inference rules are in 02_normalize.py and every metric records
# whether its format was declared here or inferred from the values.
FORMAT_OVERRIDES = {
    r"^rating_mean": "scale",        # 1.00 to 4.50 proficiency scale, not a percentage
    r"^pctl_med": "percentile",
    r"^mean_score_": "number",       # SAT, ACT, CUNY and Regents point scores
    r"^credit_mean": "number",       # a count of credits, not a rate
    r"^attendance": "pct_unit",
    r"^attend_increase": "pct_unit",
    r"^chronic_absent": "pct_unit",
    r"^interaction": "pct_unit",
    r"^prof_pct": "pct_unit",
    r"^prof_2plus": "pct_unit",
    r"^pct_": "pct_unit",
    r"^cohort_pct": "pct_unit",
    r"^grad_pct": "pct_unit",
    r"^credit_\d+_pct": "pct_unit",
    r"^nondropout": "pct_unit",
    r"^met_reg_compl": "pct_unit",
    r"^nysaa": "pct_unit",
    r"^move_to": "pct_unit",
    r"^lre": "pct_unit",
    r"^nyseslat": "pct_unit",
    r"^ele_core": "pct_unit",
    r"^hs_9gr": "pct_unit",
}

# Display formats and how each one is written out. `pct_unit` is a proportion
# stored as 0 to 1. `index_100` is an index already expressed out of 100 and is
# never multiplied again.
FORMATS = {
    "pct_unit": {"label": "Percentage", "unit": "proportion of students, 0 to 1"},
    "scale": {"label": "Proficiency scale", "unit": "scale score, about 1.0 to 4.5"},
    "percentile": {"label": "Percentile", "unit": "percentile, 0 to 100"},
    "index_100": {"label": "Index", "unit": "index, 0 to 100"},
    "number": {"label": "Number", "unit": "points or count, as published"},
    "count": {"label": "Count", "unit": "number of students"},
}

# Metrics carried into the Excel workbook's Historical Metrics sheet, and
# offered as the headline row on a profile. Excel cannot hold the full history:
# the complete observation table is over a million rows, which is past the
# format's limit, so the workbook carries these across all years and the CSV
# download carries everything.
HEADLINE_METRICS = [
    "demo_enrollment_total",
    "demo_pct_poverty",
    "demo_economic_need_index",
    "demo_pct_swd",
    "demo_pct_ell",
    "attendance_k8_all",
    "attendance_hs_all",
    "chronic_absent_ems_all",
    "chronic_absent_hs_all",
    "prof_pct_ela_all",
    "prof_pct_mth_all",
    "rating_mean_ela_all",
    "rating_mean_mth_all",
    "lre_all",
    "nyseslat_all",
]

# Variable pairs that look continuous but are not. Published as separate
# metrics with an explicit note rather than stitched into one series.
COMPARABILITY_BREAKS = {
    "rating_mean_ela_low_city": "Replaced by rating_mean_ela_low_c35 from the 2018 school year. The two are not comparable.",
    "rating_mean_mth_low_city": "Replaced by rating_mean_mth_low_c35 from the 2018 school year. The two are not comparable.",
    "rating_mean_ela_low_sch": "Replaced by rating_mean_ela_low_s35 from the 2018 school year. The two are not comparable.",
    "rating_mean_mth_low_sch": "Replaced by rating_mean_mth_low_s35 from the 2018 school year. The two are not comparable.",
    "rating_mean_ela_ymocl3": "Replaced by rating_mean_ela_ymocl35 from the 2018 school year. The two are not comparable.",
    "rating_mean_mth_ymocl3": "Replaced by rating_mean_mth_ymocl35 from the 2018 school year. The two are not comparable.",
}

# School years affected by the pandemic. Shown with a warning wherever a trend
# crosses them.
DISRUPTED_YEARS = ["2019", "2020"]
DISRUPTION_NOTE = (
    "State testing was canceled in the 2019-20 school year and participation was "
    "unusually low in 2020-21. Values around those years are not comparable with the "
    "rest of the series."
)


# ---- Student groups --------------------------------------------------------
# The source writes a student group at the end of a measure's display name,
# after a dash: "Percentage of Students at Level 3 or 4, ELA - Asian". Reading
# the group off the label is more reliable than decoding the variable name, and
# it keeps the Department of Education's own wording rather than substituting
# our own.
#
# Groups are themed so a profile can present them in a stated order instead of
# an arbitrary one. Within a theme the site sorts alphabetically: any other
# order within a race or ethnicity list is a judgment nobody asked for.

SUBGROUP_THEMES = [
    # (theme key, theme label, [group names exactly as the source writes them])
    ("all", "All students", [
        "All Students",
    ]),
    ("race", "Race and ethnicity", [
        "Asian", "Asian and Pacific Islander", "Black", "Hispanic",
        "Hispanic or Latinx", "Multiracial", "Multi-Racial",
        "Native American", "Native American or American Indian",
        "Native Hawaiian or Pacific Islander", "Native Hawiian or Pacific Islander",
        "White",
    ]),
    ("gender", "Gender", [
        "Female", "Male", "Neither Female nor Male",
    ]),
    ("groups", "Student groups", [
        "English Language Learners", "Students with Disabilities",
        "Students with Disabilites",     # the source's own spelling in some labels
    ]),
    ("setting", "Service setting", [
        "Integrated Co-Teaching", "Integrated Co-Teaching and SETSS",
        "Self-Contained", "SETSS",
    ]),
    ("achievement", "Prior achievement", [
        "Black or Hispanic Males in Lowest Third Citywide",
        "Lowest Third Citywide", "School's Lowest Third",
    ]),
    # Grades are read off a comma rather than a dash, so this theme has no
    # names to match. It is here so the label exists for the page.
    ("grade", "By grade", []),
]

# The order themes appear under a measure.
SUBGROUP_THEME_ORDER = ["all", "race", "gender", "groups", "setting", "achievement", "grade"]


# ---- Reading a value -------------------------------------------------------

# The published maximum of the state proficiency scale. Shown next to a value so
# "3.35" reads as "3.35 of 4.5" without anyone having to open a definition.
# 03_validate.py fails the build if a published value exceeds it.
SCALE_MAX = 4.5
INDEX_MAX = 100

# The City scores some measures from 1 to 5 against a comparison group of
# schools it considers similar. Where it does, the site bands that score for
# color. The bands are this project's grouping of the City's number, and the
# number itself is always shown next to the band so the reader can see what it
# was derived from. Where the City publishes no score, nothing is colored.
SCORE_BANDS = [
    (4.0, "high", "Among the strongest of its comparison group"),
    (3.0, "above", "Above the middle of its comparison group"),
    (2.0, "below", "Below the middle of its comparison group"),
    (0.0, "low", "Among the weakest of its comparison group"),
]

# A handful of measures count something you want less of, so a value above the
# comparison group average is not the better outcome. Checked before any
# direction is shown.
LOWER_IS_BETTER = [
    r"^nysaa_(ela|mth)_1",     # alternate assessment, percent at the lowest level
    r"^nysaa_(ela|mth)_2",
]


# ---- Demographic metrics ---------------------------------------------------
# The snapshot arrives as a wide table. This maps its columns onto the same
# metric and observation model the quality reports use, so the site has one
# way to display a number and one way to describe it.

# Labels are the Department of Education's own wording, taken from the column
# headings of the snapshot. Rewording them would mean substituting this
# project's judgment for the source's, and the terms are the ones a reader will
# meet again in every other City document.
#
# Each row is (metric_id, source column, label, format, theme). The theme
# decides the order on a profile: themes in the order below, then alphabetical
# within a theme.
DEMOGRAPHIC_METRICS = [
    ("demo_enrollment_total", "Total Enrollment", "Total Enrollment", "count", "enrollment"),

    ("demo_pct_asian", "% Asian and Pacific Islander", "Asian and Pacific Islander", "pct_unit", "race"),
    ("demo_pct_black", "% Black", "Black", "pct_unit", "race"),
    ("demo_pct_hispanic", "% Hispanic", "Hispanic", "pct_unit", "race"),
    ("demo_pct_race_missing", "% Missing Race/Ethnicity Data", "Missing Race/Ethnicity Data", "pct_unit", "race"),
    ("demo_pct_multiracial", "% Multi-Racial", "Multi-Racial", "pct_unit", "race"),
    ("demo_pct_native_american", "% Native American", "Native American", "pct_unit", "race"),
    ("demo_pct_white", "% White", "White", "pct_unit", "race"),

    ("demo_pct_female", "% Female", "Female", "pct_unit", "gender"),
    ("demo_pct_male", "% Male", "Male", "pct_unit", "gender"),
    ("demo_pct_other_sex", "% Neither Female nor Male", "Neither Female nor Male", "pct_unit", "gender"),

    ("demo_economic_need_index", "Economic Need Index", "Economic Need Index", "pct_unit", "economic"),
    ("demo_pct_poverty", "% Poverty", "Poverty", "pct_unit", "economic"),

    ("demo_pct_ell", "% English Language Learners", "English Language Learners", "pct_unit", "english"),

    ("demo_pct_swd", "% Students with Disabilities", "Students with Disabilities", "pct_unit", "disability"),
]

# The order those themes appear, and what each is called on screen.
DEMOGRAPHIC_THEMES = [
    ("enrollment", "Enrollment"),
    ("race", "Race and ethnicity"),
    ("gender", "Gender"),
    ("economic", "Economic need"),
    ("english", "English language learners"),
    ("disability", "Students with disabilities"),
]

# Grade columns in the snapshot, in the order a school serves them.
GRADE_COLUMNS = [
    ("3K", "Grade 3K"),
    ("PK", "Grade PK (Half Day & Full Day)"),
    ("K", "Grade K"),
    ("1", "Grade 1"), ("2", "Grade 2"), ("3", "Grade 3"), ("4", "Grade 4"),
    ("5", "Grade 5"), ("6", "Grade 6"), ("7", "Grade 7"), ("8", "Grade 8"),
    ("9", "Grade 9"), ("10", "Grade 10"), ("11", "Grade 11"), ("12", "Grade 12"),
]


# ---- Directory field maps --------------------------------------------------
# The three directory workbooks describe the same things with different column
# names. Everything downstream reads the canonical name on the left.

DIRECTORY_IDENTITY = {
    "directory_es": {
        "name": "name", "address": "address", "grades": "gradespan",
        "district": "district", "enrollment": "totalstudents",
        "accessibility": "accessibility", "website": "independentwebsite",
        "directory_url": "url", "phone": "telephone", "overview": "overview",
        "start_time": "start_time", "end_time": "end_time",
        "languages": "languageclasses", "subway": "subway", "bus": "bus",
        "shared_building": "sharedbuilding",
    },
    "directory_ms": {
        "name": "name", "address": "address", "grades": "gradespan",
        "district": "district", "enrollment": "totalstudents",
        "accessibility": "accessibility", "website": "independentwebsite",
        "directory_url": "url", "phone": "telephone", "overview": "overview",
        "start_time": "start_time", "end_time": "end_time",
        "languages": "languageclasses", "subway": "subway", "bus": "bus",
        "shared_building": "sharedbuilding", "neighborhood": "neighborhood",
        "ell_programs": "ellprograms", "accelerated": "acceleratedclasses",
    },
    "directory_hs": {
        "name": "school_name", "address": "primary_address_line_1",
        "grades": "gradespan", "enrollment": "total_students",
        "accessibility": "school_accessibility_description",
        "website": "website", "directory_url": "url", "phone": "phone_number",
        "overview": "overview_paragraph", "start_time": "start_time",
        "end_time": "end_time", "languages": "language_classes",
        "subway": "subway", "bus": "bus", "shared_building": "shared_space",
        "neighborhood": "neighborhood", "ell_programs": "ell_programs",
        "zip": "zip", "campus": "campus_name", "building": "building_code",
        "location": "location", "specialized": "specialized",
    },
}

# Program blocks. `count` is how many program slots the file carries, and the
# templates use {i} for the program number and {k} for the priority rank.
DIRECTORY_PROGRAMS = {
    "directory_es": {
        "count": 7, "priorities": 14, "audience": ["ge"],
        "code": "code_prog{i}", "name": "name_prog{i}",
        "method": "admissionsmethod_prog{i}", "eligibility": None,
        "description": None, "priority": "priority{k}_prog{i}",
        "seats": {"ge": "geseats_prog{i}"},
        "applicants": {"ge": "geapps_prog{i}"},
        "per_seat": {"ge": "geappsperseat_prog{i}"},
        "filled": {"ge": "gefilled_prog{i}"},
    },
    "directory_ms": {
        "count": 14, "priorities": 6, "audience": ["ge", "swd"],
        "code": "code_prog{i}", "name": "name_prog{i}",
        "method": "admissionsmethod_prog{i}", "eligibility": "eligibility_prog{i}",
        "description": None, "priority": "priority{k}_prog{i}",
        "seats": {"ge": "geseats_prog{i}", "swd": "swdseats_prog{i}"},
        "applicants": {"ge": "geapps_prog{i}", "swd": "swdapps_prog{i}"},
        "per_seat": {"ge": "geappsperseat_prog{i}", "swd": "swdappsperseat_prog{i}"},
        "filled": {"ge": "gefilled_prog{i}", "swd": "swdfilled_prog{i}"},
    },
    "directory_hs": {
        "count": 11, "priorities": 3, "audience": ["ge", "swd"],
        "code": "code{i}", "name": "program{i}",
        "method": "method{i}", "eligibility": "eligibility{i}",
        "description": "prgdesc{i}", "priority": "priority{k}_prog{i}",
        "seats": {"ge": "seats9ge{i}", "swd": "seats9swd{i}"},
        "applicants": {"ge": "grade9geapplicants{i}", "swd": "grade9swdapplicants{i}"},
        "per_seat": {"ge": "grade9geapplicantsperseat{i}", "swd": "grade9swdapplicantsperseat{i}"},
        "filled": {"ge": "grade9gefilledflag{i}", "swd": "grade9swdfilledflag{i}"},
    },
}

# A DBN is two district digits, a borough letter, and three school digits. The
# elementary directory mixes in early childhood center codes that do not match.
DBN_PATTERN = r"^\d{2}[MXKQR]\d{3}$"

# A school enters the site's universe by appearing in a source the Department of
# Education publishes about schools it runs. The directories are used to enrich
# a school that is already in the universe, never to admit one, because they
# list early childhood centers and season-specific programs as well.
UNIVERSE_SOURCES = ["sqr", "demographics"]


# ---- Missing data ----------------------------------------------------------
# Status codes published alongside every value. Missing is not zero, suppressed
# is not zero, and not applicable is not missing.

STATUS_OK = "ok"
STATUS_MISSING = "missing"            # the school should report this and did not
STATUS_SUPPRESSED = "suppressed"      # withheld to protect a small group
STATUS_NOT_APPLICABLE = "not_applicable"   # the metric does not apply to this school type

STATUS_LABELS = {
    STATUS_OK: "Reported",
    STATUS_MISSING: "Not reported",
    STATUS_SUPPRESSED: "Withheld, too few students",
    STATUS_NOT_APPLICABLE: "Does not apply to this school",
}

# A source value that arrives as one of these is a marker, never a number.
NULL_MARKERS = {"", ".", "na", "n/a", "s", "#", "null", "none", "-", "—"}

# Small-group suppression floor used when the source does not state one.
SMALL_GROUP_FLOOR = 5


# ---- Validation thresholds -------------------------------------------------

VALIDATION = {
    # A published table may not lose more than this share of its rows against
    # the previous published build.
    "max_row_shrinkage": 0.05,
    # Nor more than this share of its schools.
    "max_school_loss": 0.02,
    # A profile with fewer reported values than this is reported as thin, not
    # as a failure. Some school types genuinely publish very little.
    "thin_profile_values": 5,
    # Every school in the search index must resolve to a profile file.
    "require_profile_for_every_school": True,
}

# Freshness. Measured against the newest data period inside each source, never
# against the date the workflow ran.
STALENESS_DAYS = {
    "sqr": 500,            # annual release, so a year and a half is late
    "demographics": 500,
    "directory_es": 500,
    "directory_ms": 500,
    "directory_hs": 500,
}


# ---- Site output -----------------------------------------------------------

SITE = {
    "name": "schoolsfinder.nyc",
    "tagline": "New York City public school statistics, in one place",
    "repo": "https://github.com/jaramana/schoolsfinder.nyc",
    "search_index_fields": ["dbn", "name", "boro", "district", "type", "grades"],
    # Profiles are written one file per DBN so a page loads only what it shows.
    "school_file": "schools/{dbn}.json",
    "downloads": {
        "xlsx": "schoolsfinder-data.xlsx",
        "zip": "schoolsfinder-csv.zip",
    },
    # A shortlist, not a pair. Twelve is where a family's real list tends to
    # land, and the comparison view is built as rows of schools so it stays
    # readable at that size.
    "max_compare": 12,
    # A profile file carries values and suppression markers. A row the source
    # published blank with no group size adds nothing a reader can use, and the
    # site already knows from the metric manifest which metrics a school type
    # should report, so it can say "not reported" without being told. The
    # downloads still carry every row.
    "site_statuses": [STATUS_OK, STATUS_SUPPRESSED],
}
