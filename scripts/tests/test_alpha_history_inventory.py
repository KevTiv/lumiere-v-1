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
    "alpha_history_inventory", ROOT / "scripts/generate-alpha-history-inventory.py"
)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class ScopeTests(unittest.TestCase):
    def test_unknown_alpha_surface_cannot_silently_omit_history(self):
        source = (ROOT / inventory.PROFILE).read_text()
        with self.assertRaisesRegex(ValueError, "unclassified alpha surfaces: payroll"):
            inventory.profile_surfaces(source.replace('"fleet"', '"fleet", "payroll"'))

    def test_changed_profile_shape_requires_owner_review(self):
        with self.assertRaisesRegex(ValueError, "cannot resolve alpha profile set"):
            inventory.profile_surfaces("export const ALPHA_MODULES = new Map()")

    def test_sales_visibility_never_admits_pos(self):
        self.assertEqual(inventory.modules_for("create_pos_config", "sales/pos_config.rs", ["sales"])[0], [])

    def test_bounded_inventory_does_not_admit_arbitrary_inventory_files(self):
        self.assertEqual(inventory.modules_for("create_cross_dock", "inventory/cross_dock.rs", ["warehouse"])[0], [])
        self.assertEqual(inventory.modules_for("create_product", "inventory/product.rs", ["products", "warehouse"])[0], ["products"])

    def test_calendar_uses_its_actual_crm_file_without_becoming_a_crm_edit(self):
        modules, _ = inventory.modules_for("create_calendar_event", "spacetimedb/src/crm/activities.rs", ["calendar", "crm", "tasks"])
        self.assertEqual(modules, ["calendar"])

    def test_hidden_project_and_employee_references_are_linked_only(self):
        modules, status = inventory.modules_for("create_task", "projects/tasks.rs", ["tasks"])
        self.assertEqual((modules, status), (["tasks"], "linked-project-task-only"))
        modules, status = inventory.modules_for("import_hr_employee_csv", "data_ops/hr_imports.rs", ["expenses", "settings"])
        self.assertEqual((modules, status), (["expenses", "settings"], "reference-import-only"))

    def test_audit_and_direct_capture_signals_remain_uncertified(self):
        finance = inventory.load_finance(ROOT)
        missing = finance.source_signals(None, {})
        self.assertEqual(inventory.history_status(missing), "source-unresolved")
        audit = finance.source_signals({"body": "write_audit_log(ctx, org, row);", "signature": ""}, {})
        self.assertEqual(inventory.history_status(audit), "audit-only-completeness-and-trust-unverified")
        capture = finance.source_signals({"body": "capture_business_change(ctx, row)?;", "signature": ""}, {})
        self.assertEqual(inventory.history_status(capture), "trusted-helper-observed-branch-and-fields-unverified")

    def test_business_audit_adapter_is_trusted_but_cannot_certify_material_fields(self):
        finance = inventory.load_finance(ROOT)
        row = {"body": 'write_business_audit(ctx, org, "edit", params)?;', "signature": ""}
        signals = inventory.source_signals(finance, row, {})
        self.assertTrue(signals["business_audit_adapter_call"])
        self.assertTrue(signals["trusted_capture_call"])
        self.assertTrue(signals["audit_call"])
        self.assertFalse(signals["old_values_recorded"])
        self.assertFalse(signals["new_values_recorded"])
        self.assertEqual(inventory.history_status(signals), "trusted-helper-observed-branch-and-fields-unverified")

    def test_private_only_adapter_has_direct_and_delegated_trusted_signals(self):
        finance = inventory.load_finance(ROOT)
        row = {"source": "owner.rs", "line": 20,
               "body": 'write_private_business_audit(ctx, org, "edit", params)?;', "signature": ""}
        signal = inventory.source_signals(finance, row, {})
        self.assertTrue(signal["private_values_adapter_call"])
        self.assertTrue(signal["trusted_capture_call"])
        start = {"source": "owner.rs", "line": 10, "body": "create(ctx);"}
        observation = inventory.capture_observation(start, {"create": [row]})
        self.assertEqual(observation["private_providers"], inventory.PRIVATE_PROVIDERS)
        self.assertFalse(observation["legacy_audit_signal"])

    def test_guarded_standalone_path_is_excluded_from_private_provider_count(self):
        start = {"source": "owner.rs", "line": 10, "body": "create_record(ctx);"}
        target = {"source": "helper.rs", "line": 20,
                  "body": 'write_private_business_audit(ctx, org, "create_thing", params)?;'}
        result = inventory.capture_observation(start, {"create_record": [target]}, blocked_operations={"create_thing"})
        self.assertFalse(result["private_providers"])
        self.assertEqual(result["guarded_legacy_operations"], ["create_thing"])

    def test_unmerged_capture_vector_does_not_count_as_private_history(self):
        row = {"source": "owner.rs", "line": 20, "function": "owner",
               "body": 'capture_private_business_audit(ctx, org, "create_thing", params)?;'}
        result = inventory.capture_observation(row, {}, complete_owners={("owner.rs", "owner")})
        self.assertFalse(result["private_providers"])
        self.assertTrue(result["unmerged_capture_only"])
        row["body"] += 'record_organization_commit(ctx, OrganizationCommitInput { changes: merge_business_audit_changes(rows, evidence)? })?;'
        result = inventory.capture_observation(row, {}, complete_owners={("owner.rs", "owner")})
        self.assertTrue(result["private_providers"])
        self.assertTrue(result["paths"][0]["owner_merged_capture_signal"])

    def test_dynamic_capture_policy_is_not_guessed_from_helper_name(self):
        row = {"source": "helper.rs", "line": 20, "function": "helper",
               "body": "write_business_audit(ctx, org, operation, params)?;"}
        result = inventory.capture_observation(row, {})
        self.assertFalse(result["private_providers"])
        self.assertTrue(result["unresolved_policy"])

    def test_missing_service_owner_cannot_disappear_silently(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(inventory, "SERVICE_PATHS", [("example", "route.rs", "missing", "settings")]):
            root = Path(directory)
            (root / "route.rs").write_text("async fn other() {}")
            with self.assertRaisesRegex(ValueError, "unresolved source/import service path"):
                inventory.service_paths(root)

    def test_delegated_capture_is_a_path_signal_and_not_an_executed_effect(self):
        start = {"source": "owner.rs", "line": 10, "body": "create_record(ctx)?;"}
        target = {"source": "owner.rs", "line": 20, "body": 'write_business_audit(ctx, org, "create", params)?;'}
        result = inventory.capture_observation(start, {"create_record": [target]})
        self.assertEqual(result["private_providers"], inventory.PRIVATE_PROVIDERS)
        self.assertFalse(result["import_receipt_signal"])
        self.assertEqual(result["paths"][0]["source_path"], ["owner.rs:10", "owner.rs:20"])

    def test_raw_audit_and_literals_never_become_delegated_private_capture(self):
        start = {"source": "owner.rs", "line": 10,
                 "body": 'let text = "write_business_audit(ctx)"; log_audit_event(ctx);'}
        result = inventory.capture_observation(start, {})
        self.assertFalse(result["private_providers"])
        self.assertFalse(result["import_receipt_signal"])

    def test_ambiguous_helpers_do_not_claim_another_modules_capture(self):
        start = {"source": "owner.rs", "line": 10, "body": "create(ctx);"}
        targets = [{"source": source, "line": 20, "body": "capture_business_change(ctx)?;"}
                   for source in ("one.rs", "two.rs")]
        self.assertFalse(inventory.capture_observation(start, {"create": targets})["private_providers"])

    def test_import_receipt_is_not_private_field_change_capture(self):
        start = {"source": "import.rs", "line": 10, "body": "record_import_created_id(ctx);"}
        target = {"source": "import_tracker.rs", "line": 20,
                  "body": "ctx.db.import_job_record().insert(row);"}
        result = inventory.capture_observation(start, {"record_import_created_id": [target]})
        self.assertTrue(result["import_receipt_signal"])
        self.assertFalse(result["private_providers"])

    def test_existing_domain_evidence_remains_distinct_from_private_history(self):
        start = {"source": "workflow.rs", "line": 10, "body": "append_event(ctx);"}
        target = {"source": "workflow.rs", "line": 20,
                  "body": "ctx.db.workflow_human_task_event().insert(event);"}
        result = inventory.capture_observation(start, {"append_event": [target]})
        self.assertEqual(result["domain_evidence_tables"], ["workflow_human_task_event"])
        self.assertFalse(result["private_providers"])

    def test_delegated_returning_audit_is_not_private_capture(self):
        start = {"source": "owner.rs", "line": 10, "body": "audit(ctx);"}
        target = {"source": "owner.rs", "line": 20, "body": "write_audit_log_v2_returning(ctx, org, params);"}
        result = inventory.capture_observation(start, {"audit": [target]})
        self.assertTrue(result["legacy_audit_signal"])
        self.assertFalse(result["private_providers"])

    def test_cycles_end_without_manufacturing_capture(self):
        start = {"source": "owner.rs", "line": 10, "body": "again(ctx);"}
        self.assertFalse(inventory.capture_observation(start, {"again": [start]})["paths"])


class RepositoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = inventory.build_inventory(ROOT)
        cls.rows = {row["operation"]: row for row in cls.payload["operations"]}

    def test_every_current_alpha_surface_has_an_owner(self):
        self.assertEqual(set(self.payload["scope"]["surfaces"]), set(inventory.MODULES))
        for row in self.payload["surfaces"]:
            if row["surface"] != "overview":
                self.assertGreater(row["operation_candidates"], 0, row)
        self.assertEqual(self.payload["summary"]["runtime_certified"], 0)

    def test_canonical_ids_and_native_locations_are_unique(self):
        ids = [row["operation_id"] for row in self.rows.values() if row["operation_id"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(self.payload["summary"]["unresolved_native_source"], 0)
        self.assertTrue(all((ROOT / row["source"]).is_file() for row in self.rows.values()))

    def test_raw_reported_audit_is_not_a_business_history_producer(self):
        self.assertNotIn("log_audit_event", self.rows)
        self.assertNotIn("create_pos_config", self.rows)
        self.assertNotIn("create_manufacturing_order", self.rows)
        self.assertEqual(self.rows["create_calendar_event"]["modules"], ["calendar"])

    def test_service_paths_cover_non_native_onboarding_decisions(self):
        paths = {row["path_id"] for row in self.payload["service_paths"]}
        self.assertTrue({"source-review-decision", "source-review-bulk-decision", "source-admission", "native-import-recovery"} <= paths)
        self.assertTrue(all(not row["runtime_evidence"] for row in self.payload["service_paths"]))

    def test_boundaries_and_capture_gaps_are_explicit(self):
        for row in self.rows.values():
            self.assertIsNone(row["capture_start"])
            self.assertFalse(row["runtime_evidence"])
            self.assertEqual(row["admission"], "entry-path-review-required-not-proven-by-session-exposure")
            self.assertEqual(row["certification"], "not-certified-by-static-inventory")
        self.assertIn("no-direct-history-signal", self.payload["summary"]["by_history_status"])

    def test_company_and_organization_providers_remain_distinct(self):
        providers = {row["provider"]: row for row in self.payload["provider_contracts"]}
        self.assertEqual(providers["business_change"]["scope"], "organization-and-company")
        self.assertEqual(providers["organization_business_change"]["scope"], "organization-wide-explicit")
        self.assertEqual(providers["import_job_record"]["material_completeness"], "import-outcome-not-field-change-evidence-or-original-file-proof")

    def test_typed_import_capture_uses_actual_source_scope_without_duplicate_operations(self):
        producers = {row["operation"]: row for row in self.payload["typed_import_capture_producers"]}
        self.assertEqual(set(producers), {"import_product_csv", "import_contact_csv", "import_stock_location_csv",
                                         "import_account_move_csv", "import_account_move_line_csv"})
        self.assertEqual(producers["import_product_csv"]["private_provider_candidates"], ["organization_business_change"])
        self.assertEqual(producers["import_account_move_csv"]["private_provider_candidates"], ["business_change"])
        self.assertEqual(producers["import_contact_csv"]["private_provider_candidates"], inventory.PRIVATE_PROVIDERS)
        for operation in producers:
            row = self.rows[operation]
            self.assertFalse(row["capture_observation"]["private_providers"])
            self.assertTrue(row["capture_observation"]["import_receipt_signal"])
            self.assertEqual(row["history_status"], "capture-not-merged-no-private-history")

    def test_tracked_import_scope_is_conditional_and_never_a_universal_provider_count(self):
        row = self.rows["import_csv_tracked"]
        self.assertEqual(row["history_status"], "conditional-typed-import-owner-not-universal-history")
        self.assertFalse(row["capture_observation"]["private_providers"])
        targets = row["capture_observation"]["conditional_provider_targets"]
        self.assertEqual(set(targets), {"product", "contact", "stock_location", "account_move", "account_move_line"})
        self.assertNotIn("budget", targets)
        self.assertEqual(targets["product"], ["organization_business_change"])
        self.assertEqual(targets["account_move"], ["business_change"])

    def test_guarded_legacy_roots_do_not_enter_private_capture_counts(self):
        guarded = [row for row in self.rows.values() if row["history_status"] == "guarded-owner-fallback-no-private-capture"]
        self.assertTrue(guarded)
        for row in guarded:
            self.assertTrue(row["capture_observation"]["guarded_legacy_operations"])
            self.assertFalse(row["capture_observation"]["private_providers"])
        self.assertTrue(self.rows["add_document_version"]["owner_merged_capture_signal"])

    def test_module_counts_classify_every_candidate_without_double_counting_shared_events(self):
        summary = self.payload["summary"]
        self.assertEqual(sum(summary["by_history_status"].values()), summary["operation_candidates"])
        for module, count in summary["by_surface"].items():
            self.assertEqual(sum(summary["by_surface_and_history_status"][module].values()), count)
        self.assertGreater(sum(summary["by_surface"].values()), summary["operation_candidates"])
        self.assertEqual(len(self.rows), summary["operation_candidates"])

    def test_source_changes_are_bound_by_input_digests(self):
        paths = {row["path"] for row in self.payload["inputs"]}
        self.assertTrue({inventory.PROFILE, inventory.BOUNDED_TABS, "spacetimedb/src/helpers.rs"} <= paths)
        self.assertTrue({row["source"] for row in self.rows.values()} <= paths)


class CheckModeTests(unittest.TestCase):
    def test_check_detects_stale_output_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / inventory.OUTPUT
            output.parent.mkdir(parents=True)
            output.write_text("stale\n")
            with mock.patch.object(inventory, "build_inventory", return_value={"schema_version": 1}), \
                    mock.patch.object(inventory, "load_finance", return_value=inventory.load_finance(ROOT)), \
                    mock.patch("sys.argv", ["inventory", "--root", str(root), "--check"]), \
                    redirect_stderr(io.StringIO()):
                self.assertEqual(inventory.main(), 1)
            self.assertEqual(output.read_text(), "stale\n")

    def test_check_accepts_exact_evidence(self):
        finance = inventory.load_finance(ROOT)
        payload = {"schema_version": 1}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / inventory.OUTPUT
            output.parent.mkdir(parents=True)
            output.write_text(finance.render(payload))
            with mock.patch.object(inventory, "build_inventory", return_value=payload), \
                    mock.patch.object(inventory, "load_finance", return_value=finance), \
                    mock.patch("sys.argv", ["inventory", "--root", str(root), "--check"]), \
                    redirect_stdout(io.StringIO()):
                self.assertEqual(inventory.main(), 0)


if __name__ == "__main__":
    unittest.main()
