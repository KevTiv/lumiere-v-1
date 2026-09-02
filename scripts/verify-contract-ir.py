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
        "--allow-legacy-v2",
        action="store_true",
        help="allow a pinned pre-persistence v2 artifact during release bootstrap",
    )
    parser.add_argument(
        "--expect-schema-hash-from",
        type=Path,
        help="require the same semantic schema hash as another IR artifact",
    )
    parser.add_argument(
        "--expect-pin-from",
        type=Path,
        help="require the artifact to match an immutable contracts pin",
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
    if ir["ir_version"] != 2:
        fail(f"unsupported ir_version {ir['ir_version']!r}; only v2 is accepted")
    if "persistence" not in ir and not args.allow_legacy_v2:
        fail("v2 persistence contract is required")
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
    operation_names: set[str] = set()
    for operation in ir["operations"]:
        name = operation["name"]
        operation_names.add(name)
        kind = operation.get("kind")
        source_kind = operation.get("source_kind", kind)
        if (
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
        unclassified_scope = {
            "company_field": None,
            "kind": "unclassified",
            "organization_field": None,
        }
        optional_company_scope = (
            isinstance(scope, dict)
            and set(scope) == {"company_field", "kind", "organization_field"}
            and scope.get("kind") == "organization_optional_company"
            and isinstance(scope.get("organization_field"), str)
            and bool(scope["organization_field"])
            and isinstance(scope.get("company_field"), str)
            and bool(scope["company_field"])
        )
        if scope != unclassified_scope and not optional_company_scope:
            fail(f"resource {name} has invalid scope classification")
        query = resource.get("query")
        if (
            not isinstance(query, dict)
            or query.get("status") != "unclassified"
            or query.get("input_type_reference") is not None
            or query.get("filter_type_reference") is not None
            or query.get("cursor_type_reference") is not None
        ):
            fail(f"resource {name} must declare query classification status")

    persistence = ir.get("persistence")
    if persistence is not None:
        if not isinstance(persistence, dict):
            fail("persistence must be an object")
        if persistence.get("schema_version") != 1:
            fail("persistence schema_version must be 1")
        authority = persistence.get("authority")
        expected_authority = {
            "business_logic": "spacetimedb_reducers",
            "business_system_of_record": "spacetimedb",
            "postgresql_role": "derived_projection",
            "direct_postgresql_business_writes": "forbidden",
            "projection_finalization": "spacetimedb_reducer",
        }
        if authority != expected_authority:
            fail("persistence authority must keep SpacetimeDB as business authority")
        storage = persistence.get("storage")
        policies = storage.get("policies") if isinstance(storage, dict) else None
        coverage = storage.get("coverage") if isinstance(storage, dict) else None
        if not isinstance(policies, list) or not isinstance(coverage, dict):
            fail("persistence.storage must contain policies and coverage")
        if coverage.get("classified") != 458 or coverage.get("total") != 458 or coverage.get("unclassified") != 0:
            fail("persistence storage coverage must be 458/458 with zero unclassified")
        policy_tables = {policy.get("table") for policy in policies if isinstance(policy, dict)}
        if policy_tables != table_names or len(policies) != len(table_names):
            fail("persistence storage policies must exactly cover IR tables")
        postgresql = persistence.get("postgresql")
        archive = postgresql.get("archive") if isinstance(postgresql, dict) else None
        codec = postgresql.get("codec") if isinstance(postgresql, dict) else None
        candidates = archive.get("candidates") if isinstance(archive, dict) else None
        codec_tables = codec.get("tables") if isinstance(codec, dict) else None
        if not isinstance(candidates, list) or not isinstance(codec_tables, dict):
            fail("persistence.postgresql must contain archive candidates and codecs")
        archive_tables = {candidate.get("table") for candidate in candidates if isinstance(candidate, dict)}
        if archive_tables != set(codec_tables):
            fail("PostgreSQL archive candidates and codec tables must match")
        if not archive_tables <= table_names:
            fail("PostgreSQL projection references an unknown IR table")
        policy_by_table = {policy["table"]: policy for policy in policies}
        candidate_by_table = {candidate["table"]: candidate for candidate in candidates}
        for table in archive_tables:
            if policy_by_table[table].get("cooling_eligibility") == "never":
                fail(f"PostgreSQL projection table {table} is not cooling eligible")
            candidate = candidate_by_table[table]
            if candidate.get("finalize_reducer") not in operation_names:
                fail(f"PostgreSQL projection table {table} references an unknown finalize reducer")
            codec_table = codec_tables[table]
            if codec_table.get("cold_table") != candidate.get("cold_table"):
                fail(f"PostgreSQL projection table {table} has mismatched cold-table metadata")
            columns = codec_table.get("columns")
            if not isinstance(columns, list) or not columns:
                fail(f"PostgreSQL projection table {table} has no codec columns")
            column_names = [column.get("name") for column in columns if isinstance(column, dict)]
            if len(column_names) != len(columns) or len(column_names) != len(set(column_names)):
                fail(f"PostgreSQL projection table {table} has invalid codec column names")
            for column in columns:
                if (
                    not isinstance(column.get("stdb_type"), str)
                    or not isinstance(column.get("pg_type"), str)
                    or not isinstance(column.get("nullable"), bool)
                    or not isinstance(column.get("pg_bind"), str)
                    or not isinstance(column.get("pg_from"), str)
                    or not isinstance(column.get("api_json"), str)
                ):
                    fail(f"PostgreSQL projection table {table} has incomplete codec semantics")

    semantic = {
        field: ir[field]
        for field in ("operations", "resources", "tables", "types", "persistence")
        if field in ir
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

    if args.expect_pin_from is not None:
        try:
            pin = json.loads(args.expect_pin_from.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            fail(f"cannot read expected pin: {error}")
        required_pin = {
            "artifact_sha256",
            "ir_version",
            "path",
            "schema_hash",
            "source_commit",
            "source_repository",
        }
        if not isinstance(pin, dict) or set(pin) != required_pin:
            fail(
                f"expected pin must contain exactly: {', '.join(sorted(required_pin))}"
            )
        if pin["path"] != f"ir/{args.ir.name}":
            fail(f"pin path does not identify {args.ir.name}")
        if pin["artifact_sha256"] != artifact_hash:
            fail("pin artifact_sha256 does not match the IR artifact")
        if pin["ir_version"] != ir["ir_version"]:
            fail("pin ir_version does not match the IR artifact")
        if pin["schema_hash"] != ir["schema_hash"]:
            fail("pin schema_hash does not match the IR artifact")
        if pin["source_commit"] != ir["source_commit"]:
            fail("pin source_commit does not match the IR artifact")
        if not isinstance(pin["source_repository"], str) or not pin["source_repository"]:
            fail("pin source_repository must be a non-empty string")

    print(
        "verify-contract-ir: valid "
        f"v{ir['ir_version']} {ir['schema_hash']} "
        f"({len(ir['operations'])} operations, {len(ir['resources'])} resources, "
        f"{len(ir['tables'])} tables, {len(ir['types'])} types)"
    )


if __name__ == "__main__":
    main()
