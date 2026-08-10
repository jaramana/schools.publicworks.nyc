# schoolsfinder.nyc

A public reference for New York City public school statistics. Every figure the
city publishes about a school, on one page, with the definition, the reporting
period and the source next to each value.

The site is at [schoolsfinder.nyc](https://schoolsfinder.nyc). It is not
affiliated with New York City Public Schools.

There is no ranking, no overall score and no recommendation. The published data
does not support one.

## What is here

| Path | What it is |
| --- | --- |
| `pipeline/` | Four Python stages that build everything |
| `run.py` | Runs the stages in order |
| `docs/` | The published site, served by GitHub Pages |
| `docs/js/` | One file per page, plus shared search, table and formatting |
| `docs/data/` | Generated JSON the pages read |
| `docs/downloads/` | The public Excel workbook and CSV archive |
| `research/` | Source manifest and the inventory of the original workbook |
| `data-raw/` | Cached downloads. Not committed |
| `build/` | Intermediate tables and reports. Not committed |

## Running it

You need Python 3.9 or newer. No other tooling, no database, no build step for
the site itself.

```bash
python3 -m venv .venv
.venv/bin/pip install pandas requests openpyxl XlsxWriter
.venv/bin/python run.py
```

The first run downloads about 230 MB and geocodes roughly a thousand addresses,
which together take about fifteen minutes. Both are cached, so later runs take
about seven minutes, almost all of it writing the two thousand profile files.

Useful variations:

```bash
.venv/bin/python run.py --skip-fetch      # use the cache, do not check for new files
.venv/bin/python run.py --force-fetch     # download everything again
.venv/bin/python run.py --stage 3         # run one stage on its own
```

To look at the result before publishing:

```bash
.venv/bin/python tools/serve.py
```

Then open `http://127.0.0.1:8787`.

## The pipeline

Four stages, deliberately separate, so a change to one does not re-run the
others.

**`pipeline/00_config.py`** holds every tunable value: source URLs and dataset
identifiers, validation thresholds, staleness windows, metric categories,
display formats, the headline metric list, and the field maps for the three
directory workbooks. Nothing downstream hard-codes a URL or a cutoff. If you
want to change an assumption, change it here and rebuild.

**`pipeline/01_fetch.py`** downloads each source into `data-raw/` and records
what it got. It checks that an Excel file is really an Excel file and that a CSV
still has the columns the next stage needs, because a moved InfoHub file answers
with an HTML error page and HTTP 200.

**`pipeline/02_normalize.py`** produces five tables with declared grains:

| Table | One row per |
| --- | --- |
| `schools` | DBN |
| `metrics` | metric identifier |
| `observations` | DBN, school year, metric, and report type |
| `programs` | DBN and program |
| `program_priorities` | DBN, program, and priority rank |

**`pipeline/03_validate.py`** tests the grains rather than trusting them, checks
referential integrity in both directions, and compares the build against what is
already published. It fails on a duplicated key, an orphaned row, a status that
contradicts its own value, a source below its row or school floor, a lost
metric, or a school count that falls further than the configured tolerance. It
warns, rather than fails, on things that are simply how the data is: a school
type that publishes very little, a school with no address.

**`pipeline/04_export.py`** writes the site JSON and the two downloads into
`build/staging/`, then moves them into place in one step. It refuses to run at
all if validation did not pass, so a bad build leaves the live files untouched.

## Reading a value on the site

Three things travel with every number, because a number alone is not usable.

**Its reporting period.** Nothing is displayed without the school year it
describes.

**Its scale.** A value on a scale is written as "3.24 / 4.5", so nobody has to
open a definition to learn what it is out of. Screen readers get "out of",
since a slash is spoken as "slash".

**Where it stands, when the City says so.** For many measures New York City
publishes both a comparison group average and its own score from 1 to 5 against
that group. Both live inside the measure's panel, in a row labelled Similar
schools, and nothing but the value and its scale sits on the measure line
itself. A band and a score beside the number asked a reader to interpret two
scales at once while scanning a column of measures. In the comparison table the
band stays on the cell, because there standing across schools is the point. The score itself is always printed inside the band, and every
band carries a written label as well as a color. The banding thresholds are in
`SCORE_BANDS` in the config; the score is the City's. Where the City publishes
no score, nothing is colored.

Measures are grouped: a card leads with the all-students figure and holds the
breakdowns by student group under it, in a stated theme order, alphabetical
within each theme. Group names are the Department of Education's own wording.

## Performance

The published files are small once compressed, which is what matters: a school
profile is about 15 KB on the wire and the metric manifest 14 KB. Three things
keep a page quick, and all three are easy to undo by accident.

- **Detail panels are built when opened, not on load.** A large profile has 182
  measures; building every panel and every year chip up front put 6,500 nodes on
  the page before anything was readable. It is now about 3,400.
- **The search index is not loaded on a profile** until someone reaches for the
  search box, because it is the largest shared file and the profile does not
  need it.
- **`tools/serve.py` gzips**, because GitHub Pages does. Without that, local
  browsing is six times heavier than the real site and you optimize the wrong
  thing.

## Rules the pipeline keeps

These are the parts most worth preserving if you change anything.

**Join on the DBN, never on a school name.** Names are spelled differently in
every source. A name join silently attaches one school's results to another.

**Missing, withheld and not applicable are three different things.** A withheld
value means too few students were in the group, and it is not a zero. A measure
that does not apply to a school type is left out of that school's profile
instead of being shown as a gap. No value is ever defaulted to zero, and a
failed parse produces no value rather than a number.

**A value travels with its reporting period.** Nothing is displayed without the
school year it describes, and every figure inside one measure comes from the
same year.

**An absence is shown, not skipped.** Under a measure, every student group the
measure covers is listed for every school, with the reason where there is no
figure: withheld, or not reported. Filtering the list down to groups that
happen to have values is the tempting simplification and it is wrong: a race
breakdown then shows two groups and omits the rest, and nothing on the page
distinguishes "no such students" from "the City withheld it" from "the site has
a bug". If you change the rendering, keep this.

**Freshness comes from the data, not the file date.** Several New York City open
data pages report a recent update when only the description changed. Two
datasets named in the original project plan describe themselves as annually
updated and last received rows in 2011 and 2013; they are not used. When a
source passes its window the site shows a warning on every page.

**A bound is not a missing value.** The demographic snapshot publishes "Above
95%" or "Below 5%" for poverty and economic need at the extremes, to avoid
identifying students. That is 2,108 rows across 510 schools. Recording them as
missing would blank the figure precisely at the highest-need schools, so the
bound is carried through to the page and the downloads with a `censored` status.

**The report type is part of the grain.** A school serving grades 6 to 12 files
two quality reports and publishes some measures in both, for different students.
That is two observations, not a duplicate.

## Sources

| Source | Grain | Latest period |
| --- | --- | --- |
| [School Quality Reports](https://data.cityofnewyork.us/d/dnpx-dfnc) (`dnpx-dfnc`) | DBN, school year, metric | 2024-25 |
| [Demographic Snapshot](https://infohub.nyced.org/reports/school-quality/information-and-data-overview) | DBN, school year | 2024-25 |
| [Directory data](https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data), three workbooks | school, and school by program | Fall 2025 |
| [GeoSearch](https://geosearch.planninglabs.nyc/) | address | continuous |

`research/source-manifest.md` records what was checked, what was rejected and
why.

### When a source moves

The InfoHub file names carry a content hash that changes when a file is
republished, and the directories are reissued for each admissions season. When
that happens the fetch stage fails with the source name and the page to check.
Update the `url` in `pipeline/00_config.py` and run again. That is the whole
procedure.

If a dataset changes shape rather than location, the validation stage will say
which check failed and by how much. Do not raise a threshold to make a build
pass without understanding what moved.

## Keeping the data fresh

`.github/workflows/refresh.yml` runs the whole pipeline daily and on demand. It
publishes only if validation passes, and commits only when the generated public
files actually change, so the repository does not accumulate empty commits
against annual data.

GitHub disables scheduled workflows after sixty days without repository
activity. If the site's build date stops moving, that is the first thing to
check, and the workflow can always be run by hand from the Actions tab.

## Known gaps

- No survey or school climate results yet. Those are in per-report-type
  workbooks that this version does not read.
- No SHSAT or specialized high school admissions figures. The columns exist in
  the high school directory but their grain is not documented well enough to
  publish safely.
- About four hundred open schools have no published address, because they are
  not in an admissions directory.
- Open and closed status is inferred from whether a school appears in the newest
  snapshot or a current directory. No source publishes a status field.

## Licence and credit

Code is free to reuse with attribution. The underlying data is published by New
York City Public Schools and NYC OpenData and carries their terms. If you
republish a figure, carry its reporting period with it.
