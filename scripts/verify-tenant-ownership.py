#!/usr/bin/env python3
"""Validate the C0 direct organization-ownership schema invariant.

All 463 relations in the ERP manifest are organization-routed: 458
application relations and five persistence/reconstruction protocol relations.
Platform-control truth that cannot be tenant-owned lives outside this
manifest, rather than through a global-table exception.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


EXPECTED_TABLE_COUNT = 463
APPLICATION_RELATION_COUNT = 458
PROTOCOL_RELATIONS = frozenset(
    {
        "organization_commit",
        "organization_commit_cursor",
        "organization_reconstruction_batch_receipt",
        "organization_reconstruction_fence",
        "organization_row_change",
    }
)

def fail(message: str) -> None:
    raise SystemExit(f"verify-tenant-ownership: {message}")


def _truthy(value: Any) -> bool:
    return value is True or (
        isinstance(value, str) and value.lower() in {"true", "yes"}
    )


def validate_tenant_provenance(table: dict[str, Any], column: dict[str, Any]) -> None:
    """Reject client-editable/defaulted ownership metadata when emitted.

    The current schema IR only emits column shape. Newer producers may attach
    provenance to the table or organization column; validate it when present
    without pretending that reducer provenance can be inferred from shape.
    """

    name = table.get("sql_name", "<unnamed>")
    metadata: dict[str, Any] = {}
    for key in ("tenant_provenance", "organization_provenance", "organization_id_provenance"):
        value = table.get(key)
        if isinstance(value, dict):
            metadata.update(value)
    for key, value in column.items():
        if key in {
            "client_editable", "client_writable", "defaulted", "has_default",
            "default", "default_value", "provenance", "source",
        }:
            metadata[key] = value
    for key in ("client_editable", "client_writable", "defaulted", "has_default"):
        if _truthy(metadata.get(key)):
            fail(f"table {name} organization_id is {key.replace('_', '-')}")
    for key in ("default", "default_value"):
        if key in metadata and metadata[key] is not None:
            fail(f"table {name} organization_id must not have a default")
    source = metadata.get("provenance", metadata.get("source"))
    if isinstance(source, str) and source.lower() in {
        "client", "client_input", "caller", "payload", "default", "literal",
    }:
        fail(f"table {name} organization_id provenance is client/default controlled")
    for key in ("client_editable_fields", "client_writable_fields", "defaulted_fields"):
        fields = table.get(key)
        if isinstance(fields, list) and "organization_id" in fields:
            fail(f"table {name} lists organization_id as {key.replace('_', '-')}")


def organization_column(table: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(table.get("columns"), list):
        fail(f"table {table.get('sql_name', '<unnamed>')} columns must be an array")
    columns = [
        column
        for column in table.get("columns", [])
        if column.get("sql_name") == "organization_id"
    ]
    if len(columns) != 1:
        fail(
            f"table {table.get('sql_name', '<unnamed>')} must have exactly one "
            "direct organization_id column"
        )
    column = columns[0]
    if column.get("nullable") is not False:
        fail(f"table {table['sql_name']} organization_id must be non-null")
    if column.get("ty") != "U64":
        fail(f"table {table['sql_name']} organization_id must have type U64")
    validate_tenant_provenance(table, column)
    return column


def validate_relationship_policy(table: dict[str, Any]) -> None:
    """Validate org-leading relationship metadata when a producer emits it."""

    relationships = table.get("relationships", table.get("foreign_keys"))
    if relationships is None:
        return
    name = table["sql_name"]
    if not isinstance(relationships, list):
        fail(f"table {name} relationships must be an array")
    for relation in relationships:
        if not isinstance(relation, dict):
            fail(f"table {name} relationship entries must be objects")
        child = relation.get("columns", relation.get("child_columns"))
        parent = relation.get("referenced_columns", relation.get("parent_columns"))
        if not isinstance(child, list) or not child:
            fail(f"table {name} relationship must declare child columns")
        if not isinstance(parent, list) or not parent or len(child) != len(parent):
            fail(f"table {name} relationship must declare matching parent columns")
        if child[0] != "organization_id" or parent[0] != "organization_id":
            fail(f"table {name} relationship must be organization-leading")


def validate_manifest(manifest: dict[str, Any], expected_table_count: int) -> None:
    tables = manifest.get("tables")
    if not isinstance(tables, list):
        fail("schema manifest tables must be an array")
    if len(tables) != expected_table_count:
        fail(f"C0 requires {expected_table_count} schema tables, found {len(tables)}")

    names = [table.get("sql_name") if isinstance(table, dict) else None for table in tables]
    if any(not isinstance(name, str) or not name for name in names):
        fail("every table must have a non-empty sql_name")
    if len(names) != len(set(names)):
        fail("table sql_name values must be unique")

    if expected_table_count == EXPECTED_TABLE_COUNT:
        table_names = set(names)
        missing_protocol = PROTOCOL_RELATIONS - table_names
        if missing_protocol:
            fail(f"missing protocol relations: {sorted(missing_protocol)}")
        application = table_names - PROTOCOL_RELATIONS
        if len(application) != APPLICATION_RELATION_COUNT:
            fail(
                "C0 requires 458 application relations + 5 protocol relations, "
                f"found {len(application)} + {len(PROTOCOL_RELATIONS & table_names)}"
            )

    for table in tables:
        if not isinstance(table, dict):
            fail("every table entry must be an object")
        organization_column(table)
        primary_key = table.get("primary_key")
        organization_is_primary_key = (
            isinstance(primary_key, dict)
            and primary_key.get("column_name") == "organization_id"
        )
        indexes = table.get("indexes", [])
        if not isinstance(indexes, list):
            fail(f"table {table['sql_name']} indexes must be an array")
        has_organization_leading_index = any(
            isinstance(index, dict)
            and index.get("columns")
            and index["columns"][0] == "organization_id"
            for index in indexes
        )
        if not organization_is_primary_key and not has_organization_leading_index:
            fail(f"table {table['sql_name']} must have an organization-leading index")
        validate_relationship_policy(table)

    summary = manifest.get("ownership_summary")
    if expected_table_count == EXPECTED_TABLE_COUNT and summary is None:
        fail("generated schema manifest must include ownership_summary")
    if summary is not None:
        if not isinstance(summary, dict) or summary.get("verified") is not True:
            fail("ownership_summary must be verified")
        if summary.get("erp_owned_count") != len(tables):
            fail("ownership_summary erp_owned_count must equal all manifest relations")
        if summary.get("platform_global_count") != 0:
            fail("ownership_summary platform_global_count must be zero")
        summary_tables = summary.get("platform_global_tables")
        if summary_tables is not None and summary_tables != []:
            fail("ownership_summary platform_global_tables must be empty")


def validate_no_global_scope(source_path: Path) -> None:
    try:
        source = source_path.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"cannot read schema IR source {source_path}: {error}")
    if "GeneratedTenantScope::Global" in source:
        fail("GeneratedTenantScope::Global application-table path remains")
    enum_body = source.split("GeneratedTenantScope", 1)
    if len(enum_body) == 2 and "Global" in enum_body[1].split("}", 1)[0]:
        fail("GeneratedTenantScope still declares a Global variant")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--expected-table-count", type=int, default=463)
    parser.add_argument(
        "--schema-ir-source",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "lumiere-codegen/src/cold_tier/schema_ir.rs",
    )
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read schema manifest: {error}")
    if not isinstance(manifest, dict):
        fail("schema manifest must be an object")
    validate_manifest(manifest, args.expected_table_count)
    validate_no_global_scope(args.schema_ir_source)
    print(
        f"verify-tenant-ownership: valid {len(manifest['tables'])} tables; "
        f"{len(manifest['tables'])} organization-owned, 0 platform-global"
    )


if __name__ == "__main__":
    main()
