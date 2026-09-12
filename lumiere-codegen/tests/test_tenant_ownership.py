#!/usr/bin/env python3
"""Focused tests for the C0 organization-ownership gate."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts" / "verify-tenant-ownership.py"


def manifest(
    *,
    name="example",
    nullable=False,
    include_organization=True,
    organization_primary_key=False,
):
    columns = [{"sql_name": "id", "nullable": False, "ty": "U64"}]
    if include_organization:
        columns.append(
            {"sql_name": "organization_id", "nullable": nullable, "ty": "U64"}
        )
    return {
        "version": 1,
        "tables": [
            {
                "sql_name": name,
                "columns": columns,
                "primary_key": {
                    "column_name": "organization_id" if organization_primary_key else "id"
                },
                "indexes": (
                    []
                    if organization_primary_key
                    else [{"columns": ["organization_id"]}]
                ),
            }
        ],
        "enum_types": [],
    }


def full_manifest(**overrides):
    protocol = sorted(
        {
            "organization_commit",
            "organization_commit_cursor",
            "organization_reconstruction_batch_receipt",
            "organization_reconstruction_fence",
            "organization_row_change",
        }
    )
    tables = [manifest(name=name)["tables"][0] for name in protocol]
    tables.extend(manifest(name=f"application_{index:03d}")["tables"][0] for index in range(458))
    result = {
        "version": 1,
        "tables": tables,
        "enum_types": [],
        "ownership_summary": {
            "verified": True,
            "erp_owned_count": 463,
            "application_relation_count": 458,
            "protocol_relation_count": 5,
            "platform_global_count": 0,
            "platform_global_tables": [],
        },
    }
    result.update(overrides)
    return result


class TenantOwnershipTest(unittest.TestCase):
    def run_checker(self, schema, source=None, expected_table_count=1):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(schema), encoding="utf-8")
            args = [
                sys.executable,
                str(CHECKER),
                str(manifest_path),
                "--expected-table-count",
                str(expected_table_count),
            ]
            if source is not None:
                source_path = root / "schema_ir.rs"
                source_path.write_text(source, encoding="utf-8")
                args.extend(["--schema-ir-source", str(source_path)])
            return subprocess.run(args, capture_output=True, text=True, check=False)

    def test_accepts_direct_non_null_organization_column(self):
        result = self.run_checker(manifest())
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_organization_primary_key_as_leading_index(self):
        result = self.run_checker(manifest(organization_primary_key=True))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_missing_or_nullable_organization_column(self):
        for schema in [manifest(include_organization=False), manifest(nullable=True)]:
            with self.subTest(schema=schema):
                result = self.run_checker(schema)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("organization_id", result.stderr)

    def test_rejects_missing_organization_on_former_global_table(self):
        result = self.run_checker(manifest(name="country", include_organization=False))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("organization_id", result.stderr)

    def test_accepts_full_application_and_protocol_census(self):
        result = self.run_checker(full_manifest(), expected_table_count=463)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_stale_452_11_summary(self):
        result = self.run_checker(
            full_manifest(
                ownership_summary={
                    "verified": True,
                    "erp_owned_count": 452,
                    "platform_global_count": 11,
                    "platform_global_tables": [],
                }
            ),
            expected_table_count=463,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("erp_owned_count", result.stderr)

    def test_rejects_client_editable_or_defaulted_tenant_field(self):
        for metadata in (
            {"client_editable": True},
            {"defaulted": True},
            {"default": 0},
            {"provenance": "client_input"},
        ):
            schema = manifest()
            schema["tables"][0]["columns"][1].update(metadata)
            with self.subTest(metadata=metadata):
                result = self.run_checker(schema)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("organization_id", result.stderr)

    def test_rejects_non_organization_leading_relationship(self):
        schema = manifest()
        schema["tables"][0]["relationships"] = [
            {"columns": ["parent_id"], "referenced_columns": ["id"]}
        ]
        result = self.run_checker(schema)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("organization-leading", result.stderr)

    def test_rejects_global_scope_path(self):
        result = self.run_checker(
            manifest(),
            "pub enum GeneratedTenantScope { Organization, Global }",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Global", result.stderr)


if __name__ == "__main__":
    unittest.main()
