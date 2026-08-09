# Source manifest

Status: first pass. Verified by live request on 2026-08-08.
Scope decision in force: all NYCDOE schools, elementary through high school, including
District 75 and District 79 programs where published data exist.

A warning that applies to the whole NYC OpenData education catalog: almost every education
dataset reports `updatedAt` of 2024-11-26. That is a bulk metadata refresh, not new data.
The `data_updated_at` field and the data period inside the table tell the real story, and
they disagree with the metadata for most of these datasets. Every entry below records the
period that was read from the data.

## Confirmed sources

### S1. School Quality Reports Data

- Dataset ID: `dnpx-dfnc` on NYC OpenData. Owner: Department of Education.
- Retrieval: SODA API at `https://data.cityofnewyork.us/resource/dnpx-dfnc.json`, or bulk
  CSV export. Update frequency stated as annual. Rows last updated 2026-04-09.
- Grain: one row per DBN, school year, and metric variable.
- Verified shape: 1,493,752 rows, 2,006 distinct DBNs, 470 distinct metric variables.
- Verified periods: school years 2015 through 2024, report years 2016 through 2025.

Rows per school year, with distinct DBNs:

| School year | Report year | Rows | DBNs |
| --- | --- | --- | --- |
| 2015 | 2016 | 48,336 | 1,857 |
| 2016 | 2017 | 47,478 | 1,839 |
| 2017 | 2018 | 124,899 | 1,843 |
| 2018 | 2019 | 206,987 | 1,839 |
| 2019 | 2020 | 107,500 | 1,840 |
| 2020 | 2021 | 94,780 | 1,849 |
| 2021 | 2022 | 205,749 | 1,854 |
| 2022 | 2023 | 217,793 | 1,863 |
| 2023 | 2024 | 218,201 | 1,867 |
| 2024 | 2025 | 222,029 | 1,874 |

Distinct DBNs by report type and school type, counted across all years:

| Report type | School type | DBNs |
| --- | --- | --- |
| EMS | Elementary | 807 |
| EMS | Middle | 455 |
| EMS | K-8 | 299 |
| HS | High School | 558 |
| HST | High School Transfer | 65 |
| EC | K-3 | 127 |
| EC | K-2 | 114 |
| EC | K-1 | 91 |
| D75 | D75 | 63 |
| YABC | YABC | 23 |

Notes and limits:

- Metric coverage is strongly conditional on report type. A high school never reports
  `prof_pct_ela_3gr`, and an elementary school never reports graduation metrics. The
  `metric` entity needs an applicable-report-type list, and the profile must show
  not applicable rather than missing for the wrong school type.
- Row counts per year vary by a factor of four. The 2019 and 2020 years are thin because of
  the pandemic, and cross-year comparison across those years needs a warning.
- The metric identifier is stable across years for most variables, but some were renamed at
  the 2017 to 2018 boundary. `rating_mean_ela_low_city` runs 2015 to 2017 and
  `rating_mean_ela_low_c35` runs 2018 onward, and they are not the same definition.
  Comparability rules belong in the metric manifest, not in the site code.
- `comparison_group_average` and `metric_score` are populated for some variables only. Both
  are source-provided and may be shown when clearly labeled. Neither is a site ranking.

This is the strongest source in the project. It alone satisfies the academic performance,
attendance, and much of the quality-report scope for every school type.

### S2. School Quality Report results workbooks

- Location: NYC Public Schools InfoHub, School Quality Reports and Resources page.
- Files verified present for 2024-25, one per report type:
  `202425-ems-sqr-results.xlsx`, `202425-hs-sqr-results.xlsx`, `202425-hst-sqr-results.xlsx`,
  `202425-d75-sqr-results.xlsx`, `202425-ec-sqr-results.xlsx`.
- Base path: `https://infohub.nyced.org/docs/default-source/default-document-library/`.
- All five return HTTP 200.

