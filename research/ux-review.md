# Design review, August 2026

**What this is.** A structured critique of the site, written as four reviewers
with different stakes in it. The reviewers are constructed, not interviewed.
Nobody in this document is a real person and no usability session took place.
It is a way of arguing with the design from angles the person who built it does
not naturally take, and the findings stand or fall on their own merits, not on
the authority of a fake quote.

Everything here was checked against the built site.

---

## The reviewers

**Dana**, 40, Park Slope. Marketing manager at a newspaper, $170,000. Columbia
grad school, originally Westchester. Talks about integration and means it, and
also intends to get her son into the best school she can. Will spend two hours
on this at 11pm and will build a spreadsheet.

**Marcela**, 38, Jackson Heights. Trained and worked as an engineer in Colombia,
works as a secretary at an engineering office here, $60,000, two children. Reads
English well but it is her second language, and she is doing this on a phone
between other things.

**Ray**, assistant commissioner for technology at the Department of Education.
Hiring a director to lead seven overworked analysts and engineers. Reading this
partly as a citizen and mostly as a hiring signal.

**A judge** for a civic technology award. Sees forty submissions a year, most of
them a dashboard over an open data portal.

---

## What worked

Agreed across all four, so worth protecting.

- **One page per school with the source on every number.** Ray: "the provenance
  discipline here is better than most things we ship."
- **Missing, withheld and not applicable kept apart.** The judge called this the
  thing that separates the site from a dashboard. Dana did not notice it, which
  is the point.
- **Refusing to rank.** Dana pushed on this and then conceded she trusted the
  numbers more because of it.
- **The method page.** The judge read it start to finish, which they said they
  almost never do.

---

## Findings

Ordered by how much they cost a reader. Each says who raised it and what was
done.

### 1. A profile opens at full length with no way in

**Dana, Marcela.** A large high school renders around 180 measure cards. Both
reviewers scrolled, lost the section headings, and could not get back. Marcela
gave up on the phone before reaching graduation results.

Dana: "I want the five numbers everyone actually asks about, and then the rest
if I want it."

**Done.** A profile now opens with **At a glance**: the headline measures with
their bands, above the full list. Under it, a row of jump links to every
section. Nothing is removed and nothing is summarized into a score. The full
detail is where it was.

### 2. "Comparison group" is not self-explanatory

**Dana, Marcela, judge.** All three asked the same question and none found the
answer without opening the method page. Dana assumed it meant citywide. Marcela
assumed it meant the district. Both were wrong, and the difference matters: the
band would mean something quite different under either reading.

Dana: "Above the middle of what? If it's schools like this one, say that, and
tell me who decided which schools are like this one."

**Done.** The band and the comparison sentence now say the City chooses the
group. A short note appears once per profile, next to the first band rather
than only on the method page. This is stated at the limit of what the sources
document: the City publishes the comparison group average and the score but not
the membership of each group, so the site does not claim to know how a group is
composed. Saying more would be inventing it.

### 3. The vocabulary assumes you already work in this field

**Marcela, judge.** DBN, Economic Need Index, report type, withheld, comparison
group, screened. Marcela worked out most of them from context, which is work she
should not have to do, and she was unsure about "withheld" in a way that could
have been read as "the school is hiding something."

**Done.** A glossary on the method page, linked from the footer, in plain
sentences. `DBN` on a profile is now an `abbr` with its expansion. "Withheld"
keeps its label, because it is accurate, and gains a plainer explanation: too
few students to publish without identifying them.

### 4. The site is English only, and does not admit it

**Marcela.** The City publishes school information in nine languages. This site
publishes in one and says nothing about that, which reads as an oversight rather
than a limit.

**Done.** The about page and the method page now state it plainly and point to
the City's own translated materials. A real translation is a larger piece of
work than one release, and pretending otherwise with a machine-translated layer
would be worse than saying so.

### 5. The comparison is the most interesting page and the least finished

**Dana, Ray.** Dana builds spreadsheets. She wanted her shortlist to survive
closing the laptop, and she wanted it in Excel.

Ray: "the URL holds the entire state, which is more than most products manage.
Say so, because nobody will guess."

**Done.** A CSV of exactly the table on screen, built in the browser, with the
value, its school year and the City's score in separate columns and raw
proportions rather than formatted strings. A copy-link button. A line saying the
shortlist is remembered in this browser.

### 6. Nothing tells a developer the JSON is usable

**Ray, judge.** Both went looking for an API. Ray found the JSON by opening the
network tab, which he described, fairly, as "the tell that this is a portfolio
piece and not a product."

**Done.** The data page now documents the JSON layout as a stable interface,
with the file paths and what each holds.

### 7. No license file

**Judge.** "Free to reuse with attribution" appears in prose in three places
and nowhere a machine or a lawyer can find it.

**Done.** MIT for the code, with the data terms stated separately, since the
underlying data belongs to the agencies that publish it.

### 8. The landing page does not say what the site refuses to do

**Judge, Dana.** After the homepage was cut back, the "no ranking" statement
went with it. The judge argued that the refusal is the most distinctive thing
about the project and that burying it in the method page understates it. Dana,
who arrived wanting a ranking, agreed she would rather be told immediately.

**Done.** One line, under the search box.

---

## Raised and deliberately not done

**Dana wanted a zoned-school lookup by address.** It is the single most
requested thing she could name. It is also the V2 boundary: it needs zone
geometry, an address resolver and a privacy design for handling a home address.
Doing it badly would be worse than not doing it.

**Dana wanted to filter schools by demographic composition.** She framed it as
finding a diverse school. The same control finds a segregated one, and the site
has no way to know which is being asked for. The figures stay on the profile,
where they describe a school, rather than becoming a way to sort schools by the
race of their students. This is a judgment and it is written down here so it can
be argued with.

**Ray suggested a school-level trend chart.** Reasonable, and the year-by-year
strip already carries the series. A drawn line invites reading a slope across
2019 and 2020, when testing was canceled. Not in this release.

**The judge asked for a "last verified" stamp per figure.** The reporting period
already does this more precisely than a verification date would.

---

## Still open

- No screen reader has been run against the site. It remains the largest gap.
- The at-a-glance set is the headline metric list from the config. For a
  District 75 or transfer school, few of those apply, and the section falls back
  to whatever the school does report. That fallback is arbitrary in a way the
  rest of the site is not.
- Marcela's phone session was simulated at 375 pixels, not on a real handset on
  a real network.
