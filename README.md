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
| [GeoSearch](https://geosearch.planninglabs.nyc/) | Coordinates for schools missing from the point file, and the address search | Address lookup |
| School Zones 2024–2025: [elementary](https://data.cityofnewyork.us/d/cmjf-yawu), `cmjf-yawu`; [middle](https://data.cityofnewyork.us/d/t26j-jbq7), `t26j-jbq7`; [high](https://data.cityofnewyork.us/d/ruu9-egea), `ruu9-egea` | Zoned schools for an address, and each school's zone | 2024–25 |
| [Approved rezonings](https://www.schools.nyc.gov/school-life/space-and-facilities/district-planning/district-planning-document-library/approved-rezonings) | Zone changes since the 2024–25 files, in Districts 3, 16 and 31 | 2025–26 |
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
  Compare leaves off a row that applies to none of the chosen schools.
- Compare holds five schools. A measure the City publishes separately for
  each report type, such as attendance for elementary and high schools, is
  one row there, and each school reads its own report's figure.
- The export marks a measure in `metrics.json` when at least 20 district
  schools have a figure and no charter school does. A charter school's
  profile gives that as the reason.
- A profile holds every current measure to its source's newest year for that
  school and names the year once, beside the source. A measure with no figure
  that year reads not reported, and earlier years are in the opened row.
  Compare shows each figure's year when schools differ.
- Scores, ratings and averages come from the City. A profile groups the
  City's 1 to 5 measure score into four bands, shows the City's ratings and
  Impact and Performance scores as published, and calculates no overall score.
  Each school is scored against its own group, so Compare shows figures
  without bands.
- Each profile shows where a figure falls among schools of the same type that
  year. The build counts schools by value in 24 equal steps for each measure's
  two newest years, in `docs/data/peers/`. The counts name no school.
- Open or former status is inferred from recent source appearances. No source
  publishes it.
- Coordinates come from the school point file first, then the high school
  directory, then the geocoder. The map draws every school alike.
- Zones are the City's 2024–25 lines, the newest on NYC Open Data. The
  2025–26 rezonings are marked where they change a zone. An address goes only
  to GeoSearch, the browser finds its zone, and a link carries zone numbers,
  never the address.
- SHSAT figures, specialized admissions measures, suspensions and budgets are
  not included. About 400 open schools have no address in the directories.

The [Data page](https://schools.publicworks.nyc/data.html) shows the process
step by step, the sources, the column definitions and the downloads. The downloads
are an Excel workbook and CSV tables built from the same validated data as the
site.

## Updates

A [daily GitHub workflow](.github/workflows/refresh.yml) checks the sources and
publishes changed data only after validation passes. The site shows source
periods, retrieval dates and the date of the last published build. Those dates do
not advance when a run finds no data changes; check the Actions history to confirm
that refreshes are still running. A stopped workflow cannot update the site's
stale-source warning.

To build locally:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python run.py
```

The first run downloads about 245 MB and takes about five minutes; later runs
use the caches in `data-raw/`. `requirements.txt` pins the library versions the
daily workflow uses, so a local build writes the same files. Source URLs,
thresholds and display rules are set in `pipeline/00_config.py`. To preview the
site, run `python3 tools/serve.py` and open http://localhost:8787.

District outlines change rarely, so the daily run does not fetch them. Run
`python tools/fetch_districts.py` when NYC Open Data publishes new ones.

Each school year's zones arrive as new datasets. When NYC Open Data lists a
newer year, the workflow opens an issue. The build keeps the newest reviewed
year until the new one is checked and added to `ZONE_YEARS` in
`pipeline/00_config.py`.

## Tools

Data pipeline: Python, `pandas`, `requests`, `openpyxl`, `XlsxWriter` and
`shapely` prepare and validate the data. Website: static HTML, CSS and
JavaScript, served from GitHub Pages. MapLibre GL is included with the site for
maps, over the OpenFreeMap Positron basemap, restyled in the browser. The
address search uses the Department of City Planning's GeoSearch, and the
browser finds the zone at the address. Claude was used in development.

## License and reuse

Code is [BSD 3-Clause licensed](LICENSE). Compiled data can be reused with
attribution; NYC Public Schools and NYC Open Data retain their own source terms.
Carry the reporting period when republishing a figure.
