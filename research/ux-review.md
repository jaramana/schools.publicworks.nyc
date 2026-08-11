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

## Second pass on the comparison page, August 2026

Running the page as a user rather than reading it turned up three faults, one
reported and two not.

**Removing a school updated the measures but not the school table.** `draw()`
returned early when fewer than two schools were chosen, and the early return
came before the school table was rendered. So an × removed a school from the
comparison and from the address bar, and the table it had just been clicked in
carried on listing it. Drawing is now three regions that each always reflect
the current state, and every step from zero schools to twelve and back was
walked through to confirm it.

**Adding a school did nothing, silently, in two cases:** when the list was
already full, and when the school was already on it. The click was simply
ignored. Both now say what happened, in the status line under the search.

**A shortlist could not be cleared.** It is remembered between visits, so
arriving at the comparison page with no address parameters restored twelve
schools from the last session, and the only way out was removing twelve rows by
hand. There is now a clear-all button above the table.

## Third pass on the comparison page, August 2026

The second pass hung the fixes on an × control inside the table, which turned
out worse than the strip of pills it replaced, and all of it was reverted
together. This pass keeps the fixes and drops the ×.

**The page was two tables and did not read as one thing.** Schools sat in one
table, measures in another, with the measure picker between them, so it was
never obvious which control moved which table, and a reader crossed a boundary
in the middle of one comparison. It is now a single sheet on the model of a car
comparison: the schools across the top, every fact down the side in labelled
groups, with the school identity as the first group rather than a table of its
own. The measure picker is the only control above it.

**The axes are pivoted.** Schools are columns and measures are rows. A shortlist
stops at twelve; the measures do not stop, and there are 485 to choose from, so
the axis that grows without limit now grows downward.

**Both headers stay put.** The school names pin to the top of the sheet and the
measure names to the left, so neither a figure nor its label can scroll out of
sight while the other is on screen.

**Removing is still done outside the table**, with the strip of pills for
schools and the chips for measures. The strip does repeat the school list, which
is what the × was meant to fix, and that remains the open objection to it.

**An absent cell now says which kind of absence it is:** withheld, not reported,
or does not apply, rather than a dash for all three.

**Nothing arrives that was not asked for.** The sheet used to be replaced by a
note until two schools were chosen, so the table, the measure picker and the
download buttons all appeared at once on the second pick. All three are now on
the page at every count, with an empty column held open where the first school
will land, and the controls that have nothing to act on are disabled rather than
absent. Adding a school adds a column and adding a measure adds a row; that is
the whole of what moves.

## Still open

- No screen reader has been run against the site. It remains the largest gap.
- The at-a-glance set is the headline metric list from the config. For a
  District 75 or transfer school, few of those apply, and the section falls back
  to whatever the school does report. That fallback is arbitrary in a way the
  rest of the site is not.
- Marcela's phone session was simulated at 375 pixels, not on a real handset on
  a real network.
