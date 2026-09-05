#!/usr/bin/env python3
"""Focused tests for the structural C2 coverage gate."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "verify_c2_commit_coverage", ROOT / "scripts/verify-c2-commit-coverage.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class C2CommitCoverageTests(unittest.TestCase):
    def test_current_repo_data_covers_every_enabled_module(self) -> None:
        MODULE.verify(
            ROOT,
            ROOT / "lumiere-codegen/c2-commit-coverage.json",
            ROOT / "lumiere-codegen/contract-operation-ids.json",
        )

    def test_module_coverage_is_set_based_and_requires_every_enabled_module(self) -> None:
        entries = [
            {"source": "spacetimedb/src/sales/first.rs"},
            {"source": "spacetimedb/src/sales/second.rs"},
        ]
        with self.assertRaisesRegex(
            MODULE.CoverageError, r"C2 module coverage is missing enabled modules: core"
        ):
            MODULE._validate_module_coverage(entries, frozenset({"core", "sales"}))

    def test_canonical_module_census_includes_core_and_ignores_seed(self) -> None:
        modules = MODULE._canonical_enabled_modules(ROOT)
        self.assertIn("core", modules)
        self.assertNotIn("seed", modules)

    def test_unregistered_call_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "spacetimedb/src/example.rs"
            source.parent.mkdir(parents=True)
            source.write_text(
                'fn example() { record_organization_commit(ctx, OrganizationCommitInput { operation_id: "erp.example", changes }); }\n',
                encoding="utf-8",
            )
            metadata = root / "coverage.json"
            metadata.write_text(json.dumps({"schema_version": 1, "reducers": []}), encoding="utf-8")
            operation_ids = root / "operation-ids.json"
            operation_ids.write_text(json.dumps({"operations": {"example": "erp.example"}}), encoding="utf-8")
            with self.assertRaises(MODULE.CoverageError):
                MODULE.verify(root, metadata, operation_ids)


if __name__ == "__main__":
    unittest.main()
