# schools.publicworks.nyc

Formerly schoolsfinder.nyc, renamed under the publicworks.nyc portfolio
convention before its first launch. This plan predates the rename; the product
goal, scope and rules below are unchanged, only the name and file references
are current.

Read `working-with-claude_jaramana` first. It defines working style, tone, and general stack preferences.

Project-specific overrides:

- Use Python for this project's data pipeline.
- V1 is light mode only.
- Ask before making unresolved product or methodology decisions.

---

## Product goal

Build a friendly public reference site that consolidates NYC Public Schools data normally split across separate datasets and tools.

V1 showcases school statistics. It is not a school recommender and does not rank schools.

- No overall score, rank, weighting system, or "best school" ordering.
- Do not reproduce the personal rank, score, commute values, or selections from `School Ranking.xlsx`.
- Source-provided ratings or comparison-group values may be shown when clearly labeled.
- Treat `School Ranking.xlsx` as a research prototype and field inventory, not as the production data source or methodology.

References:

- Anti-reference: https://tools.nycenet.edu
- Product reference: https://myschools.nyc/en/
- Design and repository reference: https://www.thepaygap.nyc

---

## V1 scope

### School discovery

- Search by school name or DBN.
- Browse or filter by borough, district, grades served, and school type.
- Do not accept a home address or selected map point in V1.

### School profile

Display every reliable and relevant published statistic available for that school, grouped into clear sections:

- School overview, address, grades, type, district, and contact information.
- Enrollment and demographics.
- Academic performance and attendance.
- School climate, surveys, and other quality-report measures.
- Programs and admissions data where coverage and definitions are reliable.

Every statistic must expose its definition, reporting period, source, applicability, and missing-data state. Do not imply that every metric applies to every school type.

### Comparison

- Permit factual side-by-side comparison of two or three schools if it remains simple.
- Use identical definitions and reporting periods across compared values.
- Do not declare a winner or collapse metrics into a score.

### Location treatment

- Show the school's address, borough, district, and coordinates where available.
- An external "Open in map" link is acceptable.
- Do not embed an interactive map or load a mapping library in V1.

### Public downloads

Make the stitched public dataset a first-class V1 deliverable.

Publish:

- `schools-publicworks-nyc-data.xlsx` for people using Excel.
- `schools-publicworks-nyc-csv.zip` containing normalized CSV tables for machines and reproducible analysis.

Both downloads and the website JSON must be generated from the same canonical pipeline.

The public workbook should contain these sheets:

1. `Schools`: one row per DBN with identity, location, current attributes, and current published statistics.
2. `Historical Metrics`: DBN, school year, metric ID, value, sample size, source ID, and flags.
3. `Programs and Admissions`: one row per DBN and program, where reliable data exist.
4. `Data Dictionary`: metric definitions, units, applicability, periods, and missing-value meanings.
5. `Sources and Coverage`: source URLs, dataset IDs, periods, refresh dates, row counts, and limitations.

Do not publish the original personal workbook. Remove ranks, scores, commute calculations, personal address information, personal weights, and manually selected subsets.

---

## Pages

- `index.html`: concise introduction and school search.
- `school.html?dbn=`: complete school profile.
- `compare.html?schools=`: optional factual comparison.
- `data.html`: downloads, source coverage, and freshness.
- `method.html`: definitions, methodology, limitations, and comparability.
- `about.html`: project purpose, credits, and independence disclaimer.

Use URL parameters for shareable state. Avoid a single-page application or client-side router.

---

## Data model

Use identifiers and explicit table grains. Never join datasets by school name when a stable identifier is available.

### Core entities

- `school`: canonical DBN, name, school type, grades, borough, district, address, coordinates, and status.
- `program`: DBN plus a stable program identifier; admissions data may be program-level rather than school-level.
- `metric`: stable metric ID, label, description, unit, format, category, applicable school types, and comparability rules.
- `observation`: DBN, optional program ID, school year, metric ID, value, numerator, denominator, sample size, source ID, and flags.
- `source`: source ID, agency, dataset ID, URL, update cadence, latest period, expected grain, and limitations.

Keep school organizations, programs, buildings, and geographic areas conceptually separate. Do not assume that DBN, program, and physical location are one-to-one.

### Missing and suppressed data

- Missing is not zero.
- Suppressed is not zero.
- Not applicable is not missing.
- Preserve source suppression markers and publish a machine-readable status field.
- Never use an error fallback that silently converts a failed lookup into `0`.

---

## Data sources

Known starting sources:

- NYC OpenData School Quality Reports Data: `dnpx-dfnc`
- NYC OpenData School Point Locations: `jfju-ynrr`
- NYC Public Schools InfoHub files for current School Quality Reports, demographics, attendance, surveys, tests, and other relevant measures.
- Official admissions datasets where current, sufficiently complete, and legally publishable.

Do not assume a listed dataset is current because its metadata changed. Check the data period itself.

Before implementing the full pipeline, create a source manifest containing:

- Dataset ID, title, owner, URL, and retrieval method.
- Latest data period and expected update frequency.
- Table grain, stable keys, expected row range, and required fields.
- School-type coverage, suppression rules, and known gaps.
- Cross-year comparability notes and replacement-source history.

Prefer maintained official sources. If a source is stale, historical, partial, or manually published, label it and decide whether it belongs in V1 before building around it.

---

## Pipeline

Use Python with `pandas` and `requests`. Keep stages separate and readable:

