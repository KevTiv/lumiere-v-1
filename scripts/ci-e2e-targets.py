#!/usr/bin/env python3
"""Select the Playwright specs a stacked PR touches, for the targeted E2E lane.

A spec is selected when the PR adds or edits it, or when it imports (directly
or through other e2e support modules) an e2e support file the PR edits. The
selection is empty when the PR touches no e2e files or exceeds the targeted
limit; the workflow then falls back to the full P0 suite. Over-limit changes
also retain explicitly changed specs in bounded supplemental batches, since
P0 excludes some fixtures. Paths are emitted relative to frontend/web.
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
# Every test in these files requires a live provider. Normal CI excludes
# @ai-live; emitting a dedicated lane for either file produces no runnable
# tests. Explicit E2E_REQUIRE_AI=1 acceptance still owns their execution.
LIVE_PROVIDER_ONLY_SPECS = frozenset({
    f"{E2E_DIR}/gov00-governed-execution.spec.ts",
    f"{E2E_DIR}/ai-rag-evidence-access.spec.ts",
})
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


def _relative_specs(specs: list[str]) -> str:
    return " ".join(str(PurePosixPath(spec).relative_to(WEB_DIR)) for spec in specs)


def plan_targets(changed: list[str], sources: dict[str, str]) -> dict[str, str | list[dict[str, str]]]:
    """Keep the P0 fallback and supplement it with directly changed specs."""
    specs = [path for path in select_specs(changed, sources) if path not in LIVE_PROVIDER_ONLY_SPECS]
    fallback_configs: list[dict[str, str]] = []
    if len(specs) > MAX_TARGETED_SPECS:
        explicit = sorted({path for path in changed if _is_spec(path) and path in sources
                           and path not in LIVE_PROVIDER_ONLY_SPECS})
        for offset in range(0, len(explicit), MAX_TARGETED_SPECS):
            fallback_configs.append({
                "suite": "targeted",
                "clear_db": "0",
                "specs": _relative_specs(explicit[offset:offset + MAX_TARGETED_SPECS]),
                "slot": f"changed-{offset // MAX_TARGETED_SPECS + 1}",
            })
        specs = []
    return {"specs": _relative_specs(specs), "count": str(len(specs)), "fallback_configs": fallback_configs}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--github-output")
    args = parser.parse_args()

    result = plan_targets(changed_paths(args.base, args.head), e2e_sources(Path.cwd()))
    print(json.dumps(result))
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as handle:
            for key, value in result.items():
                if not isinstance(value, str):
                    value = json.dumps(value, separators=(",", ":"))
                handle.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
