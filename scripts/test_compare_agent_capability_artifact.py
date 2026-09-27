#!/usr/bin/env python3
"""Tests for provenance-insensitive agent capability artifact comparison."""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "compare_agent_capability_artifact", ROOT / "scripts/compare-agent-capability-artifact.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def artifact(commit: str = "a" * 40, dirty: bool = False) -> dict:
    return {
        "artifact_version": 1,
        "source_ir": {
            "ir_version": 2,
            "source_commit": commit,
            "source_dirty": dirty,
            "schema_hash": "sha256:" + "1" * 64,
        },
        "capabilities": [{"id": "erp.read.account-moves", "risk": "green"}],
    }


class CompareAgentCapabilityArtifactTests(unittest.TestCase):
    def test_provenance_only_difference_matches(self):
        MODULE.compare(artifact("b" * 40, True), artifact("a" * 40, False))

    def test_schema_hash_difference_is_drift(self):
        changed = artifact()
        changed["source_ir"]["schema_hash"] = "sha256:" + "2" * 64
        with self.assertRaisesRegex(MODULE.ArtifactDriftError, "schema_hash"):
            MODULE.compare(changed, artifact())

    def test_ir_version_difference_is_drift(self):
        changed = artifact()
        changed["source_ir"]["ir_version"] = 3
        with self.assertRaisesRegex(MODULE.ArtifactDriftError, "ir_version"):
            MODULE.compare(changed, artifact())

    def test_capability_entry_difference_is_drift(self):
        changed = artifact()
        changed["capabilities"][0]["risk"] = "red"
        with self.assertRaisesRegex(MODULE.ArtifactDriftError, "capabilities"):
            MODULE.compare(changed, artifact())

    def test_normalization_does_not_mutate_inputs(self):
        original = artifact()
        snapshot = copy.deepcopy(original)
        MODULE.without_provenance(original)
        self.assertEqual(original, snapshot)

    def test_cli_rejects_missing_source_ir_and_reports_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            generated = root / "generated.json"
            pinned = root / "pinned.json"
            generated.write_text(json.dumps(artifact("b" * 40)), encoding="utf-8")
            pinned.write_text(json.dumps(artifact()), encoding="utf-8")
            self.assertEqual(MODULE.main([str(generated), str(pinned)]), 0)
            broken = artifact()
            del broken["source_ir"]
            pinned.write_text(json.dumps(broken), encoding="utf-8")
            self.assertEqual(MODULE.main([str(generated), str(pinned)]), 1)
            self.assertEqual(MODULE.main([str(generated)]), 2)


if __name__ == "__main__":
    unittest.main()
