#!/usr/bin/env python3
"""Verify the generated, deny-by-default agent capability artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


GIT_OBJECT_ID = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
CAPABILITY_KEY = re.compile(r"^[a-z][a-z0-9._-]*$")
RISKS = {"read_only", "presentation", "draft", "business_mutation", "financial_mutation"}


def fail(message: str) -> None:
    raise SystemExit(f"verify-agent-capability-artifact: {message}")


def object_with_keys(value: Any, required: set[str], allowed: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    missing = required - value.keys()
    unknown = value.keys() - allowed
    if missing:
        fail(f"{label} is missing: {', '.join(sorted(missing))}")
    if unknown:
        fail(f"{label} has unknown fields: {', '.join(sorted(unknown))}")
    return value


def positive_int(value: Any, label: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        fail(f"{label} must be a positive integer")


def verify_source_ir(source: Any) -> None:
    source = object_with_keys(
        source,
        {"ir_version", "source_commit", "source_dirty", "schema_hash"},
        {"ir_version", "source_commit", "source_dirty", "schema_hash"},
        "source_ir",
    )
    if source["ir_version"] != 2:
        fail("source_ir.ir_version must be 2")
    if not isinstance(source["source_commit"], str) or not GIT_OBJECT_ID.fullmatch(source["source_commit"]):
        fail("source_ir.source_commit must be a lowercase 40- or 64-character git object ID")
    if not isinstance(source["source_dirty"], bool):
        fail("source_ir.source_dirty must be a boolean")
    if not isinstance(source["schema_hash"], str) or not SHA256.fullmatch(source["schema_hash"]):
        fail("source_ir.schema_hash must be a lowercase sha256 digest")


def verify_result_policy(policy: Any, label: str) -> None:
    policy = object_with_keys(policy, {"kind"}, {"kind", "max_bytes", "max_rows", "allowed_shapes", "max_output_rows"}, label)
    kind = policy["kind"]
    if kind == "direct":
        object_with_keys(policy, {"kind", "max_bytes"}, {"kind", "max_bytes"}, label)
        positive_int(policy["max_bytes"], f"{label}.max_bytes")
    elif kind == "dataset":
        object_with_keys(policy, {"kind", "max_rows", "max_bytes"}, {"kind", "max_rows", "max_bytes"}, label)
        positive_int(policy["max_rows"], f"{label}.max_rows")
        positive_int(policy["max_bytes"], f"{label}.max_bytes")
    elif kind == "aggregate_first":
        object_with_keys(policy, {"kind", "allowed_shapes", "max_output_rows"}, {"kind", "allowed_shapes", "max_output_rows"}, label)
        shapes = policy["allowed_shapes"]
        if not isinstance(shapes, list) or not shapes or any(not isinstance(shape, str) or not shape.strip() for shape in shapes):
            fail(f"{label}.allowed_shapes must be a non-empty list of non-empty strings")
        if shapes != sorted(set(shapes)):
            fail(f"{label}.allowed_shapes must be sorted and unique")
        positive_int(policy["max_output_rows"], f"{label}.max_output_rows")
    else:
        fail(f"{label}.kind is unsupported")


def verify_operation_descriptor(value: Any, entry: dict[str, Any]) -> None:
    operation = object_with_keys(
        value,
        {"operation_name", "operation_id", "operation_id_status", "source_kind", "target", "application_exposure", "application", "client_facing", "authorization", "input", "output", "schema", "idempotency", "codec", "kind", "evidence"},
        {"operation_name", "operation_id", "operation_id_status", "source_kind", "target", "application_exposure", "application", "client_facing", "authorization", "input", "output", "schema", "idempotency", "codec", "kind", "evidence"},
        "operation descriptor",
    )
    if operation["operation_id"] != entry.get("operation_id") or operation["operation_id_status"] != "locked" or not isinstance(operation["operation_name"], str) or not operation["operation_name"]:
        fail("operation descriptor identity does not match its entry")
    if operation["source_kind"] != "reducer" or operation["application_exposure"] != "session" or operation["client_facing"] is not True or not isinstance(operation["application"], dict):
        fail("operation descriptor is not an authorized session reducer")
    if not isinstance(operation["evidence"], str) or not operation["evidence"].strip():
        fail("operation descriptor evidence is empty")
    if not isinstance(operation["target"], dict) or not isinstance(operation["input"], dict) or not isinstance(operation["output"], dict):
        fail("operation descriptor has invalid typed metadata")


def verify_resource_descriptor(value: Any, entry: dict[str, Any]) -> None:
    resource = object_with_keys(
        value,
        {"resource_name", "contract", "query", "row", "scope", "subscription", "source"},
        {"resource_name", "contract", "query", "row", "scope", "subscription", "source"},
        "resource descriptor",
    )
    if resource["resource_name"] != entry.get("resource"):
        fail("resource descriptor identity does not match its entry")
    query = object_with_keys(
        resource["query"],
        {"authorization", "status", "result_type_reference"},
        {
            "authorization",
            "status",
            "cursor_type_reference",
            "filter_type_reference",
            "input_type_reference",
            "result_type_reference",
        },
        "resource descriptor query",
    )
    if query["authorization"] != "server-enforced" or query["status"] != "classified":
        fail("resource descriptor query is not classified as server-enforced")
    row = resource["row"]
    if not isinstance(row, dict) or not isinstance(query["result_type_reference"], str) or row.get("type_reference") != query["result_type_reference"]:
        fail("resource descriptor row/query type references disagree")


def verify_entry(entry: Any) -> None:
    entry = object_with_keys(
        entry,
        {"capability_key", "risk", "requires_confirmation", "result_policy"},
        {"operation_id", "resource", "capability_key", "risk", "requires_confirmation", "result_policy", "operation", "resource_descriptor"},
        "capability entry",
    )
    key = entry["capability_key"]
    if not isinstance(key, str) or not CAPABILITY_KEY.fullmatch(key) or key.endswith((".", "_", "-")) or any(token in key for token in ("..", "__", "--")):
        fail(f"invalid stable capability key {key!r}")
    if entry["risk"] not in RISKS:
        fail(f"capability {key} has unsupported risk")
    if not isinstance(entry["requires_confirmation"], bool):
        fail(f"capability {key}.requires_confirmation must be boolean")
    if entry["risk"] in {"draft", "business_mutation", "financial_mutation"} and not entry["requires_confirmation"]:
        fail(f"capability {key} requires confirmation for mutation risk")
    verify_result_policy(entry["result_policy"], f"capability {key}.result_policy")
    has_operation = isinstance(entry.get("operation_id"), str) and "operation" in entry
    has_resource = isinstance(entry.get("resource"), str) and "resource_descriptor" in entry
    if has_operation == has_resource:
        fail(f"capability {key} must identify exactly one operation or resource")
    if has_operation:
        verify_operation_descriptor(entry["operation"], entry)
    else:
        verify_resource_descriptor(entry["resource_descriptor"], entry)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    artifact_path = args.artifact
    checksum_path = Path(f"{artifact_path}.sha256")
    raw = artifact_path.read_bytes()
    try:
        artifact = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"invalid JSON: {error}")
    artifact = object_with_keys(artifact, {"artifact_version", "source_ir", "entries"}, {"artifact_version", "source_ir", "entries"}, "artifact")
    if artifact["artifact_version"] != 1:
        fail("artifact_version must be 1")
    verify_source_ir(artifact["source_ir"])
    entries = artifact["entries"]
    if not isinstance(entries, list):
        fail("entries must be an array")
    keys = [entry.get("capability_key") if isinstance(entry, dict) else None for entry in entries]
    if any(not isinstance(key, str) for key in keys) or keys != sorted(set(keys)):
        fail("entries must be sorted and unique by capability_key")
    for entry in entries:
        verify_entry(entry)
    try:
        checksum_line = checksum_path.read_text(encoding="utf-8").strip()
    except OSError as error:
        fail(f"cannot read checksum sidecar: {error}")
    parts = checksum_line.split()
    if len(parts) != 2 or parts[1] != artifact_path.name or not re.fullmatch(r"[0-9a-f]{64}", parts[0]):
        fail("checksum sidecar must contain '<sha256>  <artifact filename>'")
    actual = hashlib.sha256(raw).hexdigest()
    if parts[0] != actual:
        fail("checksum sidecar does not match artifact bytes")
    print(f"valid agent capability artifact: {artifact_path} ({len(entries)} entries)")


if __name__ == "__main__":
    main()