```text
pipeline/00_config.py
pipeline/01_fetch.py
pipeline/02_normalize.py
pipeline/03_validate.py
pipeline/04_export.py
run.py
```

Keep every tunable threshold, path, source ID, and display option in `pipeline/00_config.py` or a clearly referenced source manifest.

Pipeline rules:

- Cache source downloads where appropriate.
- Write new outputs to staging, validate them, then replace published files atomically.
- Join by stable keys and test key uniqueness and referential integrity.
- Fail on unexpected schema changes, missing required columns, implausible row shrinkage, duplicated keys, or severe coverage loss.
- Preserve source values and provenance; calculate derived fields explicitly and document them.

### Site outputs

```text
docs/data/search-index.json
docs/data/metrics.json
docs/data/sources.json
docs/data/status.json
docs/data/schools/{dbn}.json
docs/downloads/schools-publicworks-nyc-data.xlsx
docs/downloads/schools-publicworks-nyc-csv.zip
```

Keep the search index compact. Load detailed school data only when a profile is opened.

---

## Stack and hosting

- Static GitHub Pages site served from `/docs` on `master`.
- Hand-written, commented HTML, CSS, and vanilla JavaScript.
- No framework, database, backend, package bundler, or build step unless a demonstrated requirement makes one necessary.
- Python is a data-generation dependency, not a browser dependency.

V2 commute routing may eventually require an external service or a materially different architecture. Do not solve that in V1.

---

## Design

Reflect thepaygap.nyc without copying requirements that conflict with this project.

Reuse or closely match:

- Page widths, spacing rhythm, typography, color restraint, and section hierarchy.
- Masthead, footer, search, cards, controls, status lines, loading states, and error states.
- Data-first presentation and visible methodology links.
- Shareable URL state and progressive loading of static JSON.

Project differences:

- Light mode only. Remove theme controls and dark-mode CSS.
- No ranking interface, score cards, or winner language.
- No embedded map in V1.
- Tone: quiet, institutional, approachable, and not playful.
- Avoid transient visual trends, scroll effects, decorative animation, and excessive polish.

Build profile sections from the metric manifest where practical. Adding a metric should normally require a pipeline or configuration change, not custom HTML and JavaScript throughout the site.

---

## Accessibility

WCAG AA must be tested, not assumed.

Verify:

- Full keyboard operation and visible focus.
- Correct labels, headings, landmarks, table semantics, and status announcements.
- Text and interface contrast in every state.
- Usability at 200% zoom and on narrow screens without clipped content.
- Automated accessibility checks plus a short manual screen-reader pass on search, profile, comparison, and downloads.

Respect reduced-motion preferences even though V1 should use little or no motion.

---

## Keeping data fresh

Use GitHub Actions, not Cloudflare and not an LLM agent.

- `.github/workflows/refresh.yml`: daily schedule plus `workflow_dispatch`.
- Run the complete pipeline and publish only after validation passes.
- Commit only when generated public outputs materially change.
- Show freshness using each source's actual data period, not the workflow date.
- Show a visible warning when a source exceeds its configured staleness threshold.

GitHub may disable scheduled workflows after 60 days without repository activity. Document this in the README and keep manual dispatch available. Silent staleness is a release failure.

---

## V2 readiness

V2 may add:

- Address entry or point selection.
- Address or point to school-zone and district lookup.
- Zoned, eligible, and nearby school discovery.
- Route distance, duration, and commute comparison.
- An interactive MapLibre map when spatial interaction becomes central.

Prepare for V2 without building or exposing it in V1:

- Retain coordinates, district identifiers, and available geographic reference IDs in the V1 school model.
- Keep location resolution, zone lookup, and routing behind separate future interfaces.
- Keep profile sections modular so V2 can add location and commute sections.
- Do not add empty V2 navigation, placeholder controls, mapping dependencies, or an address field in V1.
- Never persist a user's home address unless a future requirement explicitly justifies it and the privacy design is approved.

---

## Documentation

- README: purpose, setup, pipeline, repository structure, refresh process, and source-change procedure. Assume no Python background.
- Methodology: define every published term and give limitations equal prominence to findings.
- Data dictionary: cover every published field in the site and downloads.
- Comments: explain why, not what.
- Use ASD-STE100 principles where they improve clarity.
- No em dashes in prose. Use colons only for genuine labels or introductions.
- Match established jaramana conventions for titles, section breaks, credits, and repository structure.

---

## V1 completion criteria

- Every included school is discoverable by name or DBN and opens a valid profile.
- Every displayed value has a definition, source, reporting period, and correct missing-data behavior.
- Website JSON, Excel, and CSV downloads agree because they come from the same validated tables.
- The interface contains no site-created overall ranking, score, recommendation, commute result, or interactive map.
- Accessibility, responsive layout, stale-data behavior, and pipeline failure behavior have been tested.

---

## Start here

1. Review `working-with-claude_jaramana`, `School Ranking.xlsx`, and thepaygap.nyc codebase. Do not copy workbook formulas without validating their meaning.
2. Produce the source manifest and entity model. Report coverage gaps and methodology decisions before building the full site.
3. Build one vertical slice: search index, one real school profile, metric metadata, source display, and one-row public download output.
4. Validate the slice for key integrity, missing-data behavior, performance, design parity, and accessibility. Then expand sources and school types.
5. Add comparison, complete downloads, documentation, and the refresh workflow only after the core profile pipeline is stable.
