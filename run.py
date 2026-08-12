#!/usr/bin/env python3
"""Schools Finder (schools.publicworks.nyc): build everything.

    python run.py                 fetch if needed, then normalize, validate, export
    python run.py --force-fetch   download every source again
    python run.py --skip-fetch    use whatever is already cached
    python run.py --stage 3       run one stage on its own

Validation runs before anything is published. If it fails, the export stage
refuses to write and the currently published files are left alone.
"""

import argparse
import importlib.util
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT / "pipeline"

STAGES = [
    (1, "01_fetch", "fetch sources"),
    (2, "02_normalize", "normalize into tables"),
    (3, "03_validate", "validate the tables"),
    (4, "04_export", "write the site and the downloads"),
]


def load(module_name):
    """Import a stage by path. The files are numbered, so they are not importable
    with a plain import statement, and numbering them is worth more than that."""
    path = PIPELINE / f"{module_name}.py"
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force-fetch", action="store_true",
                        help="download every source again, ignoring the cache")
    parser.add_argument("--skip-fetch", action="store_true",
                        help="use the cached sources and do not check for new ones")
    parser.add_argument("--stage", type=int, choices=[1, 2, 3, 4],
                        help="run a single stage")
    args = parser.parse_args()

    selected = [s for s in STAGES if args.stage is None or s[0] == args.stage]
    if args.skip_fetch:
        selected = [s for s in selected if s[0] != 1]

    started = time.time()
    for number, module_name, description in selected:
        print(f"\n=== Stage {number}: {description}", flush=True)
        stage_started = time.time()
        module = load(module_name)
        if module_name == "01_fetch":
            module.main(force=args.force_fetch)
        elif module_name == "03_validate":
            result = module.main()
            if not result["passed"]:
                print("\nBuild stopped: validation failed. Nothing was published.",
                      file=sys.stderr)
                print("See build/validation.json for the failing checks.", file=sys.stderr)
                return 1
        else:
            module.main()
        print(f"=== Stage {number} finished in {time.time() - stage_started:.0f}s",
              flush=True)

    print(f"\nDone in {time.time() - started:.0f}s.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
