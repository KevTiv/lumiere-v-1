import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "finance_change_review_inventory", ROOT / "scripts/generate-finance-change-review-inventory.py"
)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class SourceBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = inventory.load_tool(ROOT, "verify-c2-commit-coverage.py", "finance_test_c2")
        cls.census = inventory.load_tool(ROOT, "generate-operation-census.py", "finance_test_census")

    def test_source_inventory_handles_both_reducer_attributes_and_ignores_commented_calls(self):
        source = '''
pub struct UpdateParams {
    pub label: Option<String>,
}
#[reducer]
pub fn update_thing(ctx: &ReducerContext, params: UpdateParams) -> Result<(), String> {
    // write_audit_log_v2(ctx, organization_id, fake);
    // old_values: Some(untrusted)
    ctx.db.thing().id().update(value);
    Ok(())
}
#[spacetimedb::reducer]
pub fn capture_thing(ctx: &ReducerContext) -> Result<(), String> {
    capture_business_change(ctx, captured)?;
    Ok(())
}
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "spacetimedb/src/accounting/thing.rs"
            path.parent.mkdir(parents=True)
            path.write_text(source)
            functions, structs = inventory.source_inventory(root, self.parser)
        self.assertTrue(functions["update_thing"][0]["native_reducer"])
        self.assertTrue(functions["capture_thing"][0]["native_reducer"])
        signal = inventory.source_signals(functions["update_thing"][0], structs)
        self.assertFalse(signal["audit_call"])
        self.assertFalse(signal["old_values_recorded"])
        self.assertEqual(signal["tables_accessed"], ["thing"])
        self.assertEqual(signal["parameter_products"][0]["definitions"][0]["fields"],
                         [{"name": "label", "rust_type": "Option<String>"}])
        captured = inventory.source_signals(functions["capture_thing"][0], structs)
        self.assertTrue(captured["trusted_capture_call"])
        self.assertEqual(captured["capture_coverage"], "partial-control-flow-owner-review-required")

    def test_missing_source_cannot_claim_audit_or_capture(self):
        signal = inventory.source_signals(None, {})
        self.assertEqual(signal["status"], "source-not-resolved")
        self.assertFalse(signal["audit_call"])
        self.assertFalse(signal["trusted_capture_call"])
        self.assertEqual(signal["parameter_products"], [])

    def test_pos_is_not_admitted_just_because_sales_is_visible(self):
        contract = {"evidence": "sales/pos_config.rs: mutation", "client_facing": True}
        self.assertEqual(inventory.modules_for("create_pos_config", contract, self.census), [])

    def test_imports_keep_their_finance_owner_and_shared_workflow_is_explicit(self):
        self.assertEqual(inventory.modules_for("import_subscription_csv", {
            "evidence": "data_ops/subscription_imports.rs: mutation", "client_facing": True,
        }, self.census), ["Subscriptions"])
        self.assertEqual(inventory.modules_for("decide_workflow_human_task", {
            "evidence": "workflow/approvals.rs: mutation", "client_facing": True,
        }, self.census), ["Accounting", "Sales", "Purchasing", "Expenses"])

    def test_unknown_client_operation_does_not_gain_a_finance_owner(self):
        self.assertEqual(inventory.modules_for("unowned_new_operation", {
            "evidence": "unreviewed evidence", "client_facing": True,
        }, self.census), [])

    def test_dynamic_commit_registration_does_not_drop_indirect_domain_operations(self):
        registrations = inventory.commit_registrations({"reducers": [], "dynamic_commit_helpers": [{
            "source": "spacetimedb/src/accounting/effects.rs", "function": "record",
            "callers": [{"operations": {"post_payment": "erp.post_payment"}}],
        }]})
        self.assertEqual(registrations, {
            "post_payment": ["spacetimedb/src/accounting/effects.rs::record"]
        })

    def test_duplicate_operation_contracts_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "lumiere-codegen/operation-contracts"
            folder.mkdir(parents=True)
            content = json.dumps({"operations": {"update_thing": {}}})
            (folder / "one.json").write_text(content)
            (folder / "two.json").write_text(content)
            with self.assertRaisesRegex(ValueError, "duplicate canonical operation"):
                inventory.load_contracts(root)


class RepositoryInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = inventory.build_inventory(ROOT)
        cls.rows = {row["operation"]: row for row in cls.payload["operations"]}

    def test_scope_covers_all_seven_modules_without_claiming_history_acceptance(self):
        self.assertEqual(set(self.payload["summary"]["by_module"]), set(inventory.MODULES))
        self.assertTrue(all(self.payload["summary"]["by_module"].values()))
        self.assertEqual(self.payload["summary"]["history_certified"], 0)
        self.assertEqual(self.payload["row_defaults"]["certification"], "not-certified-by-static-inventory")

    def test_all_current_finance_native_sources_resolve_and_identity_is_unique(self):
        ids = [row["operation_id"] for row in self.rows.values() if row["operation_id"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(self.payload["summary"]["unresolved_native_source"], 0)
        self.assertTrue(all((ROOT / row["source"]).is_file() for row in self.rows.values()))

    def test_raw_audit_is_not_trusted_finance_capture_and_allocation_remains_classified(self):
        self.assertNotIn("log_audit_event", self.rows)
        row = self.rows["allocate_payment_transaction"]
        self.assertEqual(row["modules"], ["Accounting"])
        self.assertNotIn("proposal", row)
        self.assertEqual(self.payload["row_defaults"]["history"], "required-capture-not-certified-for-commands")

    def test_native_invoice_wrapper_source_is_used_instead_of_contract_evidence_guess(self):
        row = self.rows["create_manual_invoice"]
        self.assertEqual(row["source"], "spacetimedb/src/accounting/journal_entries.rs")
        self.assertGreater(row["line"], 0)
        self.assertEqual(self.payload["scope"]["session_exposure_is_not_UI_admission"], True)

    def test_parameter_products_are_evidence_references_without_copied_type_schemas(self):
        for row in self.rows.values():
            for product in row.get("params", []):
                self.assertIn(product, self.payload["parameter_products"])
                for definition in self.payload["parameter_products"][product]:
                    self.assertEqual(set(definition), {"source", "field_names"})

    def test_render_is_deterministic(self):
        self.assertEqual(inventory.render(self.payload), inventory.render(json.loads(inventory.render(self.payload))))


class CheckModeTests(unittest.TestCase):
    def test_check_mode_detects_stale_evidence_without_writing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / inventory.OUTPUT
            output.parent.mkdir(parents=True)
            output.write_text("stale\n")
            stderr = io.StringIO()
            with mock.patch.object(inventory, "build_inventory", return_value={"schema_version": 1}), \
                    mock.patch("sys.argv", ["inventory", "--root", str(root), "--check"]), \
                    redirect_stderr(stderr):
                self.assertEqual(inventory.main(), 1)
            self.assertEqual(output.read_text(), "stale\n")
            self.assertIn("stale", stderr.getvalue())

    def test_check_mode_accepts_the_exact_evidence(self):
        payload = {"schema_version": 1}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / inventory.OUTPUT
            output.parent.mkdir(parents=True)
            output.write_text(inventory.render(payload))
            with mock.patch.object(inventory, "build_inventory", return_value=payload), \
                    mock.patch("sys.argv", ["inventory", "--root", str(root), "--check"]), \
                    redirect_stdout(io.StringIO()):
                self.assertEqual(inventory.main(), 0)


if __name__ == "__main__":
    unittest.main()
