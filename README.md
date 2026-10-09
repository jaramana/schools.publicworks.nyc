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
| [School Quality Report results](https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources) | The City's ratings, Impact and Performance scores, survey results, staff, IEP services, nearby-student comparison and advanced courses | 2023–24 and 2024–25 |
| [Demographic Snapshot](https://infohub.nyced.org/reports/school-quality/information-and-data-overview) | Enrollment and demographics | Through 2025–26 |
| [NYC Public Schools directory data](https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data) | Addresses, grades, programs and admissions information | Fall 2025 |
| [School Point Locations](https://data.cityofnewyork.us/d/jfju-ynrr), `jfju-ynrr` | School coordinates | August 2024 snapshot |
| [GeoSearch](https://geosearch.planninglabs.nyc/) | Coordinates for schools missing from the point file | Address lookup |
| [School Districts](https://data.cityofnewyork.us/d/8ugf-3d8u), `8ugf-3d8u` | District outlines on the map | Updated May 2026 |

The current periods are in `docs/data/status.json`.

## Method and limits

- Sources are joined by DBN, the school's identifier, never by name.
- A blank is never a zero. Not reported, withheld and does not apply are kept
  apart. Published bounds such as "Above 95%" stay as bounds.
- Not reported means schools of the same type publish the measure and this
  school has no figure. The peer files in `docs/data/peers/` decide. A measure
  no school of the type publishes, or one for a grade the school does not
  serve, is left off the profile and reads Does not apply in Compare.
- The export marks a measure in `metrics.json` when at least 20 district
  schools have a figure and no charter school does. A charter school's
  profile gives that as the reason.
- A profile holds every current measure to its source's newest year for that
  school and names the year once, beside the source. A measure with no figure
  that year reads not reported, and earlier years are in the opened row.
  Compare shows each figure's year when schools differ.
- Scores, ratings and averages come from the City. The site groups the City's
  1 to 5 measure score into four bands, shows the City's ratings and Impact and
  Performance scores as published, and calculates no overall score.
- Each profile shows where a figure falls among schools of the same type that
  year. The build counts schools by value in 24 equal steps for each measure's
  two newest years, in `docs/data/peers/`. The counts name no school.
- Open or former status is inferred from recent source appearances. No source
  publishes it.
- Coordinates come from the school point file first, then the high school
  directory, then the geocoder. The map draws every school alike and shows
  district lines, not school zones.
- SHSAT figures, specialized admissions measures, suspensions and budgets are
  not included. About 400 open schools have no address in the directories.

The [Data page](https://schools.publicworks.nyc/data.html) shows the process
step by step, the sources, the column definitions and the downloads. The downloads
are an Excel workbook and CSV tables built from the same validated data as the
site.

## Updates

A [daily GitHub workflow](.github/workflows/refresh.yml) checks the sources and
publishes changed data only after validation passes. The site shows source periods
and the date of the last published build. That date does not advance when a run
finds no data changes; check the Actions history to confirm that refreshes are
still running. A stopped workflow cannot update the site's stale-source warning.

To build locally:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python run.py
```

The first run downloads about 245 MB and takes about five minutes; later runs
use the caches in `data-raw/`. Source URLs, thresholds and display rules are set
in `pipeline/00_config.py`. To preview the site, run `python3 tools/serve.py`
and open http://localhost:8787.

District outlines change rarely, so the daily run does not fetch them. Run
`python tools/fetch_districts.py` when NYC Open Data publishes new ones.

## Tools

Data pipeline: Python, `pandas`, `requests`, `openpyxl` and `XlsxWriter`
prepare and validate the data. Website: static HTML, CSS and JavaScript,
served from GitHub Pages. MapLibre GL is included with the site for maps, over
the OpenFreeMap Positron basemap, restyled in the browser. Claude was used in
development.

## License and reuse

Code is [BSD 3-Clause licensed](LICENSE). Compiled data can be reused with
attribution; NYC Public Schools and NYC Open Data retain their own source terms.
Carry the reporting period when republishing a figure.