Role: these carry the survey and school-environment sections that the OpenData extract does
not expose as clean metric rows, and they are the authority for the current year. Treat
them as a supplement to S1, not a replacement, and confirm the overlap before deciding what
each one owns.

### S3. Demographic snapshot

- File: `demographic-snapshot-2020-21-to-2024-25-public.xlsx` on InfoHub, verified HTTP 200.
- Grain: one row per DBN and school year. Periods 2020-21 through 2024-25.
- Coverage: 1,900 DBNs in 2024-25.
- Fields: enrollment by grade, sex, race and ethnicity, students with disabilities, English
  language learners, poverty, and Economic Need Index.

This is the same data as the `Demo_Raw` sheet in the personal workbook. Percentages are
decimal fractions. The category for students who are neither female nor male appears only
in later years, so absent values there are not applicable rather than zero.

The OpenData copies of the demographic snapshot are all frozen historical slices. The most
recent, `vmmu-wj3w`, stopped at 2021-11-18. Use InfoHub, not OpenData, for demographics.

### S4. School directory data

- Location: InfoHub, Admissions and Enrollment, Directory Data page.
- Files verified downloaded on 2026-08-08, all for Fall 2025:
  - Elementary: `ose/fall-2025---es-directory-dataa1d9858e-15ab-4626-ab0d-928d94c0d722.xlsx`,
    3.4 MB, one sheet, 167 columns, 5,781 rows, 3,630 distinct `schooldbn` values.
  - Middle: `ose/fall-2025-middle-school-data.xlsx`, 763 KB, 284 columns, 477 rows,
    477 distinct `schooldbn` values, one row per school.
  - High: `ose/fall-2025---hs-directory-datab85f64a0-05b9-439a-8e29-052ce60a5d86.xlsx`,
    1.0 MB, 377 columns, 452 rows, 452 distinct `dbn` values, one row per school.
- The middle and high school workbooks each ship a `Data Dictionary` sheet, with 204 and
  319 field definitions. These are the authority for field meanings and feed the project's
  own data dictionary directly.

This is the current identity source the project was missing. It provides, per school:
street address with borough and ZIP, district, grade span, total students, telephone,
website, accessibility description, neighborhood, transit notes, and a program block.

The program block is exactly the `program` entity in the plan. Each school carries up to
7 programs in the elementary file, 14 in the middle school file, and 11 in the high school
file, each with a program code, name, admissions method, eligibility, seats, applicants,
applicants per seat, a filled flag, and a numbered priority ladder. The middle and high
school files separate general education from students with disabilities. This is
program-level admissions data with real coverage and published definitions, which the
manual `Admissions` sheet in the personal workbook was not.

Cautions:

- The elementary file is not one row per DBN. It has 5,781 rows and 3,630 distinct codes
  because it includes 3-K and Pre-K early childhood centers, whose codes such as `01F305`
  are not school DBNs. It also carries up to three rows per DBN, one per entry point.
  Filter to true DBNs and define the grain explicitly before any join.
- `gradespan` is empty on the early childhood rows and `totalstudents` is often empty.
- The high school file writes `.` in `total_students` where a value is absent. That is a
  missing marker, not a number.
- The high school file has 452 schools against 558 high school DBNs in S1, because S1
  counts every DBN that ever reported, including closed schools. A closed school is a
  valid profile with historical data and no directory entry, and the model must allow it.
- The high school file ends with roughly 60 unnamed trailing columns. Ignore them.

### S5. Coordinates

Only the high school file carries coordinates, embedded inside the `location` text field in
the form `220 HENRY STREET, MANHATTAN NY 10002 (40.713362,-73.986051)`. The elementary and
middle school files give an address but no point.

The remedy is the NYC Department of City Planning GeoSearch service at
`https://geosearch.planninglabs.nyc/v2/search`. Verified working on 2026-08-08 with no API
key: the address `730 East 12 Street, Manhattan, NY 10009` returned a single feature with
coordinates and a BBL. Geocoding the directory addresses is a cached, one-off pipeline
stage, rerun only for addresses that change.

