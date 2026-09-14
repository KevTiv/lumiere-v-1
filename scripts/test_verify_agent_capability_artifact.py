#!/usr/bin/env python3
"""Focused tests for the generated agent capability artifact verifier."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify-agent-capability-artifact.py"


REVIEW = {
    "reviewed_by": "reviewer",
    "reviewed_at": "2026-09-13T00:00:00Z",
    "evidence": "fixture review",
}


def artifact() -> dict:
    return {
        "artifact_version": 2,
        "source_ir": {
            "ir_version": 2,
            "source_commit": "0" * 40,
            "source_dirty": True,
            "schema_hash": "sha256:" + "1" * 64,
        },
        "entries": [],
    }


def operation_artifact() -> dict:
    data = artifact()
    data["entries"] = [
        {
            "operation_id": "erp.list_orders",
            "capability_key": "erp.read.orders",
            "risk": "read_only",
            "requires_confirmation": False,
            "result_policy": {"kind": "direct", "max_bytes": 4096},
            "review": dict(REVIEW),
            "operation": {
                "operation_name": "list_orders",
                "operation_id": "erp.list_orders",
                "operation_id_status": "locked",
                "source_kind": "reducer",
                "target": {"kind": "spacetimedb_reducer", "name": "list_orders"},
                "application_exposure": "session",
                "application": {"exposure": "session", "name": "list_orders"},
                "client_facing": True,
                "authorization": {"status": "classified"},
                "input": {"kind": "operation_parameters", "parameter_positions": [], "type_reference": None},
                "output": {"kind": "unit", "type_reference": None},
                "schema": {"name": "list_orders"},
                "idempotency": {"status": "classified", "value": "idempotent"},
                "codec": {"id": "spacetimedb-sats-json", "status": "assigned", "version": 1},
                "kind": {"status": "classified", "value": "command"},
                "evidence": "orders.rs: reviewed",
            },
        }
    ]
    return data


def resource_artifact() -> dict:
    data = artifact()
    data["entries"] = [
        {
            "resource": "stock-quants",
            "capability_key": "inventory.stock-quants.read",
            "risk": "read_only",
            "requires_confirmation": False,
            "result_policy": {"kind": "dataset", "max_rows": 100, "max_bytes": 65536},
            "review": dict(REVIEW),
            "tool": {
                "name": "inventory_stock_quants_read",
                "description": "Read authorized stock-quants rows.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "max_rows": {"type": "integer", "minimum": 1, "maximum": 100},
                        "company_id": {"type": "integer", "minimum": 1},
                    },
                    "required": [],
                    "additionalProperties": False,
                },
            },
            "resource_descriptor": {
                "resource_name": "stock-quants",
                "contract": {"table": "stock_quant"},
                "query": {
                    "authorization": "server-enforced",
                    "status": "classified",
                    "result_type_reference": "StockQuant",
                },
                "row": {"type_reference": "StockQuant"},
                "scope": {"kind": "organization_company"},
                "subscription": {"status": "classified"},
                "source": {"kind": "table", "table_reference": "stock_quant"},
            },
        }
    ]
    return data


class AgentCapabilityArtifactTest(unittest.TestCase):
    def _run(self, data: dict, checksum: str | None = None) -> subprocess.CompletedProcess[str]:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "agent-capability-registry-v1.json"
        raw = json.dumps(data, indent=2).encode() + b"\n"
        path.write_bytes(raw)
        digest = checksum if checksum is not None else hashlib.sha256(raw).hexdigest()
        path.with_name(path.name + ".sha256").write_text(
            f"{digest}  {path.name}\n", encoding="utf-8"
        )
        return subprocess.run(
            [sys.executable, str(VERIFIER), str(path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_empty_artifact_and_checksum_are_valid(self):
        result = self._run(artifact())
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_operation_descriptor_shape_and_checksum_are_valid(self):
        result = self._run(operation_artifact())
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_checksum_drift_fails_closed(self):
        result = self._run(artifact(), checksum="0" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum sidecar does not match", result.stderr)

    def test_source_dirty_is_preserved_but_not_rejected(self):
        data = artifact()
        data["source_ir"]["source_dirty"] = True
        result = self._run(data)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_invalid_source_commit_fails_closed(self):
        data = artifact()
        data["source_ir"]["source_commit"] = "BAD"
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source_commit", result.stderr)

    def test_unknown_artifact_field_fails_closed(self):
        data = artifact()
        data["unexpected"] = True
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown fields", result.stderr)

    def test_resource_read_with_tool_descriptor_is_valid(self):
        result = self._run(resource_artifact())
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_entry_without_a_review_record_fails_closed(self):
        data = resource_artifact()
        del data["entries"][0]["review"]
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing: review", result.stderr)

    def test_non_utc_review_instant_fails_closed(self):
        data = resource_artifact()
        data["entries"][0]["review"]["reviewed_at"] = "2026-09-13T00:00:00+02:00"
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reviewed_at", result.stderr)

    def test_resource_read_without_a_tool_fails_closed(self):
        data = resource_artifact()
        del data["entries"][0]["tool"]
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must carry a tool descriptor", result.stderr)

    def test_tenant_scope_as_a_model_input_fails_closed(self):
        data = resource_artifact()
        data["entries"][0]["tool"]["input_schema"]["properties"]["organization_id"] = {
            "type": "integer",
            "minimum": 1,
        }
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not accept an organization", result.stderr)

    def test_row_ceiling_above_the_result_policy_fails_closed(self):
        data = resource_artifact()
        data["entries"][0]["tool"]["input_schema"]["properties"]["max_rows"]["maximum"] = 1000
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ceiling disagrees", result.stderr)

    def test_open_input_schema_fails_closed(self):
        data = resource_artifact()
        data["entries"][0]["tool"]["input_schema"]["additionalProperties"] = True
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("closed object", result.stderr)

    def test_operation_entry_with_a_tool_fails_closed(self):
        data = operation_artifact()
        data["entries"][0]["tool"] = {
            "name": "erp_read_orders",
            "description": "x",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            },
        }
        result = self._run(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not carry a tool descriptor", result.stderr)


if __name__ == "__main__":
    unittest.main()
