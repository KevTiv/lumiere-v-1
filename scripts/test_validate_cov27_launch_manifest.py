#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cov27_validator", ROOT / "scripts/validate-cov27-launch-manifest.py"
)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class Cov27LaunchManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = validator.json.loads(validator.MANIFEST_PATH.read_text())
        cls.lifecycle = validator.json.loads(validator.LIFECYCLE_PATH.read_text())
        cls.operations = validator.json.loads(validator.OPERATIONS_PATH.read_text())
        cls.catalog = validator.CATALOG_PATH.read_text()

    def validate(self, manifest=None, lifecycle=None, operations=None):
        return validator.validate(
            manifest or copy.deepcopy(self.manifest),
            lifecycle or copy.deepcopy(self.lifecycle),
            operations or copy.deepcopy(self.operations),
            self.catalog,
        )

    def test_current_blocked_manifest_is_consistent(self) -> None:
        self.assertEqual(self.validate(), [])

    def test_missing_target_module_fails_closed(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["modules"].pop()
        self.assertTrue(any("exactly match" in item for item in self.validate(manifest=manifest)))

    def test_non_u5_module_cannot_be_admitted_or_runtime_pending(self) -> None:
        for gate in ("admitted", "runtime-pending"):
            manifest = copy.deepcopy(self.manifest)
            manifest["modules"][0]["launch_gate"] = gate
            failures = self.validate(manifest=manifest)
            self.assertTrue(any("U5" in item for item in failures), failures)

    def test_unclassified_enabled_operation_fails_closed(self) -> None:
        operations = copy.deepcopy(self.operations)
        row = next(
            item
            for item in operations["operations"]
            if item["client_facing"] and item["coverage_status"] == "reachable-ui"
        )
        row["owner"] = "REVIEW"
        operations["summary"]["unowned_client_facing"] = 1
        failures = self.validate(operations=operations)
        self.assertTrue(any("unclassified client-facing" in item for item in failures), failures)

    def test_visible_stub_must_remain_explicitly_blocked(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        hr = next(item for item in manifest["modules"] if item["id"] == "COV-09")
        hr["visible_stub_markers"] = []
        failures = self.validate(manifest=manifest)
        self.assertTrue(any("unclassified visible stub" in item for item in failures), failures)


if __name__ == "__main__":
    unittest.main()