Coordinates derived this way are a project-calculated field, not a source value, and must
be labeled as such in the data dictionary.

### S6. Candidate additions, not yet verified in detail

Found on InfoHub and worth assessing before the source list is frozen:

- Test results at school level: `school-ela-results-public.xlsx`,
  `school-math-results-public.xlsx`, `school-science-results-public.xlsx`, and
  `2014-15-to-2022-23-nyc-regents-overall-and-by-category---public.xlsx`.
- Graduation results at school level: `2025-graduation-rates-public-school.xlsx`.
- Admissions outcomes: middle and high school offer results through Fall 2026, G and T
  results and enrollment demographics, and SHSAT and Discovery summaries.

Much of the test result content overlaps S1. Decide which source owns each metric rather
than publishing both.

## Rejected sources

### School Point Locations, `jfju-ynrr`

Named in the project plan as a starting source. It cannot be used. The dataset is
non-tabular, so the API returns "no row or column access to non-tabular tables", and its
rows were last updated on 2011-09-22.

### NYC DOE Public School Location Information, `3bkj-34v2`

Also non-tabular, rows last updated 2013-03-22.

### Yearly School Locations tables

`wg9x-4ke6`, `9ck8-hj3u`, `p6h4-mpyy` and the earlier years are tabular and carry exactly
the fields the project wants: location code, school name, BEDS code, grades served, open
date, status, address, latitude and longitude, community district, council district, census
tract, BBL, and NTA. The problem is age. The newest is 2019-2020, and the series stops
there. Useful as a schema reference and as a historical fallback, not as a live source.

## Location gap: resolved

The gap was that no current, tabular, DBN-keyed source of school addresses exists on NYC
OpenData. S4 closes it from InfoHub instead, and S5 supplies the coordinates. The City
Planning Facilities Database, `ji82-xba5`, is current but has no DBN column and only 1,521
school records, so it stays out: joining it would require a school name match, which the
project rules forbid.

## What was built from this

The V1 site uses S1, S3, S4 and S5. It does not use S2 or S6.

Measured from the build on 2026-08-09:

- 2,033 schools, of which 1,902 are open.
- 485 measures, spanning school years 2015-16 to 2024-25.
- 1,634,347 observations, of which 1,319,201 carry a value, 192,410 are marked
  withheld by the source, and 122,736 are rows the source published empty.
- 4,048 programs across 1,505 schools, with 18,997 priority rows.
- 1,500 schools have a coordinate: 447 published by the source and 1,053 matched
  from an address.

Two findings from building it that were not visible at manifest time:

1. **The report type is part of the observation grain.** 1,882 rows are the same
   school, year and metric published twice, once under the middle school report
   and once under the high school report, for different students. A school
   serving grades 6 to 12 files both. Collapsing them would have silently
   dropped one of the two values.
2. **Display names are reused across different measures.** "Average Student
   Attendance" is one variable for elementary and middle grades and a different
   variable for high schools. On a comparison page they collided into what
   looked like a duplicate row. The pipeline now makes every displayed label
   unique by adding the report types it belongs to.

## Still to investigate

1. School status. S4 lists schools that are open for the Fall 2025 admissions season, and
   S1 lists every DBN that ever reported. Neither states outright that a school has closed.
   The difference between the two sets is a usable signal but needs a stated rule.
2. Survey results coverage and grain inside the S2 workbooks.
3. Whether S1 or S6 owns each test result metric, and whether the S6 files add anything S1
   does not already carry with better structure.
4. Coverage for District 79. S1 has YABC and High School Transfer report types, but no
   directory file has been found for those programs.

## Method notes for the pipeline

- Record for every source: dataset or file identifier, retrieval URL, retrieval date, the
  data period read from the data, row count, and distinct key count.
- Fail the run when the distinct DBN count for S1 drops below the previous run by more than
  a configured tolerance, when the metric variable set loses a published variable, or when
  the newest school year disappears.
- Show freshness on the site from the data period, for example "school year 2024-25", and
  never from the workflow run date.
