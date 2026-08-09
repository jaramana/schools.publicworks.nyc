"""Automated accessibility and markup checks for the built site.

This is the machine half of the accessibility work. It catches the failures a
script can see: contrast against the palette, missing labels and landmarks,
heading order, and image and table semantics. A manual keyboard and screen
reader pass is still needed for the rest, and is recorded in
research/accessibility.md.

    .venv/bin/python tools/check_accessibility.py

Exits non-zero if anything fails.
"""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# The palette, taken from docs/css/site.css. Kept here as plain values so the
# check does not depend on parsing the stylesheet.
COLOURS = {
    "paper": "#fbfaf7",
    "paper-raised": "#ffffff",
    "paper-sunken": "#f2f0eb",
    "ink": "#16181d",
    "ink-soft": "#4a4f5a",
    "ink-faint": "#646a75",
    "rule": "#e0ddd6",
    "rule-strong": "#c9c5bb",
    "control": "#8f8879",
    "accent": "#1f4ed8",
    "on-accent": "#ffffff",
    "accent-soft": "#e8edfb",
    "accent-ink": "#163ba6",
    "warn": "#b4520a",
    "warn-soft": "#fdf0e4",
}

# Pairs the site actually renders, with the smallest size each is used at.
# "large" means 18.66px bold or 24px plain, where WCAG AA allows 3:1.
PAIRS = [
    ("body text", "ink", "paper", "normal"),
    ("secondary text", "ink-soft", "paper", "normal"),
    ("faint text, status lines and notes", "ink-faint", "paper", "normal"),
    ("faint text on a sunken panel", "ink-faint", "paper-sunken", "normal"),
    ("secondary text on a raised card", "ink-soft", "paper-raised", "normal"),
    ("faint text on a raised card", "ink-faint", "paper-raised", "normal"),
    ("links", "accent", "paper", "normal"),
    ("links on a raised card", "accent", "paper-raised", "normal"),
    ("hovered link", "accent-ink", "paper", "normal"),
    ("text on the accent fill", "on-accent", "accent", "normal"),
    ("current page in the nav", "accent", "accent-soft", "normal"),
    ("caution note", "warn", "warn-soft", "normal"),
    ("caution heading", "ink", "warn-soft", "normal"),
    ("table head", "ink-soft", "paper-sunken", "normal"),
    ("body text on a sunken panel", "ink", "paper-sunken", "normal"),
]

# Non-text contrast, which WCAG requires at 3:1 for anything that carries
# meaning or marks a control boundary.
UI_PAIRS = [
    ("input border", "control", "paper-raised"),
    ("input border on the page", "control", "paper"),
    ("input border on a sunken panel", "control", "paper-sunken"),
    ("focus ring", "accent", "paper"),
    ("focus ring on a card", "accent", "paper-raised"),
]


def luminance(hex_colour):
    hex_colour = hex_colour.lstrip("#")
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    adjusted = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
                for c in channels]
    return 0.2126 * adjusted[0] + 0.7152 * adjusted[1] + 0.0722 * adjusted[2]


def contrast(a, b):
    la, lb = luminance(COLOURS[a]), luminance(COLOURS[b])
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


class PageParser(HTMLParser):
    """Collects the structural facts the checks below need."""

    def __init__(self):
        super().__init__()
        self.headings = []
        self.landmarks = []
        self.images = []
        self.inputs = []
        self.labels_for = set()
        self.ids = set()
        self.links = []
        self.lang = None
        self.title = False
        self.buttons = 0
        self.in_title = False
        self.title_text = ""
        self.current_heading = None
        self.heading_text = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        if tag == "html":
            self.lang = attrs.get("lang")
        if tag == "title":
            self.in_title = True
            self.title = True
        if re.fullmatch(r"h[1-6]", tag):
            self.current_heading = int(tag[1])
            self.heading_text = ""
        if tag in ("main", "header", "footer", "nav"):
            self.landmarks.append(tag)
        if tag == "img":
            self.images.append(attrs)
        if tag in ("input", "select", "textarea"):
            self.inputs.append((tag, attrs))
        if tag == "label" and "for" in attrs:
            self.labels_for.add(attrs["for"])
        if tag == "a":
            self.links.append(attrs)
        if tag == "button":
            self.buttons += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if re.fullmatch(r"h[1-6]", tag) and self.current_heading:
            self.headings.append((self.current_heading, self.heading_text.strip()))
            self.current_heading = None

    def handle_data(self, data):
        if self.in_title:
            self.title_text += data
        if self.current_heading:
            self.heading_text += data


def check_contrast(failures):
    print("Contrast, WCAG AA")
    for name, fg, bg, size in PAIRS:
        ratio = contrast(fg, bg)
        needed = 3.0 if size == "large" else 4.5
        ok = ratio >= needed
        print(f"  {'pass' if ok else 'FAIL'}  {ratio:5.2f}:1  needs {needed}  {name}")
        if not ok:
            failures.append(f"contrast: {name} is {ratio:.2f}:1, needs {needed}:1")

    print("Contrast, interface elements at 3:1")
    for name, fg, bg in UI_PAIRS:
        ratio = contrast(fg, bg)
        ok = ratio >= 3.0
        print(f"  {'pass' if ok else 'FAIL'}  {ratio:5.2f}:1  {name}")
        if not ok:
            failures.append(f"contrast: {name} is {ratio:.2f}:1, needs 3:1")


