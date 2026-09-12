#!/usr/bin/env python3
"""Verify the authored history of canonical contract operation identities.

The history is deliberately keyed by ``contract_operation_id``.  A history
entry records the operation name and a fingerprint of the operation's
structural contract.  Operation identity and source provenance are not part
of that fingerprint: identity is checked directly and provenance belongs to
the IR artifact, not to an operation shape.

Canonicalization is UTF-8 JSON with recursively sorted object keys, compact
separators, and no insignificant whitespace. SpacetimeDB typespace references
are replaced with their stable type names before hashing; their numeric
indices are allocation details that change when unrelated types are added.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IR = ROOT / ".contracts-staging/ir/lumiere-contract-ir-v2.json"
DEFAULT_HISTORY = ROOT / "lumiere-codegen/contract-operation-history.json"
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
OPERATION_ID = re.compile(r"^erp\.[a-z0-9_]+$")

HISTORY_FIELDS = {
    "schema_version",
    "ir_version",
    "fingerprint",
    "operations",
    "retired_ids",
    "compatibility_exceptions",
}
HISTORY_V3_FIELDS = HISTORY_FIELDS | {"revisions"}
FINGERPRINT_FIELDS = {"algorithm", "canonicalization"}
OPERATION_HISTORY_FIELDS = {"name", "shape_fingerprint"}
EXCEPTION_FIELDS = {"operation_id", "previous_fingerprint", "current_fingerprint", "reason"}
REVISION_FIELDS = {
    "previous_release",
    "previous_ir_sha256",
    "previous_operations_fingerprint",
    "current_operations_fingerprint",
    "operation_count",
    "reason",
}


class OperationHistoryError(ValueError):
    """Raised when an IR and operation history do not agree."""


def fail(message: str) -> None:
    raise OperationHistoryError(f"verify-operation-history: {message}")


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def _array(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{label} must be an array")
    return value


def _exact_fields(value: dict[str, Any], expected: set[str], label: str) -> None:
    unknown = set(value) - expected
    missing = expected - set(value)
    if unknown:
        fail(f"{label} has unknown fields: {', '.join(sorted(unknown))}")
    if missing:
        fail(f"{label} is missing fields: {', '.join(sorted(missing))}")


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"{label} does not exist: {path}")
    except json.JSONDecodeError as error:
        fail(f"{label} is invalid JSON: {error}")
    except OSError as error:
        fail(f"cannot read {label}: {error}")
    return _object(value, label)


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _without_operation_identity(value: dict[str, Any]) -> dict[str, Any]:
    result = dict(value)
    result.pop("name", None)
    result.pop("contract_operation_id", None)
    result.pop("contract_operation_id_status", None)
    return result


def _type_reference_names(ir: dict[str, Any]) -> dict[int, list[str]]:
    references: dict[int, list[str]] = {}
    for position, raw_type in enumerate(_array(ir.get("types", []), "IR types")):
        type_entry = _object(raw_type, f"IR type {position}")
        index = type_entry.get("index")
        names = type_entry.get("names")
        if not isinstance(index, int) or index < 0:
            fail(f"IR type {position} has an invalid index")
        if index in references:
            fail(f"IR types contain duplicate index {index}")
        if not isinstance(names, list) or not names or not all(
            isinstance(name, str) and name for name in names
        ):
            fail(f"IR type {index} referenced by an operation must have stable names")
        references[index] = sorted(names)
    return references


def _semantic_type_references(value: Any, type_names: dict[int, list[str]]) -> Any:
    if isinstance(value, list):
        return [_semantic_type_references(item, type_names) for item in value]
    if not isinstance(value, dict):
        return value
    result: dict[str, Any] = {}
    for key, item in value.items():
        if key == "Ref":
            if not isinstance(item, int) or item not in type_names:
                fail(f"operation schema references unknown type index {item!r}")
            result[key] = {"type_names": type_names[item]}
        else:
            result[key] = _semantic_type_references(item, type_names)
    return result


def operation_shape(
    operation: dict[str, Any], type_names: dict[int, list[str]] | None = None
) -> dict[str, Any]:
    """Return the fail-closed structural projection used for hashing.

    ``name`` and ``contract_operation_id`` are identity, not shape.  The
    operation schema's parameter names remain structural and are retained.
    All other fields are structural unless explicitly listed as provenance,
    so newly introduced contract semantics cannot bypass history review.
    """

    shape = copy.deepcopy(operation)
    for field in (
        "name",
        "contract_operation_id",
        "contract_operation_id_status",
        "source_commit",
        "source_dirty",
        "source_repository",
        "generated_at",
        "generator_version",
    ):
        shape.pop(field, None)
    application = _object(shape.get("application"), "operation application")
    shape["application"] = _without_operation_identity(application)
    schema = _object(shape.get("schema"), "operation schema")
    shape["schema"] = _without_operation_identity(schema)
    if type_names is not None:
        shape["schema"] = _semantic_type_references(shape["schema"], type_names)
    # The concrete reducer/procedure target is contract shape. Retaining its
    # name ensures an operation ID cannot silently redirect to another action.
    _object(shape.get("target"), "operation target")
    return shape


def shape_fingerprint(
    operation: dict[str, Any], type_names: dict[int, list[str]] | None = None
) -> str:
    return "sha256:" + hashlib.sha256(
        _canonical_json(operation_shape(operation, type_names))
    ).hexdigest()


def operation_set_fingerprint(operations: dict[str, dict[str, Any]]) -> str:
    """Fingerprint an ordered operation-history map for a bounded bulk revision."""

    return "sha256:" + hashlib.sha256(_canonical_json(operations)).hexdigest()


def _validate_operation_id(operation_id: Any, label: str) -> str:
    if not isinstance(operation_id, str) or not OPERATION_ID.fullmatch(operation_id):
        fail(f"{label} must be a canonical erp.* operation ID")
    return operation_id


def _current_operations(ir: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if ir.get("ir_version") != 2:
        fail(f"IR must be v2, got {ir.get('ir_version')!r}")
    operations = _array(ir.get("operations"), "IR operations")
    by_id: dict[str, dict[str, Any]] = {}
    for index, raw_operation in enumerate(operations):
        operation = _object(raw_operation, f"IR operation {index}")
        name = operation.get("name")
        if not isinstance(name, str) or not name:
            fail(f"IR operation {index} has no non-empty name")
        operation_id = _validate_operation_id(
            operation.get("contract_operation_id"), f"IR operation {name} contract_operation_id"
        )
        if operation_id in by_id:
            fail(f"duplicate current contract_operation_id {operation_id}")
        by_id[operation_id] = operation
    return by_id


def _validate_history(history: dict[str, Any]) -> None:
    schema_version = history.get("schema_version")
    if schema_version == 2:
        _exact_fields(history, HISTORY_FIELDS, "operation history")
    elif schema_version == 3:
        _exact_fields(history, HISTORY_V3_FIELDS, "operation history")
    else:
        fail(f"unsupported operation history schema_version {history['schema_version']!r}")
    if history["ir_version"] != 2:
        fail(f"operation history must target IR v2, got {history['ir_version']!r}")
    fingerprint = _object(history["fingerprint"], "operation history fingerprint")
    _exact_fields(fingerprint, FINGERPRINT_FIELDS, "operation history fingerprint")
    if fingerprint["algorithm"] != "sha256":
        fail("operation history fingerprint algorithm must be sha256")
    if fingerprint["canonicalization"] != "json_sorted_keys_semantic_type_refs":
        fail("operation history uses unsupported canonicalization")
    operations = _object(history["operations"], "operation history operations")
    if list(operations) != sorted(operations):
        fail("operation history operations must be sorted by contract_operation_id")
    for operation_id, raw_entry in operations.items():
        _validate_operation_id(operation_id, "operation history operation key")
        entry = _object(raw_entry, f"operation history entry {operation_id}")
        _exact_fields(entry, OPERATION_HISTORY_FIELDS, f"operation history entry {operation_id}")
        if not isinstance(entry["name"], str) or not entry["name"]:
            fail(f"operation history entry {operation_id} name must be non-empty")
        if not isinstance(entry["shape_fingerprint"], str) or not SHA256.fullmatch(
            entry["shape_fingerprint"]
        ):
            fail(f"operation history entry {operation_id} has invalid shape_fingerprint")
    retired_ids = _array(history["retired_ids"], "retired_ids")
    if retired_ids != sorted(retired_ids):
        fail("retired_ids must be sorted")
    if len(retired_ids) != len(set(retired_ids)):
        fail("retired_ids must not contain duplicates")
    for operation_id in retired_ids:
        _validate_operation_id(operation_id, "retired_ids entry")
    exceptions = _array(history["compatibility_exceptions"], "compatibility_exceptions")
    exception_ids: set[str] = set()
    for index, raw_exception in enumerate(exceptions):
        exception = _object(raw_exception, f"compatibility exception {index}")
        _exact_fields(exception, EXCEPTION_FIELDS, f"compatibility exception {index}")
        operation_id = _validate_operation_id(
            exception["operation_id"], f"compatibility exception {index} operation_id"
        )
        if operation_id in exception_ids:
            fail(f"duplicate compatibility exception for {operation_id}")
        exception_ids.add(operation_id)
        for field in ("previous_fingerprint", "current_fingerprint"):
            if not isinstance(exception[field], str) or not SHA256.fullmatch(exception[field]):
                fail(f"compatibility exception {index} has invalid {field}")
        if not isinstance(exception["reason"], str) or not exception["reason"].strip():
            fail(f"compatibility exception {index} reason must be non-empty")
    revisions = _array(history.get("revisions", []), "revisions")
    previous_current: str | None = None
    for index, raw_revision in enumerate(revisions):
        revision = _object(raw_revision, f"history revision {index}")
        _exact_fields(revision, REVISION_FIELDS, f"history revision {index}")
        if not isinstance(revision["previous_release"], str) or not revision[
            "previous_release"
        ].strip():
            fail(f"history revision {index} previous_release must be non-empty")
        for field in (
            "previous_ir_sha256",
            "previous_operations_fingerprint",
            "current_operations_fingerprint",
        ):
            if not isinstance(revision[field], str) or not SHA256.fullmatch(
                revision[field]
            ):
                fail(f"history revision {index} has invalid {field}")
        if not isinstance(revision["operation_count"], int) or revision[
            "operation_count"
        ] < 1:
            fail(f"history revision {index} operation_count must be positive")
        if not isinstance(revision["reason"], str) or not revision["reason"].strip():
            fail(f"history revision {index} reason must be non-empty")
        if (
            previous_current is not None
            and revision["previous_operations_fingerprint"] != previous_current
        ):
            fail(f"history revision {index} does not continue the fingerprint chain")
        previous_current = revision["current_operations_fingerprint"]
    if revisions:
        current_fingerprint = operation_set_fingerprint(operations)
        if revisions[-1]["current_operations_fingerprint"] != current_fingerprint:
            fail("latest history revision does not bind the recorded operation baseline")


def verify(
    ir_path: Path,
    history_path: Path,
    *,
    allow_previous_compatibility: bool = False,
) -> None:
    """Verify ``history_path`` against the pinned IR at ``ir_path``."""

    ir = _load_json(ir_path, "IR")
    history = _load_json(history_path, "operation history")
    _validate_history(history)
    current = _current_operations(ir)
    type_names = _type_reference_names(ir)
    historical = history["operations"]
    retired = set(history["retired_ids"])
    current_ids = set(current)
    historical_ids = set(historical)
    # A pinned previous release may still contain IDs retired by the candidate
    # history. The candidate IR itself must never reuse those tombstones.
    reused = (current_ids & retired) if not allow_previous_compatibility else set()
    if reused:
        fail(f"current operation IDs reuse retired IDs: {', '.join(sorted(reused))}")
    active_retired = historical_ids & retired
    if active_retired:
        fail(
            "operation history keeps retired IDs active: "
            + ", ".join(sorted(active_retired))
        )
    missing = historical_ids - current_ids
    added = current_ids - historical_ids
    unretired_missing = missing - retired
    unretired_added = added - retired if allow_previous_compatibility else added
    if (unretired_missing and not allow_previous_compatibility) or unretired_added:
        details = []
        if unretired_missing and not allow_previous_compatibility:
            details.append(f"missing current IDs={sorted(unretired_missing)!r}")
        if unretired_added:
            details.append(f"unrecorded current IDs={sorted(unretired_added)!r}")
        fail("current operation ID set changed; " + "; ".join(details))
    exceptions = {
        exception["operation_id"]: exception
        for exception in history["compatibility_exceptions"]
    }
    unknown_exceptions = set(exceptions) - current_ids - (
        unretired_missing if allow_previous_compatibility else set()
    )
    if unknown_exceptions:
        fail(
            "compatibility exceptions target unknown operation IDs: "
            + ", ".join(sorted(unknown_exceptions))
        )
    if set(exceptions) & retired:
        fail("compatibility exceptions cannot target retired IDs")
    actual_operations = {
        operation_id: {
            "name": current[operation_id]["name"],
            "shape_fingerprint": shape_fingerprint(current[operation_id], type_names),
        }
        for operation_id in sorted(current_ids & historical_ids)
    }
    previous_revision_match = False
    if allow_previous_compatibility and current_ids == historical_ids:
        actual_set_fingerprint = operation_set_fingerprint(actual_operations)
        previous_revision_match = any(
            revision["operation_count"] == len(actual_operations)
            and revision["previous_operations_fingerprint"] == actual_set_fingerprint
            for revision in history.get("revisions", [])
        )
    for operation_id in sorted(current_ids & historical_ids):
        operation = current[operation_id]
        entry = historical[operation_id]
        current_name = operation["name"]
        if entry["name"] != current_name:
            fail(
                f"operation ID {operation_id} changed name from {entry['name']!r} to {current_name!r}"
            )
        actual = shape_fingerprint(operation, type_names)
        expected = entry["shape_fingerprint"]
        if previous_revision_match:
            continue
        if actual == expected:
            if operation_id in exceptions:
                exception = exceptions[operation_id]
                is_previous_release = (
                    allow_previous_compatibility
                    and exception["previous_fingerprint"] == actual
                    and exception["current_fingerprint"] != actual
                )
                if not is_previous_release and (
                    exception["previous_fingerprint"] != expected
                    or exception["current_fingerprint"] != actual
                ):
                    fail(f"compatibility exception for {operation_id} does not match the recorded shape")
            continue
        exception = exceptions.get(operation_id)
        if exception is None:
            fail(
                f"unapproved shape change for {operation_id}: "
                f"expected {expected}, got {actual}"
            )
        if exception["previous_fingerprint"] != expected or exception["current_fingerprint"] != actual:
            fail(f"compatibility exception for {operation_id} does not match the shape change")


def build_history(ir_path: Path) -> dict[str, Any]:
    """Build a deterministic authored history document from an IR snapshot."""

    ir = _load_json(ir_path, "IR")
    return build_history_from_value(ir)


def build_history_from_value(ir: dict[str, Any]) -> dict[str, Any]:
    """Build a deterministic history document from an already-loaded IR."""

    current = _current_operations(ir)
    type_names = _type_reference_names(ir)
    operations = {
        operation_id: {
            "name": operation["name"],
            "shape_fingerprint": shape_fingerprint(operation, type_names),
        }
        for operation_id, operation in sorted(current.items())
    }
    return {
        "schema_version": 3,
        "ir_version": 2,
        "fingerprint": {
            "algorithm": "sha256",
            "canonicalization": "json_sorted_keys_semantic_type_refs",
        },
        "operations": operations,
        "retired_ids": [],
        "compatibility_exceptions": [],
        "revisions": [],
    }


def advance_history(
    ir_path: Path,
    history_path: Path,
    *,
    previous_release: str,
    previous_ir_sha256: str,
    reason: str,
) -> dict[str, Any]:
    """Advance every operation shape as one exact, release-bound revision."""

    previous = _load_json(history_path, "operation history")
    _validate_history(previous)
    current = build_history(ir_path)
    previous_operations = copy.deepcopy(previous["operations"])
    for exception in previous["compatibility_exceptions"]:
        operation_id = exception["operation_id"]
        if operation_id in previous_operations:
            previous_operations[operation_id]["shape_fingerprint"] = exception[
                "current_fingerprint"
            ]
    if set(previous_operations) != set(current["operations"]):
        fail("bulk history revision requires an unchanged active operation ID set")
    for operation_id, entry in previous_operations.items():
        if entry["name"] != current["operations"][operation_id]["name"]:
            fail(f"bulk history revision cannot rename {operation_id}")
    if not SHA256.fullmatch(previous_ir_sha256):
        fail("bulk history revision previous_ir_sha256 is invalid")
    if not previous_release.strip() or not reason.strip():
        fail("bulk history revision release and reason must be non-empty")
    current["retired_ids"] = previous["retired_ids"]
    current["revisions"] = list(previous.get("revisions", []))
    current["revisions"].append(
        {
            "previous_release": previous_release,
            "previous_ir_sha256": previous_ir_sha256,
            "previous_operations_fingerprint": operation_set_fingerprint(
                previous_operations
            ),
            "current_operations_fingerprint": operation_set_fingerprint(
                current["operations"]
            ),
            "operation_count": len(current["operations"]),
            "reason": reason,
        }
    )
    return current


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ir", nargs="?", type=Path, default=DEFAULT_IR)
    parser.add_argument("history", nargs="?", type=Path, default=DEFAULT_HISTORY)
    parser.add_argument(
        "--write-history",
        action="store_true",
        help="write a deterministic history from the IR before verifying it",
    )
    parser.add_argument(
        "--advance-history-from-release",
        metavar="TAG",
        help="replace the baseline with one exact bulk revision from an immutable release",
    )
    parser.add_argument(
        "--previous-ir-sha256",
        help="sha256:<hex> checksum of the immutable previous release IR",
    )
    parser.add_argument(
        "--revision-reason",
        help="authored reason for a bulk history revision",
    )
    parser.add_argument(
        "--allow-previous-compatibility",
        action="store_true",
        help="allow a pinned release IR to match the previous side of an explicit compatibility exception",
    )
    args = parser.parse_args(argv)
    try:
        revision_values = (
            args.advance_history_from_release,
            args.previous_ir_sha256,
            args.revision_reason,
        )
        if args.write_history and any(revision_values):
            fail("--write-history cannot be combined with bulk revision options")
        if any(revision_values) and not all(revision_values):
            fail("bulk history revision requires release, IR checksum, and reason")
        if args.advance_history_from_release:
            args.history.write_text(
                json.dumps(
                    advance_history(
                        args.ir,
                        args.history,
                        previous_release=args.advance_history_from_release,
                        previous_ir_sha256=args.previous_ir_sha256,
                        reason=args.revision_reason,
                    ),
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
        elif args.write_history:
            args.history.write_text(
                json.dumps(build_history(args.ir), indent=2) + "\n", encoding="utf-8"
            )
        verify(
            args.ir,
            args.history,
            allow_previous_compatibility=args.allow_previous_compatibility,
        )
    except (OperationHistoryError, OSError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"verify-operation-history: valid {len(_current_operations(_load_json(args.ir, 'IR')))} operations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
