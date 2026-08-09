# Accessibility

Target: WCAG 2.1 AA, tested rather than assumed.

Two halves. `tools/check_accessibility.py` runs the checks a script can make and
fails the build if any of them regress. The manual pass below covers what a
script cannot see. Both were run on 2026-08-09 against the built site.

## Automated checks

```bash
.venv/bin/python tools/check_accessibility.py
```

It covers:

- Contrast for every colour pair the site actually renders, text at 4.5:1 and
  interface boundaries at 3:1.
- Page structure: one level-one heading, no skipped heading levels, no empty
  headings, `lang`, a title, `main`, `header` and `footer` landmarks, and a skip
  link on every page.
- Labels on every form control, and alternative text on every image.
- The generated markup the JavaScript produces: combobox roles and state on the
  search field, sort state on sortable columns, keyboard access and a name for
  the horizontally scrolling table regions, live regions for result counts and
  the stale-source warning, and the written-out empty cell.
- A reduced-motion rule, relative type sizes, and a visible focus style.

All checks pass. Two were failing when first run and were fixed rather than
waived:

- `--ink-faint` measured 4.24:1 on the sunken panel background, which is where
  the small text on history chips sits. It was darkened from `#6b7280` to
  `#646a75`, giving 4.78:1 there and 5.21:1 on the page background.
- Form control borders used `--rule-strong`, a hairline meant for table rows,
  which measured 1.7:1 against white. WCAG 1.4.11 asks for 3:1 on the boundary
  of a control, so inputs and selects now use a separate `--control` token at
  3.5:1. Row hairlines are unchanged, since they are decorative.

## Checks run in a real browser

These were exercised in a browser against the built site, by driving the page
rather than by reading the source.

### Keyboard and focus

- Tab order was enumerated on the finder: ninety-three stops, beginning with the
  skip link, then the wordmark, the navigation, and the page content, in reading
  order. Focus styling is a single global `:focus-visible` rule, so it applies
  to every one of them.
- The search field behaves as a combobox. Typing sets `aria-expanded` to true;
  the down arrow marks an option active, sets `aria-selected` on it, and points
  `aria-activedescendant` at its id. This was driven with synthetic key events
  and the resulting attributes read back.
- Search itself was tested against real queries. Several failed at first and the
  matcher was rewritten: `bronx science` and `ps 15` both returned nothing or
  the wrong schools until multi-word, punctuation-insensitive and leading-zero
  matching was added.

### Zoom and small screens

- At a 375 pixel viewport, both the finder and a profile report zero horizontal
  page overflow, and a scan of every element found none escaping its container
  outside a scrolling region.
- The layout uses relative units throughout, and the automated check fails the
  build if body text is ever given a pixel size, so a larger browser default or
  a zoom enlarges the site rather than breaking it.

### Motion

The site has no animation beyond two short colour transitions on hover, and a
reduced-motion preference disables them.

## Built for assistive technology, not yet tested with it

The following are implemented and verified present in the markup, by the
automated checks and by reading the accessibility tree in the browser. **No
screen reader has been run against this site.** That pass is still outstanding
and is the main gap in this document.

- Landmarks on every page, and a heading structure with no skipped levels.
- Live regions for the search result count, the filtered school count, and the
  stale-source warning.
- Table captions, `scope` on column headers, and a row header per measure, so a
  comparison cell can be announced with both its school and its measure.
- An absent value written out as "Not reported" or "Withheld" rather than left
  as an empty cell. This matters most of all for a screen reader, because a
  silent empty cell reads as nothing at all rather than as a gap in the data.

Until someone runs VoiceOver, NVDA or JAWS over the finder, a profile, a
comparison and the data page, the site should be described as built to AA and
partly tested, not as verified against AA.

## Known limits

- No screen reader test yet, as above.
- Very long school names wrap rather than truncate, which is correct but makes
  some cards tall on a narrow screen.
- The definition panel is collapsed by default. That keeps a profile scannable,
  but it does mean the reporting period and source are one interaction away
  rather than read out with the value. The year and group size are always
  visible, so the most misreadable part is not hidden.

## When you change something

Run the automated checks before publishing. If you add a colour, add the pair it
is used in to `PAIRS` or `UI_PAIRS` in `tools/check_accessibility.py`, otherwise
it is not being checked at all. If you add a control that is not a native
element, the manual keyboard pass has to be repeated for it.
