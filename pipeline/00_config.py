"""Schools Finder (schools.publicworks.nyc): configuration.

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
# A source with "covers_charters": False reports on district-run schools only,
# so its measures read as not applying to a charter school.

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
        "retrieval": "NYC Open Data CSV export",
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
    # Five workbooks a year, one per report type, laid out alike since the
    # 2023-24 reports. `01_fetch.py` reads the newest year's links off `page`
    # and uses `pinned` for any year the page no longer lists.
    "sqr_results": {
        "source_id": "sqr_results",
        "agency": "NYC Public Schools",
        "title": "School Quality Report results",
        "dataset_id": "sqr-results",
        "url": f"{INFOHUB_DOCS}/{{year}}-{{part}}-sqr-results.xlsx",
        "page": "https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources",
        "retrieval": "InfoHub Excel workbooks, one per report type and school year",
        "cadence": "Annual",
        "grain": "One row per DBN in each workbook. Five workbooks a year, one per report type.",
        "cache": "sqr_results/{year}-{part}.xlsx",
        "finder": r"(\d{6})-(ems|hs|hst|d75|ec)-sqr-results[\w-]*\.xlsx",
        "pinned": {
            "202425": f"{INFOHUB_DOCS}/202425-{{part}}-sqr-results.xlsx",
            "202324": f"{INFOHUB_DOCS}/202324-{{part}}-sqr-results.xlsx",
        },
        "years": 2,
        "parts": {"ems": "EMS", "hs": "HS", "hst": "HST", "d75": "D75", "ec": "EC"},
        "sheets": ["Summary", "Scoring"],
        # Floors on schools per workbook in the newest year.
        "min_dbns": {"EMS": 1_200, "HS": 450},
        "limitations": (
            "Covers the 2023-24 and 2024-25 reports. Earlier workbooks use a different "
            "layout. District 75 and early childhood schools get no Impact or "
            "Performance Score and no ratings. Survey averages are City averages for "
            "the school's report type, not its comparison group. A student counts as "
            "receiving all recommended special education programs when the class "
            "schedule matches the IEP."
        ),
    },
    "demographics": {
        "source_id": "demographics",
        "agency": "NYC Public Schools",
        "title": "Demographic Snapshot, school level",
        "dataset_id": "demographic-snapshot-2021-22-to-2025-26-public",
        "url": f"{INFOHUB_DOCS}/demographic-snapshot-2021-22-to-2025-26-public.xlsx",
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
            "Covers the 2021-22 school year onward only. The category for students who "
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
    # A file attachment on Open Data, not a table. The attachment's download
    # address changes with each upload, so `01_fetch.py` looks it up from the
    # dataset's metadata on every run instead of storing it here.
    "school_points": {
        "source_id": "school_points",
        "agency": "NYC Public Schools",
        "title": "School Point Locations",
        "dataset_id": "jfju-ynrr",
        "url": f"https://{SOCRATA_DOMAIN}/api/views/jfju-ynrr.json",
        "page": f"https://{SOCRATA_DOMAIN}/d/jfju-ynrr",
        "attachment": True,
        "retrieval": "NYC Open Data file attachment, a zipped shapefile",
        "cadence": "Irregular",
        "grain": "One point per school, keyed by DBN.",
        "cache": "school_points.zip",
        "min_rows": 1_500,
        "required_columns": ["ATS", "Latitude", "Longitude"],
        "limitations": (
            "A dated snapshot. Schools that opened after the snapshot date are not in "
            "it and fall back to the directory or the geocoder."
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

# Coordinates are taken from the first of these that has the school:
#   points    the Department of Education's school point file
#   source    the high school directory, which embeds a coordinate in the address
#   geocoded  matched from the address by GeoSearch
HS_LOCATION_COORDS = r"\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)"

# A point outside this box is a data error and is dropped. West, south, east, north.
NYC_BOUNDS = (-74.26, 40.49, -73.69, 40.92)

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

# Categories that only the quality report workbooks fill. Their measures carry
# a category in SQR_RESULTS_METRICS rather than matching a pattern above.
EXTRA_CATEGORIES = {
    "ratings": "Quality report ratings",
    "staff": "Staff and leadership",
}

# The order categories appear in a school profile.
CATEGORY_ORDER = [
    "ratings", "demographics", "attendance", "climate", "staff",
    "state_tests", "alt_assessments", "regents", "growth", "coursework",
    "graduation", "college", "student_support", "other",
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
    # The City scales Impact and Performance from 0 to 1 within each school
    # type, then shifts the median to 0.50. The download is not capped at 1.
    "index_unit": {"label": "Index", "unit": "index, 0 to 1 with the median at 0.50; can exceed 1"},
    "rating_score": {"label": "Rating score", "unit": "City score, 1.00 to 4.99"},
    "years": {"label": "Years", "unit": "years"},
    "miles": {"label": "Miles", "unit": "miles"},
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
    "qr_impact",
    "qr_performance",
    "qr_teacher_experience",
    "qr_iep_programs_all",
]

# The At a glance cards on a profile, in order. Each slot lists the metrics
# that can fill it, and the first one the school reports is shown. Total
# enrollment is left out because the facts header already shows it.
GLANCE = [
    ["qr_impact"],
    ["qr_performance"],
    ["chronic_absent_ems_all", "chronic_absent_hs_all", "chronic_absent_all"],
    ["qr_teacher_experience"],
    ["qr_iep_programs_all"],
    ["demo_economic_need_index"],
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
    # Set by SQR_RESULTS_METRICS rather than matched from a label.
    ("respondents", "Survey respondents", []),
    ("iep_delivery", "Programs and services received", []),
]

# The order themes appear under a measure.
SUBGROUP_THEME_ORDER = ["all", "race", "gender", "groups", "setting", "achievement", "grade",
                        "respondents", "iep_delivery"]


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

# The City's words for its three framework ratings. The first digit of the
# 1.00 to 4.99 score sets the word. The site shows both as published and adds
# no band of its own.
RATING_WORDS = {4: "Excellent", 3: "Good", 2: "Fair", 1: "Needs Improvement"}
RATING_RANGE = (1.0, 4.99)

# Impact and Performance can exceed 1 in the download. A value past this is a
# misread column, not a strong school.
INDEX_UNIT_MAX = 1.5

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

# The order those themes appear, and what each is called on screen. The
# housing, recommendations and nearby themes come from the quality report
# workbooks, a year behind the snapshot, so each is its own card.
DEMOGRAPHIC_THEMES = [
    ("enrollment", "Enrollment"),
    ("race", "Race and ethnicity"),
    ("nearby", "Compared with nearby students"),
    ("gender", "Gender"),
    ("economic", "Economic need"),
    ("housing", "Temporary housing and public assistance"),
    ("english", "English language learners"),
    ("disability", "Students with disabilities"),
    ("iep_recs", "Special education recommendations"),
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


# ---- Quality report workbooks ----------------------------------------------
# An allowlist of workbook columns, matched by their exact header. Columns the
# Open Data table already carries, such as attendance, ENI, ELL and IEP
# shares, are left out. Labels are the City's own headers.
#
# Keys on each entry:
#   parts       report types whose workbook must carry the column
#   since       first school year the column exists
#   base        groups metrics into one card on a profile
#   subgroup    the row name inside that card
#   theme       the subgroup theme, or the demographic theme for that category
#   rank        orders cards within a section
#   comparison  Scoring column holding the City average for this school type
#   text        column holding the City's rating word
#   pivot       column of the nearby-students table
#   unit        what the value measures, where the format's default would mislead
#   note        a line printed under the card

ALL_REPORTS = "EMS HS HST D75 EC"
RATED_REPORTS = "EMS HS HST"
NEARBY_REPORTS = "EMS HS HST EC"
COURSE_REPORTS = "HS HST"

QR_RACES = [
    ("asian", "Asian"), ("black", "Black"), ("hispanic", "Hispanic"),
    ("native_american", "Native American"),
    ("pacific", "Native Hawaiian or Pacific Islander"), ("white", "White"),
]


def _qr(metric_id, sheet, column, category, fmt, parts, **extra):
    return {"metric_id": metric_id, "sheet": sheet, "column": column,
            "category": category, "format": fmt, "parts": parts.split(), **extra}


SQR_RESULTS_METRICS = [
    _qr("qr_impact", "Summary", "Impact Score", "ratings", "index_unit", RATED_REPORTS, rank=1),
    _qr("qr_performance", "Summary", "Performance Score", "ratings", "index_unit", RATED_REPORTS, rank=1),
    _qr("qr_rating_instruction", "Scoring", "Instruction and Performance - Score", "ratings",
        "rating_score", RATED_REPORTS, base="Instruction and Performance",
        text="Instruction and Performance - Rating", rank=2),
    _qr("qr_rating_climate", "Scoring", "Safety and School Climate - Score", "ratings",
        "rating_score", RATED_REPORTS, base="Safety and School Climate",
        text="Safety and School Climate - Rating", rank=3),
    _qr("qr_rating_families", "Scoring", "Relationships with Families - Score", "ratings",
        "rating_score", RATED_REPORTS, base="Relationships with Families",
        text="Relationships with Families - Rating", rank=4),

    _qr("qr_principal_years", "Summary", "Years of principal experience at this school",
        "staff", "years", ALL_REPORTS, rank=1),
    _qr("qr_teacher_experience", "Summary", "Percent of teachers with 3 or more years of experience",
        "staff", "pct_unit", ALL_REPORTS, rank=1, unit="share of teachers, 0 to 1"),
    _qr("qr_teacher_attendance", "Summary", "Teacher Attendance Rate", "staff", "pct_unit",
        ALL_REPORTS, rank=1, unit="share of teacher days attended, 0 to 1"),

    _qr("qr_pct_temp_housing", "Summary", "Percent in Temp Housing", "demographics", "pct_unit",
        ALL_REPORTS, theme="housing"),
    _qr("qr_pct_hra", "Summary", "Percent HRA Eligible", "demographics", "pct_unit",
        ALL_REPORTS, theme="housing"),
    _qr("qr_rec_setss", "Summary",
        "Percentage of students recommended for general ed settings with Special Ed Teacher "
        "Support Services (SETSS)", "demographics", "pct_unit", ALL_REPORTS, theme="iep_recs"),
    _qr("qr_rec_ict", "Summary",
        "Percentage of students recommended for Integrated Co-Teaching (ICT) services",
        "demographics", "pct_unit", ALL_REPORTS, theme="iep_recs"),
    _qr("qr_rec_sc", "Summary",
        "Percentage of students recommended for Special Class (SC) services",
        "demographics", "pct_unit", ALL_REPORTS, theme="iep_recs"),
    _qr("qr_nearby_distance", "Summary", "Nearby Student Distance (mi)", "demographics", "miles",
        NEARBY_REPORTS, theme="nearby", pivot="distance"),

    _qr("qr_adv_any", "Summary", "Percentage of Students Enrolled in Any Advanced Course",
        "coursework", "pct_unit", COURSE_REPORTS),
    _qr("qr_adv_ap", "Summary", "Percentage of Students Enrolled in an AP Course",
        "coursework", "pct_unit", COURSE_REPORTS),
    _qr("qr_adv_ib", "Summary", "Percentage of Students Enrolled in an IB Course",
        "coursework", "pct_unit", COURSE_REPORTS),
    _qr("qr_adv_clep", "Summary",
        "Percentage of Students Enrolled in a College Level Examination Program (CLEP)",
        "coursework", "pct_unit", COURSE_REPORTS),
    _qr("qr_adv_math_science", "Summary",
        "Percentage of Students Enrolled in an Advanced Math or Science Course",
        "coursework", "pct_unit", COURSE_REPORTS),
    _qr("qr_adv_college_prep", "Summary",
        "Percentage of Students Enrolled in an NYCPS-certified College Preparatory Course",
        "coursework", "pct_unit", COURSE_REPORTS),
    _qr("qr_adv_college_credit", "Summary",
        "Percentage of Students Enrolled in a College Credited Course",
        "coursework", "pct_unit", COURSE_REPORTS),
]

# Survey areas, ranked by the rating each one feeds. The City publishes a City
# average beside each school's percent positive.
for _key, _area, _rank, _since in [
    ("instruction", "Instruction/Learning Environment", 1, None),
    ("iep_satisfaction", "Students with IEPs: IEP Service Satisfaction", 1, "2024-25"),
    ("advising", "Advising and Planning", 2, None),
    ("safety", "Safety", 2, None),
    ("leadership", "School Leadership", 2, None),
    ("student_support", "Student Support", 2, None),
    ("teaching", "Teaching Environment", 2, None),
    ("communication", "Communication", 3, None),
    ("involvement", "Family Involvement", 3, None),
    ("trust", "Family-School Trust", 3, None),
]:
    SQR_RESULTS_METRICS.append(_qr(
        f"qr_pp_{_key}", "Scoring", f"{_area} - School Percent Positive", "climate", "pct_unit",
        ALL_REPORTS, comparison=f"{_area} - City Positive Responses",
        comparison_label="City average", rank=_rank,
        unit="share of survey answers that were positive, 0 to 1",
        **({"since": _since} if _since else {})))

for _key, _who in [("student", "Student"), ("teacher", "Teacher"), ("parent", "Parent")]:
    SQR_RESULTS_METRICS.append(_qr(
        f"qr_response_{_key}", "Scoring", f"{_who} Survey Response Rate", "climate", "pct_unit",
        ALL_REPORTS, base="Survey response rates", subgroup=_who, theme="respondents", rank=4,
        unit="share of surveys returned, 0 to 1"))

# All, some and none share one card per service type, so the three read in one
# school year. Card titles are the Educator Guide's headings.
for _key, _what, _title in [
    ("programs", "special education programs", "Percent of Students Receiving Special Education Programs"),
    ("services", "related services", "Percent of Students Receiving Recommended Related Services"),
]:
    for _share, _word in [("all", "all"), ("some", "some"), ("none", "no")]:
        _column = f"Percentage of students with IEPs receiving {_word} recommended {_what}"
        SQR_RESULTS_METRICS.append(_qr(
            f"qr_iep_{_key}_{_share}", "Summary", _column, "student_support", "pct_unit",
            ALL_REPORTS, base=_title, subgroup=_column, theme="iep_delivery", rank=1,
            unit="share of students with IEPs, 0 to 1"))

QR_COMPOSITION_UNIT = "share of the students in the courses, 0 to 1"
QR_COMPOSITION_NOTE = (
    "Each row is one group's share of the students taking these courses, so the rows "
    "add to about 100%. The school's own shares are under Compared with nearby students."
)

for _key, _race in QR_RACES:
    SQR_RESULTS_METRICS += [
        _qr(f"qr_teacher_pct_{_key}", "Summary", f"Teacher Percent - {_race}", "staff",
            "pct_unit", ALL_REPORTS, base="Teachers by race and ethnicity",
            subgroup=_race, theme="race", rank=2, unit="share of teachers, 0 to 1"),
        _qr(f"qr_student_pct_{_key}", "Summary", f"Student Percent - {_race}", "demographics",
            "pct_unit", ALL_REPORTS, theme="nearby", subgroup=_race, pivot="school"),
        _qr(f"qr_nearby_pct_{_key}", "Summary", f"Nearby Student Percent - {_race}",
            "demographics", "pct_unit", NEARBY_REPORTS, theme="nearby", subgroup=_race,
            pivot="nearby"),
        _qr(f"qr_district_pct_{_key}", "Summary", f"District Percent - {_race}", "demographics",
            "pct_unit", "EMS EC", theme="nearby", subgroup=_race, pivot="district"),
        _qr(f"qr_borough_pct_{_key}", "Summary", f"Borough Percent - {_race}", "demographics",
            "pct_unit", "HS HST D75", theme="nearby", subgroup=_race, pivot="borough"),
        # Each group's share of the students in the courses, not the share of
        # the group enrolled. The Educator Guide defines it that way.
        _qr(f"qr_adv_any_{_key}", "Summary",
            f"Percentage of Students Enrolled in Advanced Courses - {_race}", "coursework",
            "pct_unit", COURSE_REPORTS, base="Students in Advanced Courses by Racial Subgroup",
            subgroup=_race, theme="race", unit=QR_COMPOSITION_UNIT, note=QR_COMPOSITION_NOTE),
        _qr(f"qr_apib_{_key}", "Summary",
            f"Percentage of Students Enrolled in AP or IB Courses - {_race}", "coursework",
            "pct_unit", COURSE_REPORTS, base="Students in AP or IB Courses by Racial Subgroup",
            subgroup=_race, theme="race", unit=QR_COMPOSITION_UNIT, note=QR_COMPOSITION_NOTE),
    ]

# Workbook markers. "N<5" and "N<15" withhold a figure for a small group.
QR_SUPPRESSED = {"n<5", "n<15"}


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
STATUS_CENSORED = "censored"          # published as a bound, such as "Above 95%"
STATUS_NOT_APPLICABLE = "not_applicable"   # the metric does not apply to this school type

STATUS_LABELS = {
    STATUS_OK: "Reported",
    STATUS_MISSING: "Not reported",
    STATUS_SUPPRESSED: "Withheld, too few students",
    STATUS_CENSORED: "Published as a bound, not an exact figure",
    STATUS_NOT_APPLICABLE: "Does not apply to this school",
}

# Values the source publishes as a bound rather than a number. The demographic
# snapshot replaces poverty and economic need with "Above 95%" or "Below 5%" to
# protect privacy at the extremes, which affects 1,174 and 934 rows.
#
# Treating those as missing would be wrong twice over: the fact is known, and it
# is known precisely at the highest-need schools, so losing it would blank the
# figure exactly where it matters most.
CENSORED_VALUES = {
    "above 95%": "Above 95%",
    "below 5%": "Below 5%",
    "> 95%": "Above 95%",     # the quality report workbooks' spelling
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
    # Nor more than this share of its schools with a coordinate. The map
    # would lose them without any error on the page.
    "max_coordinate_loss": 0.05,
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
    "sqr_results": 500,
    "demographics": 500,
    "directory_es": 500,
    "directory_ms": 500,
    "directory_hs": 500,
}


# ---- Site output -----------------------------------------------------------

SITE = {
    "name": "Schools Finder",
    "domain": "schools.publicworks.nyc",
    "tagline": "New York City public school statistics, in one place",
    "repo": "https://github.com/jaramana/schools.publicworks.nyc",
    "search_index_fields": ["dbn", "name", "boro", "district", "type", "grades"],
    # Profiles are written one file per DBN so a page loads only what it shows.
    "school_file": "schools/{dbn}.json",
    "downloads": {
        "xlsx": "schools-publicworks-nyc-data.xlsx",
        "zip": "schools-publicworks-nyc-csv.zip",
    },
    # Five schools sit side by side on a laptop screen without scrolling, and
    # usability research on comparison tables puts the useful limit near five.
    # Compare shows every slot, hollow until filled.
    "max_compare": 5,
    # A profile file carries values and suppression markers. A row the source
    # published blank with no group size adds nothing a reader can use, and the
    # site already knows from the metric manifest which metrics a school type
    # should report, so it can say "not reported" without being told. The
    # downloads still carry every row.
    "site_statuses": [STATUS_OK, STATUS_SUPPRESSED, STATUS_CENSORED],
}
