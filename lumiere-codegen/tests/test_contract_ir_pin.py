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
    def _fixture(self, pin_extra=None):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name) / "ir"
        root.mkdir()
        ir_path = root / "lumiere-contract-ir-v1.json"
        semantic = {"operations": [], "resources": [], "tables": [], "types": []}
        ir = {
            "ir_version": 1,
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
            "ir_version": 1,
            "path": "ir/lumiere-contract-ir-v1.json",
            "schema_hash": ir["schema_hash"],
            "source_commit": ir["source_commit"],
            "source_repository": "https://github.com/KevTiv/lumiere-v-1",
        }
        if pin_extra:
            pin.update(pin_extra)
        pin_path = root / "PIN.json"
        pin_path.write_text(json.dumps(pin, indent=2) + "\n")
        return temp, ir_path, pin_path

    def _run(self, ir_path, pin_path):
        return subprocess.run(
            [sys.executable, str(VERIFIER), str(ir_path), "--expect-pin-from", str(pin_path)],
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

    def test_pin_rejects_artifact_identity_mismatches(self):
        cases = {
            "artifact_sha256": "0" * 64,
            "ir_version": 2,
            "path": "ir/lumiere-contract-ir-v2.json",
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


if __name__ == "__main__":
    unittest.main()
