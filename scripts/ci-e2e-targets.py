#!/usr/bin/env python3
"""Select the Playwright specs a stacked PR touches, for the targeted E2E lane.

A spec is selected when the PR adds or edits it, or when it imports (directly
or through other e2e support modules) an e2e support file the PR edits. The
selection is empty when the PR touches no e2e files; the workflow then falls
back to the full P0 suite. Paths are emitted relative to frontend/web.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path, PurePosixPath


E2E_DIR = "frontend/web/tests/e2e"
WEB_DIR = "frontend/web"
MAX_TARGETED_SPECS = 25
IMPORT_RE = re.compile(r"""(?:from|import)\s*\(?\s*["'](\.{1,2}/[^"']+)["']""")


def _is_e2e_ts(path: str) -> bool:
    pure = PurePosixPath(path)
    return path.startswith(E2E_DIR + "/") and pure.suffix == ".ts"


def _is_spec(path: str) -> bool:
    return _is_e2e_ts(path) and path.endswith(".spec.ts")


def _resolve(importer: str, specifier: str, known: set[str]) -> str | None:
    base = PurePosixPath(importer).parent / specifier
    parts: list[str] = []
    for part in base.parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part != ".":
            parts.append(part)
    stem = "/".join(parts)
    for candidate in (stem, stem + ".ts", stem + "/index.ts"):
        if candidate in known:
            return candidate
    return None


def select_specs(changed: list[str], sources: dict[str, str]) -> list[str]:
    """Return repo-relative spec paths affected by ``changed``.

    ``sources`` maps every current e2e ``.ts`` path to its content.
    """
    known = set(sources)
    importers: dict[str, set[str]] = {path: set() for path in known}
    for path, text in sources.items():
        for specifier in IMPORT_RE.findall(text):
            target = _resolve(path, specifier, known)
            if target:
                importers[target].add(path)

    selected = {path for path in changed if _is_spec(path) and path in known}
    pending = [path for path in changed if _is_e2e_ts(path) and not _is_spec(path) and path in known]
    seen = set(pending)
    while pending:
        current = pending.pop()
        for importer in importers.get(current, ()):
            if _is_spec(importer):
                selected.add(importer)
            elif importer not in seen:
                seen.add(importer)
                pending.append(importer)
    return sorted(selected)


def changed_paths(base: str, head: str) -> list[str]:
    merge_base = subprocess.check_output(["git", "merge-base", base, head], text=True).strip()
    output = subprocess.check_output(
        ["git", "diff", "--name-only", "-z", "--no-renames", merge_base, head], text=True)
    return [path for path in output.split("\0") if path]


def e2e_sources(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): path.read_text(encoding="utf-8")
        for path in (root / E2E_DIR).rglob("*.ts")
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--github-output")
    args = parser.parse_args()

    specs = select_specs(changed_paths(args.base, args.head), e2e_sources(Path.cwd()))
    if len(specs) > MAX_TARGETED_SPECS:
        specs = []
    relative = " ".join(str(PurePosixPath(spec).relative_to(WEB_DIR)) for spec in specs)
    result = {"specs": relative, "count": str(len(specs))}
    print(json.dumps(result))
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as handle:
            for key, value in result.items():
                handle.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