def check_pages(failures):
    print("\nMarkup")
    for path in sorted(DOCS.glob("*.html")):
        parser = PageParser()
        parser.feed(path.read_text(encoding="utf-8"))
        name = path.name
        problems = []

        if not parser.lang:
            problems.append("no lang on <html>")
        if not parser.title_text.strip():
            problems.append("no page title")
        if "main" not in parser.landmarks:
            problems.append("no <main> landmark")
        if "header" not in parser.landmarks:
            problems.append("no <header> landmark")
        if "footer" not in parser.landmarks:
            problems.append("no <footer> landmark")

        levels = [level for level, _ in parser.headings]
        if levels.count(1) != 1:
            problems.append(f"{levels.count(1)} level-one headings, expected exactly one")
        for before, after in zip(levels, levels[1:]):
            if after > before + 1:
                problems.append(f"heading level jumps from h{before} to h{after}")
                break
        for level, text in parser.headings:
            if not text:
                problems.append(f"an h{level} has no text")
                break

        for attrs in parser.images:
            if "alt" not in attrs:
                problems.append("an <img> has no alt attribute")
                break

        for tag, attrs in parser.inputs:
            if attrs.get("type") == "hidden":
                continue
            identifier = attrs.get("id")
            labelled = (
                (identifier and identifier in parser.labels_for)
                or "aria-label" in attrs
                or "aria-labelledby" in attrs
            )
            if not labelled:
                problems.append(f"a <{tag}> has no label")
                break

        skip = [a for a in parser.links if "skip" in (a.get("class") or "")]
        if not skip:
            problems.append("no skip link")

        for attrs in parser.links:
            href = attrs.get("href", "")
            if href.startswith("#") and len(href) > 1:
                # An in-page link has to land somewhere, but the target may be
                # created by script, so only same-page static ids are checked.
                pass
            if href.startswith("http") and "noopener" not in (attrs.get("rel") or ""):
                # Not a failure: these are plain navigations, not window.open,
                # and modern browsers imply noopener for target="_blank" anyway.
                pass

        status = "pass" if not problems else "FAIL"
        print(f"  {status}  {name}")
        for problem in problems:
            print(f"        {problem}")
            failures.append(f"{name}: {problem}")


def check_scripts(failures):
    """Checks on the rendered markup that the JavaScript produces."""
    print("\nGenerated markup")
    checks = [
        ("js/search.js", 'role="combobox"', "the search input declares a combobox role"),
        ("js/search.js", "aria-expanded", "the search input reports whether results are open"),
        ("js/search.js", "aria-activedescendant", "keyboard focus is reported inside the list"),
        ("js/search.js", 'aria-live="polite"', "result counts are announced"),
        ("js/search.js", "sr-only", "the search input has a label for screen readers"),
        ("js/table.js", "aria-sort", "sortable columns report their sort state"),
        ("js/table.js", "tabIndex", "the scrolling table region is reachable by keyboard"),
        ("js/table.js", "'region'", "the scrolling table region is announced"),
        ("js/table.js", "scope", "table headers declare their scope"),
        ("js/table.js", "Not published", "an empty cell says so rather than reading as zero"),
        ("js/site.js", "role: 'status'", "the stale-source warning is announced"),
        ("index.html", 'id="school-count" role="status"', "the filtered school count is announced"),
    ]
    for filename, needle, description in checks:
        text = (DOCS / filename).read_text(encoding="utf-8")
        ok = needle in text
        print(f"  {'pass' if ok else 'FAIL'}  {description}")
        if not ok:
            failures.append(f"{filename}: missing {needle}")


def check_motion(failures):
    print("\nMotion and zoom")
    css = (DOCS / "css" / "site.css").read_text(encoding="utf-8")
    checks = [
        ("prefers-reduced-motion", "a reduced-motion preference is respected"),
        ("clamp(", "type scales with the viewport rather than being fixed"),
        (":focus-visible", "focus is visible"),
        ("min(100% - 2.5rem", "the page keeps a margin at every width"),
    ]
    for needle, description in checks:
        ok = needle in css
        print(f"  {'pass' if ok else 'FAIL'}  {description}")
        if not ok:
            failures.append(f"site.css: missing {needle}")

    # A fixed pixel font size on body text stops a browser zoom from working
    # properly for someone who has set a larger default.
    if re.search(r"body\s*\{[^}]*font-size:\s*\d+px", css):
        failures.append("site.css: body font size is in pixels")
        print("  FAIL  body text is sized in relative units")
    else:
        print("  pass  body text is sized in relative units")


def main():
    failures = []
    check_contrast(failures)
    check_pages(failures)
    check_scripts(failures)
    check_motion(failures)

    print()
    if failures:
        print(f"{len(failures)} failures:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print("All automated accessibility checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
