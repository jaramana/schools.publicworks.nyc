"""Write the commit message for an automated data refresh.

Used by .github/workflows/refresh.yml. The message says what the published data
now covers, so the history reads as a record of reporting periods rather than a
row of identical "update data" lines.
"""

import json
from pathlib import Path

STATUS = Path(__file__).resolve().parent.parent / "docs" / "data" / "status.json"


def main():
    status = json.loads(STATUS.read_text())
    counts = status["counts"]
    periods = ", ".join(f"{name} {period}"
                        for name, period in sorted(status["periods"].items()))

    lines = [
        "Refresh published data",
        "",
        f"{counts['schools']:,} schools, {counts['metrics']:,} measures, "
        f"{counts['observations_reported']:,} published values.",
        f"Periods: {periods}.",
    ]

    stale = status.get("stale_sources") or []
    if stale:
        names = ", ".join(f"{s['source_id']} ({s['days']} days)" for s in stale)
        lines += ["", f"Stale sources at build time: {names}."]

    print("\n".join(lines))


if __name__ == "__main__":
    main()
