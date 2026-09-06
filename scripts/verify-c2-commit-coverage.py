#!/usr/bin/env python3
"""Enforce the registered reducer-to-commit coverage contract.

This is deliberately a structural gate. Runtime harnesses prove exact row
ordering and tenant scope; this gate prevents a reducer from silently losing
its single commit recording call or changing its locked operation identity.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


FUNCTION_RE = re.compile(r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
OPERATION_RE = re.compile(r'operation_id\s*:\s*"([^"]+)"')
COMMIT_CALL = "record_organization_commit("
COMMIT_DEFINITION = re.compile(r"\bfn\s+record_organization_commit\s*$")
DOMAIN_MODULE_MARKER = "// ── Domain modules"
DOMAIN_MODULE_END_MARKER = "/// Shared org/company/COA fixture"
PUB_MODULE_RE = re.compile(r"^\s*pub\s+mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;", re.MULTILINE)


class CoverageError(ValueError):
    pass


def _strip_comments(source: str) -> str:
    """Remove Rust comments while preserving string and character literals."""

    out: list[str] = []
    i = 0
    state = "code"
    block_depth = 0
    while i < len(source):
        if state == "code":
            if source.startswith("//", i):
                out.extend("  ")
                i += 2
                state = "line"
            elif source.startswith("/*", i):
                out.extend("  ")
                i += 2
                block_depth = 1
                state = "block"
            elif source[i] == '"':
                out.append(source[i])
                i += 1
                state = "string"
            elif source[i] == "'":
                out.append(source[i])
                i += 1
                state = "char"
            else:
                out.append(source[i])
                i += 1
        elif state == "line":
            if source[i] == "\n":
                out.append("\n")
                i += 1
                state = "code"
            else:
                out.append(" ")
                i += 1
        elif state == "block":
            if source.startswith("/*", i):
                out.extend("  ")
                i += 2
                block_depth += 1
            elif source.startswith("*/", i):
                out.extend("  ")
                i += 2
                block_depth -= 1
                if block_depth == 0:
                    state = "code"
            else:
                out.append("\n" if source[i] == "\n" else " ")
                i += 1
        elif state in {"string", "char"}:
            quote = '"' if state == "string" else "'"
            out.append(source[i])
            if source[i] == "\\":
                if i + 1 < len(source):
                    out.append(source[i + 1])
                    i += 2
                else:
                    i += 1
            else:
                i += 1
                if source[i - 1] == quote:
                    state = "code"
    return "".join(out)


def _matching_brace(source: str, opening: int) -> int:
    depth = 0
    i = opening
    state = "code"
    while i < len(source):
        char = source[i]
        if state == "code":
            if source.startswith("//", i):
                state = "line"
                i += 2
                continue
            if source.startswith("/*", i):
                state = "block"
                i += 2
                continue
            if char == '"':
                state = "string"
            elif char == "'":
                state = "char"
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return i
        elif state == "line":
            if char == "\n":
                state = "code"
        elif state == "block":
            if source.startswith("*/", i):
                state = "code"
                i += 1
        else:
            quote = '"' if state == "string" else "'"
            if char == "\\":
                i += 1
            elif char == quote:
                state = "code"
        i += 1
    raise CoverageError("unterminated Rust function body")


def _function_body(source: str, function_name: str) -> tuple[int, str]:
    clean = _strip_comments(source)
    matches = list(re.finditer(rf"\bfn\s+{re.escape(function_name)}\s*\(", clean))
    if len(matches) != 1:
        raise CoverageError(
            f"expected exactly one function {function_name!r}, found {len(matches)}"
        )
    start = matches[0].start()
    opening = clean.find("{", matches[0].end())
    if opening < 0:
        raise CoverageError(f"function {function_name!r} has no body")
    end = _matching_brace(source, opening)
    return start, clean[opening + 1 : end]


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CoverageError(f"cannot read {path}: {error}") from error


def _canonical_enabled_modules(repo_root: Path) -> frozenset[str]:
    """Return the enabled domain modules from the crate's module census.

    ``spacetimedb/src/lib.rs`` is the source of truth for the public domain
    module map. The census is intersected with directory modules so the
    development-only ``seed.rs`` module is not treated as a business module.
    This keeps the gate tied to the crate's actual enabled module map instead
    of a duplicated count or list in the coverage metadata.
    """

    lib_path = repo_root / "spacetimedb/src/lib.rs"
    try:
        source = lib_path.read_text(encoding="utf-8")
    except OSError as error:
        raise CoverageError(f"cannot read canonical module census {lib_path}: {error}") from error
    start = source.find(DOMAIN_MODULE_MARKER)
    end = source.find(DOMAIN_MODULE_END_MARKER, start + len(DOMAIN_MODULE_MARKER))
    if start < 0 or end < 0:
        raise CoverageError(
            "canonical module census is missing the domain-module section in "
            f"{lib_path.relative_to(repo_root)}"
        )
    declared = set(PUB_MODULE_RE.findall(source[start:end]))
    if not declared:
        raise CoverageError("canonical module census declares no domain modules")

    source_root = repo_root / "spacetimedb/src"
    enabled = frozenset(
        module
        for module in declared
        if (source_root / module).is_dir() and (source_root / module / "mod.rs").is_file()
    )
    if not enabled:
        raise CoverageError("canonical module census has no enabled source modules")
    if "core" not in enabled:
        raise CoverageError("canonical module census must include the core module")
    return enabled


def _module_from_source(source_name: str) -> str:
    """Extract the domain module from a repository-relative Rust source path."""

    parts = Path(source_name).parts
    if len(parts) < 4 or parts[:2] != ("spacetimedb", "src"):
        raise CoverageError(
            "C2 reducer source must identify a domain module under spacetimedb/src: "
            f"{source_name}"
        )
    return parts[2]


def _validate_module_coverage(
    entries: list[dict[str, Any]], expected_modules: frozenset[str]
) -> None:
    """Require at least one registered reducer for every enabled module."""

    covered_modules = {_module_from_source(entry["source"]) for entry in entries}
    unexpected = covered_modules - expected_modules
    if unexpected:
        raise CoverageError(
            "C2 coverage references modules outside the enabled module census: "
            + ", ".join(sorted(unexpected))
        )
    missing = expected_modules - covered_modules
    if missing:
        raise CoverageError(
            "C2 module coverage is missing enabled modules: " + ", ".join(sorted(missing))
        )


def verify(repo_root: Path, metadata_path: Path, operation_ids_path: Path) -> None:
    metadata = _load_json(metadata_path)
    if not isinstance(metadata, dict) or metadata.get("schema_version") != 1:
        raise CoverageError("C2 metadata schema_version must be 1")
    entries = metadata.get("reducers")
    if not isinstance(entries, list) or not entries:
        raise CoverageError("C2 metadata reducers must be a non-empty array")

    operation_ids = _load_json(operation_ids_path)
    locked = operation_ids.get("operations") if isinstance(operation_ids, dict) else None
    if not isinstance(locked, dict):
        raise CoverageError("contract-operation-ids.json operations must be an object")

    seen: set[tuple[str, str]] = set()
    configured_calls: set[tuple[str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise CoverageError("each C2 reducer entry must be an object")
        required = {"source", "function", "operation", "operation_id", "change_constructors"}
        if set(entry) != required:
            raise CoverageError(
                f"C2 reducer entry keys must be {sorted(required)}, got {sorted(entry)}"
            )
        source_name = entry["source"]
        function = entry["function"]
        operation = entry["operation"]
        operation_id = entry["operation_id"]
        constructors = entry["change_constructors"]
        if not all(isinstance(value, str) and value for value in (source_name, function, operation, operation_id)):
            raise CoverageError("C2 reducer source/function/operation values must be non-empty strings")
        source_path = Path(source_name)
        if source_path.is_absolute() or ".." in source_path.parts:
            raise CoverageError(f"C2 reducer source must be repository-relative: {source_name}")
        if not isinstance(constructors, list) or not constructors or any(
            not isinstance(value, str) or not value for value in constructors
        ):
            raise CoverageError(f"C2 reducer {operation} must declare change constructors")
        key = (source_name, function)
        if key in seen:
            raise CoverageError(f"duplicate C2 reducer entry {source_name}:{function}")
        seen.add(key)
        if locked.get(operation) != operation_id:
            raise CoverageError(
                f"{operation}: metadata operation_id {operation_id!r} is not the locked contract ID"
            )
        path = repo_root / source_path
        if not path.is_file():
            raise CoverageError(f"C2 reducer source does not exist: {source_name}")
        source = path.read_text(encoding="utf-8")
        _, body = _function_body(source, function)
        commit_call_count = body.count(COMMIT_CALL)
        if commit_call_count < 1:
            raise CoverageError(
                f"{source_name}:{function} must call record_organization_commit on its write paths"
            )
        operation_matches = OPERATION_RE.findall(body)
        if operation_matches.count(operation_id) != commit_call_count:
            raise CoverageError(
                f"{source_name}:{function} must use locked operation_id {operation_id!r} for every commit call"
            )
        if "OrganizationCommitInput" not in body or "changes" not in body:
            raise CoverageError(f"{source_name}:{function} must construct a complete commit input")
        for constructor in constructors:
            if f"RowChange::{constructor}" not in body:
                raise CoverageError(f"{source_name}:{function} lacks RowChange::{constructor}")
        if ".organization_commit()" in body or ".organization_row_change()" in body:
            raise CoverageError(
                f"{source_name}:{function} must use the persistence helper, not direct commit-table writes"
            )
        configured_calls.add(key)

    _validate_module_coverage(entries, _canonical_enabled_modules(repo_root))

    # Every active helper call in the module must be registered. This catches
    # newly instrumented reducers that forgot to extend the metadata contract.
    source_root = repo_root / "spacetimedb/src"
    for path in sorted(source_root.rglob("*.rs")):
        source = path.read_text(encoding="utf-8")
        clean = _strip_comments(source)
        for match in re.finditer(re.escape(COMMIT_CALL), clean):
            prefix = clean[: match.start()]
            # In the declaration the matched text is the function name after
            # `fn`, rather than a call expression.
            if prefix.rstrip().endswith("fn"):
                continue
            functions = list(FUNCTION_RE.finditer(prefix))
            if not functions:
                raise CoverageError(f"commit helper call outside a function: {path}")
            function = functions[-1].group(1)
            key = (str(path.relative_to(repo_root)), function)
            if key not in configured_calls:
                raise CoverageError(f"unregistered C2 commit call at {key[0]}:{function}")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    metadata = repo_root / "lumiere-codegen/c2-commit-coverage.json"
    operation_ids = repo_root / "lumiere-codegen/contract-operation-ids.json"
    try:
        verify(repo_root, metadata, operation_ids)
    except CoverageError as error:
        raise SystemExit(f"verify-c2-commit-coverage: {error}") from error
    print("verify-c2-commit-coverage: valid")


if __name__ == "__main__":
    main()
