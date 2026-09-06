#!/usr/bin/env python3
"""Conservative CI selection: only recognized independent edits may skip jobs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import PurePosixPath


DOMAINS = ("rust", "contracts", "frontend", "pdf", "e2e")


def scope(enabled: tuple[str, ...], reason: str) -> dict[str, str]:
    return {"valid": "true", "reason": reason,
            **{f"run_{name}": str(name in enabled).lower() for name in DOMAINS}}


def classify_paths(paths: list[str]) -> dict[str, str]:
    if not paths:
        return scope(DOMAINS, "empty diff; full validation")
    categories = set()
    for path in paths:
        pure = PurePosixPath(path)
        if (pure.suffix in {".md", ".adoc"}
                and (path.startswith("docs/") or pure.name in {"README.md", "CHANGELOG.md"})):
            continue
        # Build/schema/generator/lock/shared asset changes, and anything not
        # explicitly recognized below, retain the complete gate set.
        if pure.name in {"Cargo.toml", "Cargo.lock", "package.json", "pnpm-lock.yaml"}:
            return scope(DOMAINS, "dependency configuration; full validation")
        if path.startswith("frontend/"):
            categories.add("frontend")
        elif path.startswith(("api-server/src/", "ai-gateway/src/", "iot-gateway/src/")) and pure.suffix == ".rs":
            categories.add("rust")
        else:
            return scope(DOMAINS, "shared/schema/build/unknown input; full validation")
    if not categories:
        return scope((), "documentation-only change")
    if categories == {"frontend"}:
        return scope(("frontend", "e2e"), "frontend-only change")
    if categories == {"rust"}:
        return scope(("rust", "e2e"), "service Rust-only change")
    return scope(DOMAINS, "mixed application changes; full validation")


def changed_paths(base: str, head: str) -> list[str]:
    merge_base = subprocess.check_output(["git", "merge-base", base, head], text=True).strip()
    # --no-renames includes both sides of a move; -z preserves unusual names.
    output = subprocess.check_output(
        ["git", "diff", "--name-only", "-z", "--no-renames", merge_base, head], text=True)
    return [path for path in output.split("\0") if path]


def event_scope(event_name: str, event: dict, head: str, base: str | None = None) -> dict[str, str]:
    if event_name in {"schedule", "workflow_dispatch", "merge_group"} and not base:
        return scope(DOMAINS, "explicit full validation event")
    if not base:
        base = (event.get("pull_request", {}).get("base", {}).get("sha")
                if event_name == "pull_request" else event.get("before"))
    if not base or set(base) == {"0"}:
        return scope(DOMAINS, "missing base; full validation")
    return classify_paths(changed_paths(base, head))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--github-output")
    args = parser.parse_args()
    try:
        event_path = os.environ.get("GITHUB_EVENT_PATH")
        if event_path:
            with open(event_path, encoding="utf-8") as source:
                event = json.load(source)
        else:
            event = {}
        values = event_scope(os.environ.get("GITHUB_EVENT_NAME", ""), event, args.head, args.base)
    except (OSError, ValueError, TypeError, AttributeError, subprocess.CalledProcessError):
        # Selection failure is not permission to skip: a full successful run
        # is sufficient. The gate still rejects missing/malformed outputs.
        values = scope(DOMAINS, "scope detection failed; full validation")
    print(json.dumps(values))
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as output:
            for key, value in values.items():
                output.write(f"{key}={value}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
