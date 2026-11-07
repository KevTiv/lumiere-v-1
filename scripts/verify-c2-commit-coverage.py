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


FUNCTION_RE = re.compile(r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<[^{};]*>)?\s*\(")
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
    matches = list(re.finditer(rf"\bfn\s+{re.escape(function_name)}(?:\s*<[^{{}};]*>)?\s*\(", clean))
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
        allowed = required | {"change_helpers"}
        if not required.issubset(entry) or not set(entry).issubset(allowed):
            raise CoverageError(
                f"C2 reducer entry keys must include {sorted(required)} and may include "
                f"change_helpers, got {sorted(entry)}"
            )
        source_name = entry["source"]
        function = entry["function"]
        operation = entry["operation"]
        operation_id = entry["operation_id"]
        constructors = entry["change_constructors"]
        change_helpers = entry.get("change_helpers", [])
        if not all(isinstance(value, str) and value for value in (source_name, function, operation, operation_id)):
            raise CoverageError("C2 reducer source/function/operation values must be non-empty strings")
        source_path = Path(source_name)
        if source_path.is_absolute() or ".." in source_path.parts:
            raise CoverageError(f"C2 reducer source must be repository-relative: {source_name}")
        if not isinstance(constructors, list) or not constructors or any(
            not isinstance(value, str) or not value for value in constructors
        ):
            raise CoverageError(f"C2 reducer {operation} must declare change constructors")
        if not isinstance(change_helpers, list) or any(
            not isinstance(value, str) or not value for value in change_helpers
        ):
            raise CoverageError(f"C2 reducer {operation} change_helpers must be function names")
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
        change_bodies = [body]
        for helper in change_helpers:
            _, helper_body = _function_body(source, helper)
            change_bodies.append(helper_body)
        for constructor in constructors:
            if not any(f"RowChange::{constructor}" in candidate for candidate in change_bodies):
                raise CoverageError(f"{source_name}:{function} lacks RowChange::{constructor}")
        if ".organization_commit()" in body or ".organization_row_change()" in body:
            raise CoverageError(
                f"{source_name}:{function} must use the persistence helper, not direct commit-table writes"
            )
        configured_calls.add(key)

    _validate_dynamic_commit_helpers(repo_root, metadata, locked, configured_calls)
    _validate_evidence_journals(repo_root, metadata, locked, configured_calls)
    _validate_conditional_outcomes(repo_root, metadata, locked, configured_calls)

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


def _relative_source(repo_root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value:
        raise CoverageError("history registration source must be a non-empty relative path")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise CoverageError("history registration source must be repository-relative")
    return repo_root / path


def _validate_evidence_journals(repo_root: Path, metadata: dict[str, Any], locked: dict[str, Any],
                                 configured_calls: set[tuple[str, str]]) -> None:
    """Register a restricted evidence append, without granting C2 source coverage."""
    entries = metadata.get("evidence_journals", [])
    if not isinstance(entries, list):
        raise CoverageError("evidence_journals must be an array")
    for entry in entries:
        required = {"source", "function", "classification", "owner_policy", "entry_points",
                    "evidence_tables", "passthrough_helpers"}
        if not isinstance(entry, dict) or set(entry) != required:
            raise CoverageError("evidence journal registration has invalid keys")
        if entry["classification"] != "evidence-only-not-complete-business-outcome":
            raise CoverageError("evidence journal cannot claim complete business outcome coverage")
        if entry["entry_points"] != ["write_business_audit", "write_private_business_audit"]:
            raise CoverageError("evidence journal entry points must be the native private audit wrappers")
        allowed = {"audit_log", "business_change", "organization_business_change"}
        if set(entry["evidence_tables"]) != allowed:
            raise CoverageError("evidence journal can only append audit and private evidence tables")
        source = _relative_source(repo_root, entry["source"]).read_text(encoding="utf-8")
        key = (entry["source"], entry["function"])
        if key in configured_calls:
            raise CoverageError("evidence journal cannot also be a complete outcome owner")
        _, body = _function_body(source, entry["function"])
        if body.count(COMMIT_CALL) != 1 or not re.search(r'operation_id\s*:\s*format!\("erp\.\{operation\}"\)', body):
            raise CoverageError("evidence journal must use one producer-owned canonical operation expression")
        guard = re.search(r"if\s+standalone_journal_blocked\(operation\)\?\s*\{", body)
        if guard is None:
            raise CoverageError("evidence journal must check the complete-owner policy before capture")
        end = _matching_brace(body, guard.end() - 1)
        guard_body = body[guard.end():end]
        if "write_audit_log_v2_returning(" not in guard_body or "return Ok(())" not in guard_body:
            raise CoverageError("guarded complete owners must retain legacy audit without a new journal")
        captured = re.search(r"let\s+rows\s*=\s*capture_business_audit_inner\s*\(", body)
        if captured is None or captured.start() <= end or body.index(COMMIT_CALL) <= captured.start():
            raise CoverageError("evidence journal policy guard must precede evidence capture and append")
        if not re.search(r"changes\s*:\s*rows\b", body) or re.search(r"\brows\s*\.\s*(?:push|extend|insert)\s*\(", body):
            raise CoverageError("evidence journal must append only its immutable evidence vector")
        _, capture = _function_body(source, "capture_business_audit_inner")
        tables = set(re.findall(r'RowChange::upsert_stdb_row\(\s*"([^"]+)"', capture))
        if tables != allowed or COMMIT_CALL in capture:
            raise CoverageError("evidence capture cannot journal business sources or recursively commit")
        policy_path = _relative_source(repo_root, entry["owner_policy"])
        policy = _load_json(policy_path)
        if policy.get("schema_version") != 1 or policy.get("policy") != "standalone-journal-blocked-until-exact-owner-envelope-integration":
            raise CoverageError("unsupported evidence journal owner policy")
        blocked = policy.get("standalone_blocked_operations")
        if not isinstance(blocked, dict) or not blocked or any(operation not in locked for operation in blocked):
            raise CoverageError("evidence journal owner policy must use locked producer operations")
        _, policy_body = _function_body(source, "standalone_journal_blocked")
        if policy_path.name not in policy_body or '"standalone_blocked_operations"' not in policy_body or "policy.contains(operation)" not in policy_body:
            raise CoverageError("evidence journal must enforce its declared owner policy")
        for wrapper, private in zip(entry["entry_points"], ("false", "true")):
            _, wrapper_body = _function_body(source, wrapper)
            expected = rf"write_business_audit_inner\(\s*ctx,\s*organization_id,\s*operation,\s*params,\s*{private}\s*\)"
            if re.fullmatch(rf"\s*{expected}\s*", wrapper_body) is None:
                raise CoverageError("native audit wrapper must forward the producer-owned operation unchanged")
        passthroughs = {}
        for helper in entry["passthrough_helpers"]:
            if set(helper) != {"source", "function", "parameter", "operations"} or helper["parameter"] != "operation":
                raise CoverageError("invalid native operation passthrough registration")
            if not helper["operations"] or any(op not in locked for op in helper["operations"]):
                raise CoverageError("native operation passthrough must use locked operations")
            helper_source = _relative_source(repo_root, helper["source"]).read_text(encoding="utf-8")
            _, helper_body = _function_body(helper_source, helper["function"])
            if not re.search(r"write_business_audit\(\s*ctx,\s*organization_id,\s*operation,", helper_body):
                raise CoverageError("native operation passthrough does not forward the declared operation")
            literal_calls = re.findall(rf'\b{re.escape(helper["function"])}\(\s*ctx,\s*organization_id,\s*"([^"\n]+)"', _strip_comments(helper_source))
            if set(literal_calls) != set(helper["operations"]):
                raise CoverageError("native operation passthrough callers differ from their closed operation set")
            passthroughs[(helper["source"], helper["function"])] = helper["parameter"]
        for path in sorted((repo_root / "spacetimedb/src").rglob("*.rs")):
            clean = _strip_comments(path.read_text(encoding="utf-8"))
            for match in re.finditer(r'\b(?:write_business_audit|write_private_business_audit)\(\s*[^,]+,\s*[^,]+,\s*([^,]+),', clean):
                prefix = clean[:match.start()]
                if prefix.rstrip().endswith("fn"):
                    continue
                definitions = list(FUNCTION_RE.finditer(prefix))
                if not definitions:
                    raise CoverageError("native history producer outside a function")
                site = (path.relative_to(repo_root).as_posix(), definitions[-1].group(1))
                argument = match.group(1).strip()
                if re.fullmatch(r'"[A-Za-z_][A-Za-z0-9_]*"', argument):
                    if argument[1:-1] not in locked:
                        raise CoverageError(f"native history producer uses unlocked operation: {argument}")
                elif passthroughs.get(site) != argument:
                    raise CoverageError(f"native history operation is not a closed producer literal at {site}")
            for match in re.finditer(r"\bwrite_business_audit_inner\(", clean):
                prefix = clean[:match.start()]
                if prefix.rstrip().endswith("fn"):
                    continue
                definitions = list(FUNCTION_RE.finditer(prefix))
                site = (path.relative_to(repo_root).as_posix(), definitions[-1].group(1) if definitions else "")
                if site[0] != entry["source"] or site[1] not in entry["entry_points"]:
                    raise CoverageError("evidence journal can only be called by its declared native wrappers")
        configured_calls.add(key)


def _validate_conditional_outcomes(repo_root: Path, metadata: dict[str, Any], locked: dict[str, Any],
                                    configured_calls: set[tuple[str, str]]) -> None:
    """Recognize a scoped source outcome without certifying the whole operation."""
    entries = metadata.get("conditional_outcomes", [])
    if not isinstance(entries, list):
        raise CoverageError("conditional_outcomes must be an array")
    for entry in entries:
        required = {"source", "function", "operation", "operation_id", "classification", "target_selector",
                    "targets", "change_constructors", "change_helpers"}
        if not isinstance(entry, dict) or set(entry) != required:
            raise CoverageError("conditional outcome registration has invalid keys")
        if entry["classification"] != "partial-control-flow-not-universal-C2-coverage":
            raise CoverageError("conditional outcome cannot claim universal C2 coverage")
        if locked.get(entry["operation"]) != entry["operation_id"]:
            raise CoverageError("conditional outcome operation must use its locked identity")
        if entry["target_selector"] != "job.table_name" or set(entry["targets"]) != {
            "product", "contact", "stock_location", "account_move", "account_move_line"
        }:
            raise CoverageError("conditional tracked import target scope requires explicit source-owner review")
        source = _relative_source(repo_root, entry["source"]).read_text(encoding="utf-8")
        _, body = _function_body(source, entry["function"])
        key = (entry["source"], entry["function"])
        if key in configured_calls:
            raise CoverageError("conditional outcome cannot also be a universal complete owner")
        if body.count(COMMIT_CALL) != 1 or OPERATION_RE.findall(body) != [entry["operation_id"]]:
            raise CoverageError("conditional outcome must have one exact locked source commit")
        guard = re.search(r'if\s+!matches!\(\s*job\.table_name\.as_str\(\),\s*([^)]*)\)\s*\{\s*return Ok\(\(\)\);', body)
        if guard is None or set(re.findall(r'"([^"\n]+)"', guard.group(1))) != set(entry["targets"]):
            raise CoverageError("conditional import owner must fail out before unadmitted target effects")
        if "merge_business_audit_changes(changes, evidence)?" not in body or "audit_matches(" not in body or "found != 1" not in body:
            raise CoverageError("conditional import owner requires exact staged evidence merged with its source outcome")
        for token in ('"correlation_version"', '"request_id"', '"sha256"', '"import_job"', '"import_job_record"', '"import_job_error"'):
            if token not in body:
                raise CoverageError("conditional import owner lost its sealed native provenance or row outcomes")
        helpers = [body]
        for helper in entry["change_helpers"]:
            helpers.append(_function_body(source, helper)[1])
        for constructor in entry["change_constructors"]:
            if not any(f"RowChange::{constructor}" in candidate for candidate in helpers):
                raise CoverageError("conditional import owner lost its typed source row construction")
        configured_calls.add(key)


def _validate_dynamic_commit_helpers(
    repo_root: Path,
    metadata: dict[str, Any],
    locked: dict[str, str],
    configured_calls: set[tuple[str, str]],
) -> None:
    """Permit only registered, closed operation sets through a scoped dispatcher.

    A dynamic helper cannot invent an operation ID: its commit must copy the
    declared string parameter, and every call is checked against locked literal
    IDs (or a local two-literal selector). The ordinary global commit-call scan
    still registers and checks the helper's direct persistence call.
    """
    helpers = metadata.get("dynamic_commit_helpers", [])
    if not isinstance(helpers, list):
        raise CoverageError("dynamic_commit_helpers must be an array")
    for helper in helpers:
        required = {
            "source", "function", "operation_id_parameter", "snapshot_type",
            "method", "change_constructors", "change_helpers", "callers",
        }
        if not isinstance(helper, dict) or set(helper) != required:
            raise CoverageError("dynamic commit helper must declare its exact scope and callers")
        source_name = helper["source"]
        function = helper["function"]
        parameter = helper["operation_id_parameter"]
        snapshot_type = helper["snapshot_type"]
        method = helper["method"]
        for value in (source_name, function, parameter, snapshot_type, method):
            if not isinstance(value, str) or not value:
                raise CoverageError("dynamic helper names must be non-empty strings")
        source_path = Path(source_name)
        if source_path.is_absolute() or ".." in source_path.parts:
            raise CoverageError("dynamic helper source must be repository-relative")
        key = (source_name, function)
        if key in configured_calls:
            raise CoverageError(f"duplicate dynamic helper {source_name}:{function}")
        source = (repo_root / source_path).read_text(encoding="utf-8")
        start, body = _function_body(source, function)
        clean_source = _strip_comments(source)
        impls = list(re.finditer(rf"\bimpl\s+{re.escape(snapshot_type)}\s*\{{", clean_source))
        if method != function or not any(
            match.end() <= start <= _matching_brace(clean_source, match.end() - 1)
            for match in impls
        ):
            raise CoverageError("dynamic helper must be the declared snapshot method")
        signature = _strip_comments(source)[start:].split("{", 1)[0]
        if not re.search(rf"\b{re.escape(parameter)}\s*:\s*&str\b", signature):
            raise CoverageError("dynamic helper must declare its string operation-ID parameter")
        if body.count(COMMIT_CALL) != 1 or OPERATION_RE.findall(body):
            raise CoverageError("dynamic helper must contain one commit call and no literal operation override")
        if not re.search(rf"operation_id\s*:\s*{re.escape(parameter)}\s*\.\s*to_string\s*\(\s*\)", body):
            raise CoverageError("dynamic helper must forward the declared operation-ID parameter")
        if re.search(rf"\blet\s+(?:mut\s+)?{re.escape(parameter)}\b", body):
            raise CoverageError("dynamic helper must not shadow its operation-ID parameter")
        if "OrganizationCommitInput" not in body or "changes" not in body:
            raise CoverageError("dynamic helper must construct a complete commit input")
        if ".organization_commit()" in body or ".organization_row_change()" in body:
            raise CoverageError("dynamic helper must not write commit tables directly")
        constructors = helper["change_constructors"]
        change_helpers = helper["change_helpers"]
        if not isinstance(constructors, list) or not constructors or any(
            not isinstance(value, str) or not value for value in constructors
        ) or not isinstance(change_helpers, list) or any(
            not isinstance(value, str) or not value for value in change_helpers
        ):
            raise CoverageError("dynamic helper must declare change constructors and helper names")
        change_bodies = [body] + [_function_body(source, name)[1] for name in change_helpers]
        for constructor in constructors:
            if not any(f"RowChange::{constructor}" in candidate for candidate in change_bodies):
                raise CoverageError(f"dynamic helper lacks RowChange::{constructor}")
        callers = helper["callers"]
        if not isinstance(callers, list) or not callers:
            raise CoverageError("dynamic helper must declare every operation caller")
        configured_sites: set[tuple[str, str]] = set()
        call_pattern = re.compile(rf"\.\s*{re.escape(method)}\s*\(\s*ctx\s*,\s*(\"[^\"]+\"|[A-Za-z_][A-Za-z0-9_]*)\s*\)")
        for caller in callers:
            if not isinstance(caller, dict) or set(caller) != {"source", "function", "argument", "operations"}:
                raise CoverageError("dynamic caller must declare source/function/argument/operations")
            caller_source = caller["source"]
            caller_function = caller["function"]
            argument = caller["argument"]
            if not all(isinstance(value, str) and value for value in (caller_source, caller_function, argument)):
                raise CoverageError("dynamic caller names must be non-empty strings")
            caller_path = Path(caller_source)
            if caller_path.is_absolute() or ".." in caller_path.parts:
                raise CoverageError("dynamic caller source must be repository-relative")
            site = (caller_source, caller_function)
            if site in configured_sites:
                raise CoverageError("duplicate dynamic commit caller")
            configured_sites.add(site)
            caller_text = (repo_root / caller_path).read_text(encoding="utf-8")
            _, caller_body = _function_body(caller_text, caller_function)
            arguments = call_pattern.findall(caller_body)
            if arguments != [argument]:
                raise CoverageError(f"{caller_source}:{caller_function} must call the snapshot recorder exactly once with its declared argument")
            operations = caller["operations"]
            if not isinstance(operations, dict) or not operations or any(
                not isinstance(name, str) or not isinstance(identity, str)
                or locked.get(name) != identity for name, identity in operations.items()
            ):
                raise CoverageError("dynamic caller operation IDs must equal locked contract IDs")
            expected_ids = set(operations.values())
            if argument.startswith('"'):
                if expected_ids != {argument[1:-1]}:
                    raise CoverageError("dynamic caller literal must equal its locked operation ID")
            else:
                # Explicitly bounded Rust syntax: a local if/else whose two
                # branches are operation literals, never a caller-supplied ID.
                selector = re.search(
                    rf'\blet\s+{re.escape(argument)}\s*=\s*if\s+[^{{;]+\{{\s*"([^"]+)"\s*\}}\s*else\s*\{{\s*"([^"]+)"\s*\}}\s*;',
                    caller_body,
                )
                bindings = re.findall(rf"\blet\s+(?:mut\s+)?{re.escape(argument)}\b", caller_body)
                if selector is None or len(bindings) != 1 or set(selector.groups()) != expected_ids:
                    raise CoverageError("dynamic caller must use a local closed two-literal operation selector")
        # Scope method scanning to files that name this snapshot type. Every
        # matching recorder call there must belong to an enumerated caller.
        for path in sorted((repo_root / "spacetimedb/src").rglob("*.rs")):
            clean = _strip_comments(path.read_text(encoding="utf-8"))
            if snapshot_type not in clean:
                continue
            for match in re.finditer(rf"\.\s*{re.escape(method)}\s*\(", clean):
                functions = list(FUNCTION_RE.finditer(clean[:match.start()]))
                if not functions:
                    raise CoverageError("dynamic recorder call outside a function")
                site = (str(path.relative_to(repo_root)), functions[-1].group(1))
                if site not in configured_sites:
                    raise CoverageError(f"unregistered dynamic C2 recorder call at {site[0]}:{site[1]}")
        configured_calls.add(key)


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
