#!/usr/bin/env python3
"""Validate the C0 direct organization-ownership schema invariant."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PLATFORM_GLOBAL_TABLES = frozenset(
    {
        "cold_tier_service_identity",
        "contact_identity_verification_authority",
        "country",
        "country_pack_definition",
        "country_pack_tax_rule",
        "currency",
        "hr_country_pack_leave_default",
        "password_reset_token",
        "schema_migration",
        "user_credential",
        "user_profile",
    }
)

PLATFORM_GLOBAL_TABLE_COUNT = len(PLATFORM_GLOBAL_TABLES)


def fail(message: str) -> None:
    raise SystemExit(f"verify-tenant-ownership: {message}")


def organization_column(table: dict[str, Any]) -> dict[str, Any]:
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
    return column


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

    seen_platform_globals = set()
    platform_tables = set()
    for table in tables:
        if not isinstance(table, dict):
            fail("every table entry must be an object")
        if table.get("sql_name") in PLATFORM_GLOBAL_TABLES:
            seen_platform_globals.add(table["sql_name"])
            if any(
                column.get("sql_name") == "organization_id"
                for column in table.get("columns", [])
            ):
                fail(f"platform-global table {table['sql_name']} must not have organization_id")
            platform_tables.add(table["sql_name"])
            continue
        organization_column(table)
        primary_key = table.get("primary_key")
        organization_is_primary_key = (
            isinstance(primary_key, dict)
            and primary_key.get("column_name") == "organization_id"
        )
        has_organization_leading_index = any(
            isinstance(index, dict)
            and index.get("columns")
            and index["columns"][0] == "organization_id"
            for index in table.get("indexes", [])
        )
        if not organization_is_primary_key and not has_organization_leading_index:
            fail(f"table {table['sql_name']} must have an organization-leading index")

    # Focused fixtures may validate one table at a time with an explicit
    # expected count. The production C0 invocation uses the default 463-table
    # count and must contain the complete, closed platform allowlist.
    if expected_table_count == 463 and platform_tables != PLATFORM_GLOBAL_TABLES:
        fail(
            "platform-global allowlist mismatch: "
            f"expected {sorted(PLATFORM_GLOBAL_TABLES)}, found {sorted(platform_tables)}"
        )

    summary = manifest.get("ownership_summary")
    if expected_table_count == 463 and summary is None:
        fail("generated schema manifest must include ownership_summary")
    if summary is not None:
        if not isinstance(summary, dict) or summary.get("verified") is not True:
            fail("ownership_summary must be verified")
        if summary.get("erp_owned_count") != len(tables) - len(platform_tables):
            fail("ownership_summary erp_owned_count does not match table classifications")
        if summary.get("platform_global_count") != len(platform_tables):
            fail("ownership_summary platform_global_count does not match table classifications")
        summary_tables = summary.get("platform_global_tables")
        if not isinstance(summary_tables, list):
            fail("ownership_summary platform_global_tables must be an array")
        summary_names = set()
        for entry in summary_tables:
            if not isinstance(entry, dict):
                fail("ownership_summary platform table entries must be objects")
            name = entry.get("sql_name")
            rationale = entry.get("rationale")
            if (
                name not in PLATFORM_GLOBAL_TABLES
                or not isinstance(rationale, str)
                or not rationale
            ):
                fail("ownership_summary contains an invalid platform-global table entry")
            summary_names.add(name)
        if expected_table_count == 463 and summary_names != PLATFORM_GLOBAL_TABLES:
            fail("ownership_summary platform-global table list does not match allowlist")


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
        f"{len(manifest['tables']) - PLATFORM_GLOBAL_TABLE_COUNT} ERP-owned, "
        f"{PLATFORM_GLOBAL_TABLE_COUNT} platform-global"
    )


if __name__ == "__main__":
    main()
