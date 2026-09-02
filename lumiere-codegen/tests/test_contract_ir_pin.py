#!/usr/bin/env python3
"""Focused checks for the immutable IR pin contract used by releases."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VERIFIER = ROOT / "scripts" / "verify-contract-ir.py"


class ContractIrPinTest(unittest.TestCase):
    def _fixture(
        self,
        pin_extra=None,
        legacy=False,
        commit_stream_extra=None,
        projection_extra=False,
        projection_primary_key="id",
    ):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name) / "ir"
        root.mkdir()
        ir_path = root / "lumiere-contract-ir-v2.json"
        tables = [{"name": f"table_{index:03d}"} for index in range(458)]
        commit_stream = {
            "contract_version": "ir-v2",
            "envelope_table": "organization_commit",
            "row_change_table": "organization_row_change",
            "sequence_scope": "organization_id",
            "sequence_order": "strictly_monotonic",
            "transaction_boundary": "spacetimedb_reducer",
            "row_order": "reducer_declared_dependency_safe",
            "upsert_payload": "canonical_full_row_json",
            "delete_payload": "durable_identity_tombstone",
            "checksum": {
                "algorithm": "sha256",
                "row_preimage": "table_newline_identity_newline_kind_newline_row",
                "commit_preimage": "length_prefixed_envelope_fields_then_row_checksums",
            },
            "audit_relation": "separate_schema_not_reconstruction_source",
        }
        if commit_stream_extra:
            commit_stream.update(commit_stream_extra)
        projection_tables = {
            table["name"]: {
                "projection_table": table["name"],
                "module": "test",
                "projection_mode": "upsert-current",
                "primary_key": {"name": projection_primary_key, "type": "U64"},
                "columns": [
                    {
                        "name": "id",
                        "stdb_type": "U64",
                        "pg_type": "NUMERIC(20,0)",
                        "nullable": False,
                        "pg_bind": "to_sql_numeric",
                        "pg_from": "from_sql_numeric_to_string",
                        "api_json": "string",
                    },
                    {
                        "name": "organization_id",
                        "stdb_type": "U64",
                        "pg_type": "NUMERIC(20,0)",
                        "nullable": False,
                        "pg_bind": "to_sql_numeric",
                        "pg_from": "from_sql_numeric_to_string",
                        "api_json": "string",
                    },
                ],
                "organization_column": "organization_id",
            }
            for table in tables
        }
        if projection_extra:
            projection_tables["unexpected"] = projection_tables["table_000"]
        persistence = {
            "schema_version": 1,
            "authority": {
                "business_logic": "spacetimedb_reducers",
                "business_system_of_record": "spacetimedb",
                "postgresql_role": "derived_projection",
                "direct_postgresql_business_writes": "forbidden",
                "projection_finalization": "spacetimedb_reducer",
            },
            "storage": {
                "coverage": {"classified": 458, "total": 458, "unclassified": 0},
                "policies": [
                    {
                        "table": table["name"],
                        "module": "test",
                        "projection_mode": "upsert-current",
                        "cooling_eligibility": "never",
                        "organization_column": "organization_id",
                        "primary_key": {"column": "id"},
                    }
                    for table in tables
                ],
            },
            "commit_stream": commit_stream,
            "postgresql": {
                "archive": {"candidates": []},
                "codec": {"tables": {}},
                "projection": {
                    "version": 1,
                    "checksum_algo": "sha256",
                    "canonical_serialization": "json_sorted_keys_no_whitespace",
                    "tables": projection_tables,
                },
            },
        }
        semantic = {
            "operations": [],
            "resources": [],
            "tables": tables,
            "types": [],
            "persistence": persistence,
        }
        if legacy:
            semantic.pop("persistence")
        ir = {
            "ir_version": 2,
            "source_commit": "a" * 40,
            "source_dirty": False,
            "schema_hash": "sha256:" + hashlib.sha256(
                json.dumps(semantic, separators=(",", ":")).encode()
            ).hexdigest(),
            **semantic,
        }
        raw = json.dumps(ir, indent=2).encode() + b"\n"
        ir_path.write_bytes(raw)
        ir_path.with_suffix(ir_path.suffix + ".sha256").write_text(
            f"{hashlib.sha256(raw).hexdigest()}  {ir_path.name}\n"
        )
        pin = {
            "artifact_sha256": hashlib.sha256(raw).hexdigest(),
            "ir_version": 2,
            "path": "ir/lumiere-contract-ir-v2.json",
            "schema_hash": ir["schema_hash"],
            "source_commit": ir["source_commit"],
            "source_repository": "https://github.com/KevTiv/lumiere-v-1",
        }
        if pin_extra:
            pin.update(pin_extra)
        pin_path = root / "PIN.json"
        pin_path.write_text(json.dumps(pin, indent=2) + "\n")
        return temp, ir_path, pin_path

    def _run(self, ir_path, pin_path, allow_legacy=False):
        command = [sys.executable, str(VERIFIER), str(ir_path)]
        if allow_legacy:
            command.append("--allow-legacy-v2")
        command.extend(["--expect-pin-from", str(pin_path)])
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_valid_pin_matches_artifact(self):
        temp, ir_path, pin_path = self._fixture()
        self.addCleanup(temp.cleanup)
        result = self._run(ir_path, pin_path)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_pin_rejects_unknown_fields(self):
        temp, ir_path, pin_path = self._fixture({"unexpected": True})
        self.addCleanup(temp.cleanup)
        result = self._run(ir_path, pin_path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly", result.stderr)

    def test_legacy_v2_requires_the_explicit_bootstrap_flag(self):
        temp, ir_path, pin_path = self._fixture(legacy=True)
        self.addCleanup(temp.cleanup)
        strict = self._run(ir_path, pin_path)
        self.assertNotEqual(strict.returncode, 0)
        self.assertIn("persistence contract is required", strict.stderr)
        compatible = self._run(ir_path, pin_path, allow_legacy=True)
        self.assertEqual(compatible.returncode, 0, compatible.stderr)

    def test_pin_rejects_artifact_identity_mismatches(self):
        cases = {
            "artifact_sha256": "0" * 64,
            "ir_version": 1,
            "path": "ir/lumiere-contract-ir-v1.json",
            "schema_hash": "sha256:" + "0" * 64,
            "source_commit": "b" * 40,
        }
        for field, value in cases.items():
            with self.subTest(field=field):
                temp, ir_path, pin_path = self._fixture({field: value})
                try:
                    result = self._run(ir_path, pin_path)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(field, result.stderr)
                finally:
                    temp.cleanup()

    def test_projection_manifest_must_cover_all_ir_tables(self):
        temp, ir_path, pin_path = self._fixture(projection_extra=True)
        self.addCleanup(temp.cleanup)
        result = self._run(ir_path, pin_path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly cover storage-policy tables", result.stderr)

    def test_projection_primary_key_must_match_storage_policy(self):
        temp, ir_path, pin_path = self._fixture(projection_primary_key="other")
        self.addCleanup(temp.cleanup)
        result = self._run(ir_path, pin_path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("primary key disagrees with storage policy", result.stderr)

    def test_commit_stream_requires_dependency_safe_row_order(self):
        temp, ir_path, pin_path = self._fixture(
            commit_stream_extra={"row_order": "ordinal_parent_before_child"}
        )
        self.addCleanup(temp.cleanup)
        result = self._run(ir_path, pin_path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("commit_stream", result.stderr)


if __name__ == "__main__":
    unittest.main()
