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


def artifact() -> dict:
    return {
        "artifact_version": 1,
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


if __name__ == "__main__":
    unittest.main()
