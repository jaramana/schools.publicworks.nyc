# Schools Finder

[Schools Finder](https://schools.publicworks.nyc) is an independent
[publicworks.nyc](https://publicworks.nyc)
reference for published New York City public school statistics. It brings the
sources included in this build onto one profile per school, with a reporting
period for each figure and definitions in the measure details.

## Data sources

| Source | Used for | Latest published period |
| --- | --- | --- |
| [School Quality Reports](https://data.cityofnewyork.us/d/dnpx-dfnc), `dnpx-dfnc` | Attendance, performance and other reported measures | Through 2024–25 |
| [Demographic Snapshot](https://infohub.nyced.org/reports/school-quality/information-and-data-overview) | Enrollment and demographics | Through 2025–26 |
| [NYC Public Schools directory data](https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data) | Addresses, grades, programs and admissions information | Fall 2025 |
| [School Point Locations](https://data.cityofnewyork.us/d/jfju-ynrr), `jfju-ynrr` | School coordinates | August 2024 snapshot |
| [GeoSearch](https://geosearch.planninglabs.nyc/) | Coordinates for schools missing from the point file | Address lookup |
| [School Districts](https://data.cityofnewyork.us/d/8ugf-3d8u), `8ugf-3d8u` | District outlines on the map | Updated May 2026 |

The current periods are in `docs/data/status.json`. The dated
[source manifest](research/source-manifest.md) records the original survey and
rejected sources; it is not updated with each build.

## Method and limits

- Sources are joined by DBN, the school's identifier, never by name. A school
  serving several grade spans can have more than one quality-report type for the
  same year.
- A reported zero, a withheld value, an unreported value and a measure that does
  not apply are distinct. Published bounds such as “Above 95%” stay as bounds
  rather than becoming missing values.
- A comparison shows each figure's reporting year, including when years differ
  between schools. Scores and comparison-group averages come from the City where
  available; the site does not calculate an overall score.
- Open or former status is inferred from recent source appearances, not taken from
  a published status field.
- Survey and school-climate results, SHSAT figures and some specialized admissions
  measures are not included. About 400 open schools have no address in the
  available directories.
- Coordinates come from the school point file first, then the high school
  directory, then the geocoder. The point file is a dated snapshot, so a school
  that opened after it falls back. The map draws every school alike and does not
  show school zones.

The [method page](https://schools.publicworks.nyc/method.html) explains the
measures and missing-data states. The
[data page](https://schools.publicworks.nyc/data.html) provides an Excel workbook
and normalized CSV tables made from the same validated data as the site.

## Updates

A [daily GitHub workflow](.github/workflows/refresh.yml) checks the sources and
publishes changed data only after validation passes. The site shows source periods
and the date of the last published build. That date does not advance when a run
finds no data changes; check the Actions history to confirm that refreshes are
still running. A stopped workflow cannot update the site's stale-source warning.

The Python pipeline in `run.py` uses cached downloads on later runs. Source URLs
and validation limits are set in `pipeline/00_config.py`.

District outlines change rarely, so the daily run does not fetch them. Run
`python tools/fetch_districts.py` when NYC Open Data publishes new ones.

## Tools

Data pipeline: Python, `pandas`, `requests`, `openpyxl` and `XlsxWriter`
prepare and validate the data. Website: static HTML, CSS and JavaScript,
served from GitHub Pages. MapLibre GL is included with the site for maps, over
the OpenFreeMap Positron basemap. Claude was used in development.

## License and reuse

Code is [BSD 3-Clause licensed](LICENSE). Compiled data can be reused with
attribution; NYC Public Schools and NYC Open Data retain their own source terms.
Carry the reporting period when republishing a figure.
