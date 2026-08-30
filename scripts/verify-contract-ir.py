#!/usr/bin/env python3
"""Validate the immutable handoff consumed by lumiere-contracts emitters."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
GIT_OBJECT_ID = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


def fail(message: str) -> None:
    raise SystemExit(f"verify-contract-ir: {message}")


def unique_names(items: list[dict[str, Any]], label: str) -> None:
    names = [item.get("name") for item in items]
    if any(not isinstance(name, str) or not name for name in names):
        fail(f"every {label} must have a non-empty name")
    if len(names) != len(set(names)):
        fail(f"{label} names must be unique")
    if names != sorted(names):
        fail(f"{label} must be sorted by name")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ir", type=Path)
    parser.add_argument(
        "--require-clean",
        action="store_true",
        help="reject an IR extracted from a dirty source checkout",
    )
    parser.add_argument(
        "--expect-schema-hash-from",
        type=Path,
        help="require the same semantic schema hash as another IR artifact",
    )
    args = parser.parse_args()

    raw = args.ir.read_bytes()
    try:
        ir = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"invalid JSON: {error}")

    required = {
        "ir_version",
        "source_commit",
        "source_dirty",
        "schema_hash",
        "operations",
        "resources",
        "tables",
        "types",
    }
    missing = required - ir.keys()
    if missing:
        fail(f"missing fields: {', '.join(sorted(missing))}")
    if ir["ir_version"] not in {1, 2}:
        fail(f"unsupported ir_version {ir['ir_version']!r}")
    if not isinstance(ir["source_commit"], str) or not GIT_OBJECT_ID.fullmatch(
        ir["source_commit"]
    ):
        fail("source_commit must be a lowercase 40- or 64-character git object ID")
    if not isinstance(ir["source_dirty"], bool):
        fail("source_dirty must be a boolean")
    if args.require_clean and ir["source_dirty"]:
        fail("release IR was extracted from a dirty source checkout")
    if not isinstance(ir["schema_hash"], str) or not SHA256.fullmatch(ir["schema_hash"]):
        fail("schema_hash must be a lowercase sha256 digest")

    for field in ("operations", "resources", "tables", "types"):
        if not isinstance(ir[field], list):
            fail(f"{field} must be an array")
    unique_names(ir["operations"], "operations")
    unique_names(ir["resources"], "resources")
    unique_names(ir["tables"], "tables")

    indexes = [item.get("index") for item in ir["types"]]
    if indexes != list(range(len(indexes))):
        fail("type indexes must be contiguous and ordered from zero")
    type_names = {
        name
        for item in ir["types"]
        for name in item.get("names", [])
        if isinstance(name, str)
    }
    table_names = {item["name"] for item in ir["tables"]}
    resource_names = {item["name"] for item in ir["resources"]}
    operation_ids: set[str] = set()
    for operation in ir["operations"]:
        name = operation["name"]
        kind = operation.get("kind")
        source_kind = operation.get("source_kind", kind)
        if ir["ir_version"] == 1 and kind not in {"reducer", "procedure", "view"}:
            fail(f"operation {name} has unsupported kind {kind!r}")
        if ir["ir_version"] == 2 and (
            not isinstance(kind, dict)
            or kind.get("status") != "unclassified"
            or kind.get("value") is not None
        ):
            fail(f"operation {name} must declare semantic kind as unclassified")
        application = operation.get("application")
        if source_kind == "reducer" and (not isinstance(application, dict) or application.get("name") != name):
            fail(f"reducer operation {name} application contract does not match")
        if source_kind != "reducer" and application is not None:
            fail(f"unannotated {source_kind} operation {name} must have null application metadata")
        if operation.get("schema", {}).get("name") != name:
            fail(f"operation {name} schema name does not match")
        if ir["ir_version"] == 2:
            operation_id = operation.get("contract_operation_id")
            if not isinstance(operation_id, str) or not re.fullmatch(r"erp\.[a-z0-9_]+", operation_id):
                fail(f"operation {name} has invalid contract_operation_id")
            if operation_id in operation_ids:
                fail(f"duplicate contract_operation_id {operation_id}")
            operation_ids.add(operation_id)
            if operation.get("contract_operation_id_status") != "locked":
                fail(f"operation {name} must declare locked contract identity status")
            target = operation.get("target")
            expected_target = {
                "reducer": "spacetimedb_reducer",
                "procedure": "spacetimedb_procedure",
                "view": "spacetimedb_view",
            }.get(source_kind)
            if not isinstance(target, dict) or target.get("kind") != expected_target or target.get("name") != name:
                fail(f"operation {name} target does not match source operation")
            input_metadata = operation.get("input")
            if not isinstance(input_metadata, dict):
                fail(f"operation {name} must declare input metadata")
            if input_metadata.get("kind") not in {"operation_parameters", "unresolved"}:
                fail(f"operation {name} has invalid input kind")
            positions = input_metadata.get("parameter_positions")
            params = application.get("params", []) if isinstance(application, dict) else []
            client_fields = (
                application.get("client_input", {}).get("fields", [])
                if isinstance(application, dict)
                else []
            )
            expected_positions = [field.get("parameter_position") for field in client_fields]
            if (
                not isinstance(positions, list)
                or any(not isinstance(position, int) or position < 0 or position >= len(params) for position in positions)
                or len(positions) != len(set(positions))
                or positions != expected_positions
            ):
                fail(f"operation {name} has invalid input parameter positions")
            input_ref = input_metadata.get("type_reference")
            if input_ref is not None and input_ref not in type_names:
                fail(f"operation {name} references unknown input type {input_ref!r}")
            expected_input_ref = (
                params[positions[0]].get("ref_target") if len(positions) == 1 else None
            )
            if input_ref != expected_input_ref:
                fail(f"operation {name} input type reference does not match parameters")
            output = operation.get("output")
            if not isinstance(output, dict):
                fail(f"operation {name} must declare output metadata")
            if source_kind == "reducer" and (
                output.get("kind") != "unit" or output.get("type_reference") is not None
            ):
                fail(f"reducer operation {name} must declare unit output")
            if source_kind != "reducer" and (
                output.get("kind") != "unresolved" or output.get("type_reference") is not None
            ):
                fail(f"operation {name} must declare unresolved output")
            codec = operation.get("codec")
            if (
                not isinstance(codec, dict)
                or codec.get("status") != "unassigned"
                or codec.get("id") is not None
                or codec.get("version") is not None
            ):
                fail(f"operation {name} must declare codec as unassigned")
            idempotency = operation.get("idempotency")
            if not isinstance(idempotency, dict) or idempotency.get("status") != "unclassified":
                fail(f"operation {name} must declare idempotency status")
        invalidates = operation.get("invalidates")
        if not isinstance(invalidates, list) or any(
            resource not in resource_names for resource in invalidates
        ):
            fail(f"operation {name} has invalid resource invalidations")

    if ir["ir_version"] == 2:
        for resource in ir["resources"]:
            name = resource["name"]
            row_ref = resource.get("row", {}).get("type_reference")
            if row_ref not in type_names:
                fail(f"resource {name} references unknown row type {row_ref!r}")
            source = resource.get("source", {})
            table_ref = source.get("table_reference")
            source_kind = source.get("kind")
            if source_kind not in {"table", "unresolved"}:
                fail(f"resource {name} has invalid source kind {source_kind!r}")
            if source_kind == "table" and table_ref not in table_names:
                fail(f"resource {name} references unknown table {table_ref!r}")
            if source_kind == "unresolved" and table_ref in table_names:
                fail(f"resource {name} has an unnecessarily unresolved table source")
            writers = resource.get("invalidated_by")
            if (
                not isinstance(writers, list)
                or writers != sorted(set(writers))
                or any(writer not in operation_ids for writer in writers)
            ):
                fail(f"resource {name} has invalid invalidated_by references")
            scope = resource.get("scope")
            if (
                not isinstance(scope, dict)
                or scope.get("kind") != "unclassified"
                or scope.get("organization_field") is not None
                or scope.get("company_field") is not None
            ):
                fail(f"resource {name} must declare scope classification status")
            query = resource.get("query")
            if (
                not isinstance(query, dict)
                or query.get("status") != "unclassified"
                or query.get("input_type_reference") is not None
                or query.get("filter_type_reference") is not None
                or query.get("cursor_type_reference") is not None
            ):
                fail(f"resource {name} must declare query classification status")

    semantic = {
        field: ir[field]
        for field in ("operations", "resources", "tables", "types")
    }
    canonical = json.dumps(
        semantic, ensure_ascii=False, separators=(",", ":")
    ).encode()
    schema_hash = f"sha256:{hashlib.sha256(canonical).hexdigest()}"
    if schema_hash != ir["schema_hash"]:
        fail(f"schema hash mismatch: expected {schema_hash}")
    if args.expect_schema_hash_from is not None:
        try:
            expected_ir = json.loads(args.expect_schema_hash_from.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            fail(f"cannot read expected IR: {error}")
        expected_hash = expected_ir.get("schema_hash")
        if expected_hash != schema_hash:
            fail(
                "semantic schema drift: "
                f"expected {expected_hash!r} from {args.expect_schema_hash_from}, got {schema_hash!r}"
            )

    checksum_path = args.ir.with_suffix(args.ir.suffix + ".sha256")
    checksum_parts = checksum_path.read_text(encoding="utf-8").split()
    if len(checksum_parts) != 2 or checksum_parts[1] != args.ir.name:
        fail(f"malformed checksum file {checksum_path}")
    artifact_hash = hashlib.sha256(raw).hexdigest()
    if checksum_parts[0] != artifact_hash:
        fail(f"artifact checksum mismatch: expected {artifact_hash}")

    print(
        "verify-contract-ir: valid "
        f"v{ir['ir_version']} {ir['schema_hash']} "
        f"({len(ir['operations'])} operations, {len(ir['resources'])} resources, "
        f"{len(ir['tables'])} tables, {len(ir['types'])} types)"
    )


if __name__ == "__main__":
    main()
