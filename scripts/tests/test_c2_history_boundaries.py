import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("c2_history_boundaries", ROOT / "scripts/verify-c2-commit-coverage.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class HistoryBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metadata = json.loads((ROOT / "lumiere-codegen/c2-commit-coverage.json").read_text())
        cls.locked = json.loads((ROOT / "lumiere-codegen/contract-operation-ids.json").read_text())["operations"]

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.data = copy.deepcopy(self.metadata)
        paths = {row["source"] for key in ("evidence_journals", "conditional_outcomes") for row in self.data[key]}
        for entry in self.data["evidence_journals"]:
            paths.add(entry["owner_policy"])
            paths.update(row["source"] for row in entry["passthrough_helpers"])
        for name in paths:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text((ROOT / name).read_text())

    def replace(self, source, before, after):
        path = self.root / source
        content = path.read_text()
        self.assertIn(before, content)
        path.write_text(content.replace(before, after))

    def test_evidence_journal_has_no_complete_operation_registration(self):
        calls = set()
        checker._validate_evidence_journals(self.root, self.data, self.locked, calls)
        journal = self.data["evidence_journals"][0]
        self.assertIn((journal["source"], journal["function"]), calls)
        self.assertNotIn("operation", journal)
        self.assertFalse(any(row["source"] == journal["source"] and row["function"] == journal["function"]
                             for row in self.data["reducers"]))

    def test_evidence_journal_cannot_be_promoted_to_complete_outcome(self):
        self.data["evidence_journals"][0]["classification"] = "complete-business-outcome"
        with self.assertRaisesRegex(checker.CoverageError, "cannot claim complete"):
            checker._validate_evidence_journals(self.root, self.data, self.locked, set())

    def test_business_source_table_cannot_enter_evidence_only_journal(self):
        self.data["evidence_journals"][0]["evidence_tables"].append("sale_order")
        with self.assertRaisesRegex(checker.CoverageError, "only append audit"):
            checker._validate_evidence_journals(self.root, self.data, self.locked, set())

    def test_missing_guard_cannot_capture_a_prefix_before_complete_outcome(self):
        source = self.data["evidence_journals"][0]["source"]
        self.replace(source, "if standalone_journal_blocked(operation)?", "if false")
        with self.assertRaisesRegex(checker.CoverageError, "policy before capture"):
            checker._validate_evidence_journals(self.root, self.data, self.locked, set())

    def test_native_operation_cannot_be_replaced_by_unlocked_identity(self):
        source = self.data["evidence_journals"][0]["source"]
        self.replace(source, 'format!("erp.{operation}")', '"erp.unlocked".into()')
        with self.assertRaisesRegex(checker.CoverageError, "producer-owned canonical operation"):
            checker._validate_evidence_journals(self.root, self.data, self.locked, set())

    def test_evidence_journal_cannot_bypass_declared_native_wrappers(self):
        path = self.root / "spacetimedb/src/bypass.rs"
        path.write_text('fn bypass() { write_business_audit_inner(ctx, org, "create_message_batch", params, true); }')
        with self.assertRaisesRegex(checker.CoverageError, "only be called by its declared"):
            checker._validate_evidence_journals(self.root, self.data, self.locked, set())

    def test_native_writer_rejects_unlocked_producer_literal(self):
        path = self.root / "spacetimedb/src/new_producer.rs"
        path.write_text('fn producer() { write_business_audit(ctx, org, "unlocked_producer", params); }')
        with self.assertRaisesRegex(checker.CoverageError, "unlocked operation"):
            checker._validate_evidence_journals(self.root, self.data, self.locked, set())

    def test_tracked_owner_is_scoped_without_universal_operation_admission(self):
        calls = set()
        checker._validate_conditional_outcomes(self.root, self.data, self.locked, calls)
        owner = self.data["conditional_outcomes"][0]
        self.assertIn((owner["source"], owner["function"]), calls)
        self.assertFalse(any(row["operation"] == owner["operation"] for row in self.data["reducers"]))
        self.assertEqual(len(owner["targets"]), 5)

    def test_conditional_import_scope_cannot_expand_to_all_csv_targets(self):
        self.data["conditional_outcomes"][0]["targets"].append("budget")
        with self.assertRaisesRegex(checker.CoverageError, "explicit source-owner review"):
            checker._validate_conditional_outcomes(self.root, self.data, self.locked, set())

    def test_conditional_import_cannot_claim_universal_coverage(self):
        self.data["conditional_outcomes"][0]["classification"] = "complete-business-outcome"
        with self.assertRaisesRegex(checker.CoverageError, "cannot claim universal"):
            checker._validate_conditional_outcomes(self.root, self.data, self.locked, set())

    def test_conditional_source_guard_must_match_declared_targets(self):
        source = self.data["conditional_outcomes"][0]["source"]
        self.replace(source, '"product" | "contact"', '"budget" | "contact"')
        with self.assertRaisesRegex(checker.CoverageError, "unadmitted target"):
            checker._validate_conditional_outcomes(self.root, self.data, self.locked, set())

    def test_conditional_import_requires_exact_sealed_provenance(self):
        source = self.data["conditional_outcomes"][0]["source"]
        self.replace(source, '"sha256"', '"unknown_hash"')
        with self.assertRaisesRegex(checker.CoverageError, "sealed native provenance"):
            checker._validate_conditional_outcomes(self.root, self.data, self.locked, set())

    def test_conditional_import_requires_exact_audit_pointer_matching(self):
        source = self.data["conditional_outcomes"][0]["source"]
        self.replace(source, "audit_matches(", "infer_audit(")
        with self.assertRaisesRegex(checker.CoverageError, "exact staged evidence"):
            checker._validate_conditional_outcomes(self.root, self.data, self.locked, set())


if __name__ == "__main__":
    unittest.main()
