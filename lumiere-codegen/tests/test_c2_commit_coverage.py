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
    def _dynamic_fixture(self, root: Path, selector: bool = False) -> tuple[Path, Path, Path]:
        source = root / "spacetimedb/src/core/example.rs"
        source.parent.mkdir(parents=True)
        (source.parent / "mod.rs").write_text("pub mod example;\n", encoding="utf-8")
        (root / "spacetimedb/src/lib.rs").write_text(
            "// ── Domain modules\npub mod core;\n"
            "/// Shared org/company/COA fixture\n", encoding="utf-8",
        )
        source.write_text(
            'fn created() { let changes = vec![RowChange::upsert_stdb_row("row", key, value)]; '
            'record_organization_commit(ctx, OrganizationCommitInput { operation_id: "erp.created", changes }); }\n'
            'struct Snapshot;\n'
            'impl Snapshot { fn record(self, ctx: &ReducerContext, operation_id: &str) { '
            'let changes = build_changes(); record_organization_commit(ctx, OrganizationCommitInput { '
            'operation_id: operation_id.to_string(), changes }); } }\n'
            'fn build_changes<T>() { RowChange::upsert_stdb_row("row", key, value); RowChange::delete("row", key); }\n'
            + ('fn execute(ctx: &ReducerContext) { let selected = if tracked { "erp.tracked" } else { "erp.execute" }; '
               'snapshot.record(ctx, selected); }\n' if selector else
               'fn execute(ctx: &ReducerContext) { snapshot.record(ctx, "erp.execute"); }\n'),
            encoding="utf-8",
        )
        metadata = root / "coverage.json"
        metadata.write_text(json.dumps({
            "schema_version": 1,
            "reducers": [{"source": "spacetimedb/src/core/example.rs", "function": "created",
                          "operation": "created", "operation_id": "erp.created",
                          "change_constructors": ["upsert_stdb_row"]}],
            "dynamic_commit_helpers": [{
                "source": "spacetimedb/src/core/example.rs", "function": "record",
                "operation_id_parameter": "operation_id", "snapshot_type": "Snapshot", "method": "record",
                "change_constructors": ["upsert_stdb_row", "delete"], "change_helpers": ["build_changes"],
                "callers": [{"source": "spacetimedb/src/core/example.rs", "function": "execute",
                             "argument": "selected" if selector else '"erp.execute"',
                             "operations": {"execute": "erp.execute", "tracked": "erp.tracked"}
                             if selector else {"execute": "erp.execute"}}],
            }],
        }), encoding="utf-8")
        operation_ids = root / "operation-ids.json"
        operation_ids.write_text(json.dumps({"operations": {
            "created": "erp.created", "execute": "erp.execute", "tracked": "erp.tracked",
        }}), encoding="utf-8")
        return source, metadata, operation_ids

    def test_registered_dynamic_literal_and_closed_selector_pass(self) -> None:
        for selector in (False, True):
            with self.subTest(selector=selector), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                _, metadata, operation_ids = self._dynamic_fixture(root, selector)
                MODULE.verify(root, metadata, operation_ids)

    def test_dynamic_recorder_rejects_unregistered_caller(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, metadata, operation_ids = self._dynamic_fixture(root)
            source.write_text(source.read_text() +
                'fn leaked(ctx: &ReducerContext) { snapshot.record(ctx, "erp.execute"); }\n',
                encoding="utf-8")
            with self.assertRaisesRegex(MODULE.CoverageError, "unregistered dynamic C2 recorder call"):
                MODULE.verify(root, metadata, operation_ids)

    def test_dynamic_recorder_rejects_caller_identity_or_removed_record(self) -> None:
        for replacement in ('snapshot.record(ctx, "erp.tracked")', 'snapshot.record(ctx, caller_input)', ''):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source, metadata, operation_ids = self._dynamic_fixture(root)
                source.write_text(source.read_text().replace('snapshot.record(ctx, "erp.execute")', replacement),
                                  encoding="utf-8")
                with self.assertRaisesRegex(MODULE.CoverageError, "declared argument"):
                    MODULE.verify(root, metadata, operation_ids)

    def test_dynamic_recorder_rejects_open_selector(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, metadata, operation_ids = self._dynamic_fixture(root, selector=True)
            source.write_text(source.read_text().replace('else { "erp.execute" }', 'else { caller_input }'),
                              encoding="utf-8")
            with self.assertRaisesRegex(MODULE.CoverageError, "closed two-literal"):
                MODULE.verify(root, metadata, operation_ids)

    def test_dynamic_helper_rejects_literal_override_or_wrong_method_scope(self) -> None:
        for replacement in ('"erp.execute".to_string()', 'different_parameter.to_string()'):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source, metadata, operation_ids = self._dynamic_fixture(root)
                source.write_text(source.read_text().replace('operation_id.to_string()', replacement),
                                  encoding="utf-8")
                with self.assertRaises(MODULE.CoverageError):
                    MODULE.verify(root, metadata, operation_ids)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, metadata, operation_ids = self._dynamic_fixture(root)
            config = json.loads(metadata.read_text())
            config["dynamic_commit_helpers"][0]["snapshot_type"] = "UnrelatedSnapshot"
            metadata.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.CoverageError, "declared snapshot method"):
                MODULE.verify(root, metadata, operation_ids)

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
            source = root / "spacetimedb/src/core/example.rs"
            source.parent.mkdir(parents=True)
            (source.parent / "mod.rs").write_text("pub mod example;\n", encoding="utf-8")
            (root / "spacetimedb/src/lib.rs").write_text(
                "// ── Domain modules\npub mod core;\n"
                "/// Shared org/company/COA fixture\n",
                encoding="utf-8",
            )
            source.write_text(
                'fn registered() { let changes = vec![RowChange::upsert("row", key, value)]; '
                'record_organization_commit(ctx, OrganizationCommitInput { operation_id: "erp.registered", changes }); }\n'
                'fn unregistered() { record_organization_commit(ctx, OrganizationCommitInput { operation_id: "erp.unregistered", changes }); }\n',
                encoding="utf-8",
            )
            metadata = root / "coverage.json"
            metadata.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "reducers": [
                            {
                                "source": "spacetimedb/src/core/example.rs",
                                "function": "registered",
                                "operation": "registered",
                                "operation_id": "erp.registered",
                                "change_constructors": ["upsert"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            operation_ids = root / "operation-ids.json"
            operation_ids.write_text(
                json.dumps({"operations": {"registered": "erp.registered"}}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                MODULE.CoverageError,
                r"unregistered C2 commit call at spacetimedb/src/core/example.rs:unregistered",
            ):
                MODULE.verify(root, metadata, operation_ids)


if __name__ == "__main__":
    unittest.main()
