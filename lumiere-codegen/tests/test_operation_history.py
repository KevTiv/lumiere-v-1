#!/usr/bin/env python3
"""Focused tests for the C4 operation identity and shape-history gate."""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "verify_operation_history", ROOT / "scripts/verify-operation-history.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def ir_with(*operations):
    return {"ir_version": 2, "operations": list(operations)}


def operation(name="create_order", operation_id="erp.create_order", **changes):
    value = {
        "name": name,
        "contract_operation_id": operation_id,
        "application": {
            "params": [{"name": "organization_id", "kind": "u64"}],
            "client_input": {"fields": []},
            "exposure": "session",
        },
        "schema": {"name": name, "params": {"elements": []}},
        "target": {"kind": "spacetimedb_reducer", "name": name},
        "source_kind": "reducer",
        "input": {"kind": "operation_parameters", "parameter_positions": []},
        "output": {"kind": "unit"},
        "invalidates": [],
    }
    value.update(changes)
    return value


def history_for(ir):
    return MODULE.build_history_from_value(ir)


class OperationHistoryTests(unittest.TestCase):
    def write_and_verify(self, ir, history):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ir_path = root / "ir.json"
            history_path = root / "history.json"
            ir_path.write_text(json.dumps(ir), encoding="utf-8")
            history_path.write_text(json.dumps(history), encoding="utf-8")
            MODULE.verify(ir_path, history_path)

    def test_current_pinned_history_passes(self):
        MODULE.verify(
            ROOT / ".contracts-staging/ir/lumiere-contract-ir-v2.json",
            ROOT / "lumiere-codegen/contract-operation-history.json",
        )

    def test_shape_fingerprint_ignores_source_provenance(self):
        original = operation()
        changed = copy.deepcopy(original)
        changed["source_commit"] = "not-contract-shape"
        changed["source_dirty"] = True
        self.assertEqual(MODULE.shape_fingerprint(original), MODULE.shape_fingerprint(changed))

    def test_missing_and_added_ids_fail_closed(self):
        ir = ir_with(operation())
        history = MODULE.build_history_from_value(ir)
        changed = ir_with(operation(operation_id="erp.renamed_order"))
        with self.assertRaisesRegex(MODULE.OperationHistoryError, "ID set changed"):
            self.verify_value(changed, history)

    def test_duplicate_current_ids_fail_closed(self):
        first = operation()
        second = operation(name="other_order")
        with self.assertRaisesRegex(MODULE.OperationHistoryError, "duplicate current"):
            self.verify_value(ir_with(first, second), MODULE.build_history_from_value(ir_with(first)))

    def test_reused_retired_id_fails_closed(self):
        ir = ir_with(operation())
        history = MODULE.build_history_from_value(ir)
        history["retired_ids"] = ["erp.create_order"]
        with self.assertRaisesRegex(MODULE.OperationHistoryError, "reuse retired"):
            self.verify_value(ir, history)

    def test_unapproved_shape_change_fails_closed(self):
        ir = ir_with(operation())
        history = MODULE.build_history_from_value(ir)
        changed = ir_with(operation(application={"params": [{"name": "order_id", "kind": "u64"}]}))
        with self.assertRaisesRegex(MODULE.OperationHistoryError, "unapproved shape"):
            self.verify_value(changed, history)

    def test_target_reducer_change_fails_closed(self):
        ir = ir_with(operation())
        history = MODULE.build_history_from_value(ir)
        changed_operation = operation()
        changed_operation["target"]["name"] = "create_order_v2"
        changed = ir_with(changed_operation)
        with self.assertRaisesRegex(MODULE.OperationHistoryError, "unapproved shape"):
            self.verify_value(changed, history)

    def test_future_application_contract_field_fails_closed(self):
        ir = ir_with(operation())
        history = MODULE.build_history_from_value(ir)
        changed_operation = operation()
        changed_operation["application"]["future_semantic"] = {"required": True}
        with self.assertRaisesRegex(MODULE.OperationHistoryError, "unapproved shape"):
            self.verify_value(ir_with(changed_operation), history)

    def test_exact_compatibility_exception_allows_shape_change(self):
        ir = ir_with(operation())
        history = MODULE.build_history_from_value(ir)
        changed = ir_with(operation(application={"params": [{"name": "order_id", "kind": "u64"}]}))
        old_fingerprint = history["operations"]["erp.create_order"]["shape_fingerprint"]
        new_fingerprint = MODULE.shape_fingerprint(changed["operations"][0])
        history["compatibility_exceptions"] = [{
            "operation_id": "erp.create_order",
            "previous_fingerprint": old_fingerprint,
            "current_fingerprint": new_fingerprint,
            "reason": "approved parameter shape migration",
        }]
        self.verify_value(changed, history)

    def verify_value(self, ir, history):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ir_path = root / "ir.json"
            history_path = root / "history.json"
            ir_path.write_text(json.dumps(ir), encoding="utf-8")
            history_path.write_text(json.dumps(history), encoding="utf-8")
            MODULE.verify(ir_path, history_path)


if __name__ == "__main__":
    unittest.main()
