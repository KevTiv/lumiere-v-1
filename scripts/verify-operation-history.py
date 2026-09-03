#!/usr/bin/env python3
"""Verify the authored history of canonical contract operation identities.

The history is deliberately keyed by ``contract_operation_id``.  A history
entry records the operation name and a fingerprint of the operation's
structural contract.  Operation identity and source provenance are not part
of that fingerprint: identity is checked directly and provenance belongs to
the IR artifact, not to an operation shape.

Canonicalization is UTF-8 JSON with recursively sorted object keys, compact
separators, and no insignificant whitespace.  The shape projection is an
explicit allow-list of structural IR fields so future provenance or build
metadata cannot silently affect the digest.
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
FINGERPRINT_FIELDS = {"algorithm", "canonicalization"}
OPERATION_HISTORY_FIELDS = {"name", "shape_fingerprint"}
EXCEPTION_FIELDS = {"operation_id", "previous_fingerprint", "current_fingerprint", "reason"}


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


def operation_shape(operation: dict[str, Any]) -> dict[str, Any]:
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
    # The concrete reducer/procedure target is contract shape. Retaining its
    # name ensures an operation ID cannot silently redirect to another action.
    _object(shape.get("target"), "operation target")
    return shape


def shape_fingerprint(operation: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(operation_shape(operation))).hexdigest()


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
    _exact_fields(history, HISTORY_FIELDS, "operation history")
    if history["schema_version"] != 1:
        fail(f"unsupported operation history schema_version {history['schema_version']!r}")
    if history["ir_version"] != 2:
        fail(f"operation history must target IR v2, got {history['ir_version']!r}")
    fingerprint = _object(history["fingerprint"], "operation history fingerprint")
    _exact_fields(fingerprint, FINGERPRINT_FIELDS, "operation history fingerprint")
    if fingerprint["algorithm"] != "sha256":
        fail("operation history fingerprint algorithm must be sha256")
    if fingerprint["canonicalization"] != "json_sorted_keys_no_whitespace":
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
    historical = history["operations"]
    retired = set(history["retired_ids"])
    current_ids = set(current)
    historical_ids = set(historical)
    reused = current_ids & retired
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
    if unretired_missing or added:
        details = []
        if unretired_missing:
            details.append(f"missing current IDs={sorted(unretired_missing)!r}")
        if added:
            details.append(f"unrecorded current IDs={sorted(added)!r}")
        fail("current operation ID set changed; " + "; ".join(details))
    exceptions = {
        exception["operation_id"]: exception
        for exception in history["compatibility_exceptions"]
    }
    unknown_exceptions = set(exceptions) - current_ids
    if unknown_exceptions:
        fail(
            "compatibility exceptions target unknown operation IDs: "
            + ", ".join(sorted(unknown_exceptions))
        )
    if set(exceptions) & retired:
        fail("compatibility exceptions cannot target retired IDs")
    for operation_id in sorted(current):
        operation = current[operation_id]
        entry = historical[operation_id]
        current_name = operation["name"]
        if entry["name"] != current_name:
            fail(
                f"operation ID {operation_id} changed name from {entry['name']!r} to {current_name!r}"
            )
        actual = shape_fingerprint(operation)
        expected = entry["shape_fingerprint"]
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
    operations = {
        operation_id: {
            "name": operation["name"],
            "shape_fingerprint": shape_fingerprint(operation),
        }
        for operation_id, operation in sorted(current.items())
    }
    return {
        "schema_version": 1,
        "ir_version": 2,
        "fingerprint": {
            "algorithm": "sha256",
            "canonicalization": "json_sorted_keys_no_whitespace",
        },
        "operations": operations,
        "retired_ids": [],
        "compatibility_exceptions": [],
    }


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
        "--allow-previous-compatibility",
        action="store_true",
        help="allow a pinned release IR to match the previous side of an explicit compatibility exception",
    )
    args = parser.parse_args(argv)
    try:
        if args.write_history:
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
