#!/usr/bin/env python3
"""Fail if docs reference retired skill-certification tooling without the superseded banner."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TERMS = ("finance-skill-manifests.py", "certification-bundles")
BANNER = "Superseded for repository-owned skills by"
EXEMPT_DIR = "evidence"
# The lifecycle doc itself describes the removal.
EXEMPT_FILES = {"docs/plan/skill-ownership-and-lifecycle.md"}


def violations(root):
    docs = root / "docs"
    found = []
    for path in sorted(docs.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if path.relative_to(docs).parts[0] == EXEMPT_DIR or rel in EXEMPT_FILES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if any(t in text for t in TERMS) and BANNER not in text:
            found.append(rel)
    return found


def main(argv):
    root = Path(argv[1]).resolve() if len(argv) > 1 else ROOT
    bad = violations(root)
    for rel in bad:
        print(f"{rel}: references retired skill tooling without the superseded banner", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
