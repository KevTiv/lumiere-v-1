#!/usr/bin/env python3
"""Validate the owned COV-00C correctness-defect census and source ratchets."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = REPO_ROOT / "docs" / "evidence" / "cov-00c-correctness-defects.json"

EXPECTED_DEFECT_IDS = {f"COV-D{index:02d}" for index in range(1, 12)}
VALID_STATUSES = {"open", "partially-resolved", "resolved"}
VALID_SEVERITIES = {"P0", "P1", "P2"}
SOURCE_SUFFIXES = {".ts", ".tsx"}

ALLOW_EMPTY_TOKENS = (
    "fetchQueryListAllowEmpty",
    "serverFetchQueryListAllowEmpty",
    "serverFetchQueryListsAllowEmpty",
    "serverFetchQueryListWithCredentialsAllowEmpty",
)
OPERATOR_BYPASS_TOKENS = ("callReducerBff", "callOwnerReducer", "callReducerAs")
LATEST_FUNCTION_RE = re.compile(
    r"(?:export\s+)?(?:async\s+)?function\s+"
    r"(?P<name>[A-Za-z0-9_]*(?:Latest|Newest|latest|newest)[A-Za-z0-9_]*)\s*\("
)


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def source_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in {"node_modules", ".next", "dist", "coverage"} for part in path.parts):
            continue
        yield path


def files_containing(root: Path, tokens: tuple[str, ...]) -> set[str]:
    matches: set[str] = set()
    for path in source_files(root):
        text = path.read_text()
        if any(token in text for token in tokens):
            matches.add(relative(path))
    return matches


def require_non_empty(entry: dict[str, Any], field: str, failures: list[str]) -> None:
    value = entry.get(field)
    if value is None or value == "" or value == []:
        failures.append(f"{entry.get('id', '<entry>')}: missing {field}")


def validate_defects(manifest: dict[str, Any], failures: list[str]) -> None:
    defects = manifest.get("defects")
    if not isinstance(defects, list):
        failures.append("defects must be a list")
        return

    ids = [entry.get("id") for entry in defects if isinstance(entry, dict)]
    if len(ids) != len(set(ids)):
        failures.append("duplicate defect ids")
    if set(ids) != EXPECTED_DEFECT_IDS:
        failures.append(
            "defect ids must be exactly "
            + ", ".join(sorted(EXPECTED_DEFECT_IDS))
        )

    for entry in defects:
        if not isinstance(entry, dict):
            failures.append("defect entry must be an object")
            continue
        for field in (
            "class",
            "status",
            "severity",
            "launch_impact",
            "affected_surfaces",
            "owner",
            "downstream_packages",
            "closure_gate",
            "evidence",
        ):
            require_non_empty(entry, field, failures)
        if entry.get("status") not in VALID_STATUSES:
            failures.append(f"{entry.get('id')}: invalid status {entry.get('status')!r}")
        if entry.get("severity") not in VALID_SEVERITIES:
            failures.append(f"{entry.get('id')}: invalid severity {entry.get('severity')!r}")

        for evidence in entry.get("evidence", []):
            if not isinstance(evidence, dict):
                failures.append(f"{entry.get('id')}: evidence must be an object")
                continue
            path_value = evidence.get("path")
            markers = evidence.get("markers")
            if not isinstance(path_value, str) or not path_value:
                failures.append(f"{entry.get('id')}: evidence path missing")
                continue
            path = REPO_ROOT / path_value
            if not path.is_file():
                failures.append(f"{entry.get('id')}: missing evidence file {path_value}")
                continue
            if not isinstance(markers, list) or not markers:
                failures.append(f"{entry.get('id')}: no markers for {path_value}")
                continue
            text = path.read_text()
            for marker in markers:
                if not isinstance(marker, str) or marker not in text:
                    failures.append(
                        f"{entry.get('id')}: stale marker {marker!r} in {path_value}"
                    )


def compare_inventory(
    name: str,
    actual: set[str],
    expected: list[str],
    failures: list[str],
    *,
    validate_paths: bool = True,
) -> None:
    expected_set = set(expected)
    if len(expected) != len(expected_set):
        failures.append(f"{name}: duplicate classified paths")
    if validate_paths:
        for path in expected_set:
            if not (REPO_ROOT / path).is_file():
                failures.append(f"{name}: classified path does not exist: {path}")
    unclassified = sorted(actual - expected_set)
    stale = sorted(expected_set - actual)
    if unclassified:
        failures.append(f"{name}: unclassified source paths: {', '.join(unclassified)}")
    if stale:
        failures.append(f"{name}: stale classified source paths: {', '.join(stale)}")


def validate_inventories(manifest: dict[str, Any], failures: list[str]) -> None:
    inventories = manifest.get("inventories")
    if not isinstance(inventories, dict):
        failures.append("inventories must be an object")
        return

    allow_empty = files_containing(REPO_ROOT / "frontend", ALLOW_EMPTY_TOKENS)
    compare_inventory(
        "allow-empty",
        allow_empty,
        inventories.get("allow_empty_files", []),
        failures,
    )

    runtime_form = files_containing(REPO_ROOT / "frontend", ("<RuntimeFormModal",))
    compare_inventory(
        "runtime-form-fallback",
        runtime_form,
        inventories.get("runtime_form_modal_files", []),
        failures,
    )

    operator_bypass = files_containing(
        REPO_ROOT / "frontend" / "web" / "tests" / "e2e",
        OPERATOR_BYPASS_TOKENS,
    )
    compare_inventory(
        "operator-bypass",
        operator_bypass,
        inventories.get("operator_bypass_files", []),
        failures,
    )

    latest_functions: set[str] = set()
    for root in (
        REPO_ROOT / "frontend" / "packages" / "query-hooks" / "src",
        REPO_ROOT / "frontend" / "web" / "tests" / "e2e",
    ):
        for path in source_files(root):
            for match in LATEST_FUNCTION_RE.finditer(path.read_text()):
                latest_functions.add(f"{relative(path)}::{match.group('name')}")
    classified_latest = inventories.get("latest_function_sites", [])
    compare_inventory(
        "latest-function",
        latest_functions,
        classified_latest,
        failures,
        validate_paths=False,
    )

    semantic = inventories.get("semantic_dispatch_baseline")
    if not isinstance(semantic, dict):
        failures.append("semantic_dispatch_baseline must be an object")
    else:
        root_value = semantic.get("root")
        token = semantic.get("token")
        maximum = semantic.get("max_occurrences")
        if not isinstance(root_value, str) or not isinstance(token, str):
            failures.append("semantic dispatch root/token missing")
        elif not isinstance(maximum, int) or maximum < 0:
            failures.append("semantic dispatch max_occurrences must be a non-negative integer")
        else:
            count = sum(
                path.read_text().count(token)
                for path in source_files(REPO_ROOT / root_value)
                if not path.name.endswith(".test.ts")
            )
            if count > maximum:
                failures.append(
                    f"semantic dispatch debt grew from max {maximum} to {count} occurrences"
                )


def validate_resolved_guards(failures: list[str]) -> None:
    form_modal = (
        REPO_ROOT / "frontend" / "packages" / "ui" / "src" / "forms" / "form-modal.tsx"
    ).read_text()
    guard = form_modal.find("if (!onSubmit) return")
    submit = form_modal.find("await onSubmit(data)")
    close = form_modal.find("onOpenChange(false)", submit)
    if min(guard, submit, close) < 0 or not guard < submit < close:
        failures.append("COV-D01 false-success guard is missing or ordered after submit/close")

    effect = (
        REPO_ROOT
        / "frontend"
        / "packages"
        / "query-hooks"
        / "src"
        / "hooks"
        / "operation-effect.ts"
    ).read_text()
    if 'readonly kind: "converged"' not in effect:
        failures.append("COV-D11 converged outcome vocabulary is missing")
    if 'kind: "applied"' in effect:
        failures.append("COV-D11 observed convergence is mislabeled as applied")


def main() -> int:
    failures: list[str] = []
    try:
        manifest = json.loads(MANIFEST_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"COV-00C census ratchet failed: {error}", file=sys.stderr)
        return 1

    if manifest.get("version") != 1:
        failures.append("manifest version must be 1")
    require_non_empty(manifest, "audited_base", failures)
    if manifest.get("status") != "acceptance-candidate":
        failures.append("manifest status must be acceptance-candidate")

    validate_defects(manifest, failures)
    validate_inventories(manifest, failures)
    validate_resolved_guards(failures)

    if failures:
        print("COV-00C census ratchet failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    open_count = sum(1 for item in manifest["defects"] if item["status"] != "resolved")
    print(
        "COV-00C correctness census: "
        f"{len(manifest['defects'])} classes, {open_count} open/partial, "
        f"{len(manifest['inventories']['allow_empty_files'])} allow-empty files, "
        f"{len(manifest['inventories']['operator_bypass_files'])} operator-bypass files"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
