# School Ranking.xlsx: field inventory

Status: research note. Read on 2026-08-08 with a read-only openpyxl pass.
The workbook is a research prototype and field inventory. It is not a data source for the site.

File size is 44 MB. It contains 8 visible sheets and no hidden sheets.

## Sheet summary

| Sheet | Rows | Columns | Role |
| --- | --- | --- | --- |
| `Demo_Raw` | 9,373 data rows | 46 | Demographic snapshot, one row per DBN and year |
| `DBN_Ref` | 1,906 data rows | 2 | DBN to school name lookup |
| `Demo_Pivot` | 1,898 | 9 | Excel pivot of `Demo_Raw` for 2024-25 |
| `Perfo_Original` | 546,473 data rows | 12 | School Quality Reports metric extract |
| `Perfo_Raw` | 772 data rows | 12 | Filtered subset of `Perfo_Original` |
| `Perfo_Pivot` | 1,007 | 4 | Excel pivot of `Perfo_Raw` |
| `Admissions` | 26 data rows | 19 | Manually collected offer and priority data |
| `Summary` | 28 data rows | 20 | Personal rank, score, and commute. Excluded from the project |

## Demo_Raw

Grain: one row per DBN and school year. Years present are 2020-21 through 2024-25, with
1,857, 1,862, 1,872, 1,882 and 1,900 DBNs respectively. Distinct DBNs: 1,905.

Fields, grouped:

1. Identity: `DBN`, `School Name`, `Year`.
2. Enrollment: `Total Enrollment` plus counts for grades 3K, PK, K, and 1 through 12.
3. Sex: count and percentage for female, male, and neither female nor male.
4. Race and ethnicity: count and percentage for Asian and Pacific Islander, Black,
   Hispanic, Multi-Racial, Native American, White, and missing data.
5. Student groups: counts and percentages for students with disabilities, English language
   learners, and poverty, plus `Economic Need Index`.

Two observations that matter for the pipeline:

- Percentages are stored as decimal fractions, not as values out of 100.
- The `Neither Female nor Male` columns are empty for older years and populated for later
  years. This is a real reporting change, not a data error, and must not be read as zero.

This sheet matches the InfoHub file `demographic-snapshot-2020-21-to-2024-25-public.xlsx`
in period and grain. Treat that published file as the source and this sheet as a copy.

## Perfo_Original

Grain: one row per DBN, school year, and metric.

- 546,473 data rows, 1,045 distinct DBNs, 152 distinct metric variables.
- School years 2015 through 2024, with report years 2016 through 2025.
- Report types present: `EMS` (544,842 rows) and `EC` (1,631 rows).
- School types present: Elementary, K-8, K-3, K-2, and K-1.

This is a filtered extract, not the full dataset. The public source it comes from carries
1,493,752 rows, 2,006 DBNs, and 470 metric variables, and also covers Middle, High School,
High School Transfer, YABC, and District 75. See `source-manifest.md`.

Columns: `School Year`, `Report Year`, `DBN`, `School Name`, `Report Type`, `School Type`,
`Metric Variable Name`, `Metric Display Name`, `Number of Students`, `Metric Value`,
`Comparison Group Average`, `Metric Score`.

The column pair `Metric Variable Name` and `Metric Display Name` is already a usable
starting point for the project's `metric` entity. Variable names encode subject, grade, and
student group in a stable pattern, for example `rating_mean_ela_5gr` and
`prof_pct_mth_ell`.

### Metric families in the extract

The 152 variables fall into these families:

1. Attendance: `attendance_*` and `chronic_absent_*`, including breakdowns by race,
   ethnicity, and sex. Some variants exist only for 2020, the remote learning year.
2. State test results: `prof_pct_*` and `rating_mean_*` for ELA, Math, and Science, by
   grade and by student group.
3. Growth between grades: `prof_pct_watn3_*`, `prof_pct_watn5_*`, and the `prof_2plus_*`
   variants.
4. Middle school course work: `pct_core_*`, `pct_accel_*`, `ele_core_all`, and
   `hs_9gr_credits_all`.
5. Specific programs: `lre_all` for movement to less restrictive environments and
   `nyseslat_all` for English language learner progress.

`Comparison Group Average` is populated for some variables and empty for others. It is
never populated for the grade-level breakouts. Any comparison shown on the site must be
labeled as the source's own comparison group value, not a site calculation.

## Admissions

Grain: one row per DBN and program, with the key `DBNCoded` built by concatenating DBN and
program name. Only 26 rows, covering a small manually chosen set of District 20 schools.

The priority columns hold strings such as `35/35`, `ALL/ALL`, and `<5/<5`, which encode
offers over applicants and a suppression marker. These are not numbers and must not be
coerced. The sheet demonstrates the shape of program-level admissions data but has neither
the coverage nor the provenance for publication.

## Summary and the pivots

`Summary` holds the personal ranking: `Rank`, `Score`, `Walk`, `Transit`, `Selectivity`,
and a selected subset of 28 schools. `Demo_Pivot` and `Perfo_Pivot` are Excel pivots over
the raw sheets. None of these are inputs to the project.

## What the workbook tells us

1. The field selection is a good V1 shortlist: enrollment, demographics, economic need,
   attendance, state test results, and where available program admissions.
2. The workbook covers elementary and K-8 schools only. The plan's scope is all NYCDOE
   schools, so the site will publish roughly twice the DBNs and three times the metrics.
3. Nothing in the workbook carries an address, coordinates, or grades served in a
   structured form. Identity and location must come from a separate source.
