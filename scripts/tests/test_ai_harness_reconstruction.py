"""Offline tests for the AG-09 evidence checker; no runtime acceptance claim."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("ai_reconstruction", Path(__file__).parents[1] / "verify-ai-harness-reconstruction.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def fixtures():
    output = json.dumps({"summary": "persisted result", "data": {"rows": 1}, "citations": [], "row_count": 1})
    scoped = {
        "ai_agent_run": [{"id": 1, "company_id": 11, "agent_id": 9, "status": "running", "action_draft_ids": [1]}],
        "ai_agent_run_step": [{"id": 1, "run_id": 1, "step_no": 1}],
        "ai_price_snapshot": [{"id": 1, "agent_id": 9, "provider": "test", "model": "test", "currency": "USD"}],
        "ai_spend_budget": [{"id": 1, "agent_id": 9, "billing_period": "2026-09", "currency": "USD",
                             "limit_units": 100, "outstanding_units": 60, "settled_units": 0}],
        "ai_spend_reservation": [{"id": 1, "company_id": 11, "agent_id": 9, "run_id": 1, "request_key": "request",
                                  "provider": "test", "model": "test", "currency": "USD", "billing_period": "2026-09",
                                  "price_snapshot_id": 1, "reserved_units": 60, "settled_units": 0, "status": "reserved"}],
        "ai_provider_attempt": [{"id": 1, "company_id": 11, "agent_id": 9, "run_id": 1, "reservation_id": 1,
                                 "request_key": "request", "provider": "test", "model": "test", "status": "outcome_unknown"}],
        "ai_action_draft": [{"id": 1, "company_id": 11, "status": "pending", "executed_at": {"none": []}, "reviewed_by": None}],
        "ai_action_draft_request": [{"id": 1, "company_id": 11, "run_id": 1, "draft_id": 1, "request_key": "draft"}],
        "ai_capability_execution": [
            {"id": 1, "company_id": 11, "run_id": 1, "status": "succeeded", "recovery_key": "gp03:capability:" + "a" * 64,
             "output_json": {"some": output}, "output_hash": {"some": hashlib.sha256(output.encode()).hexdigest()}, "failure_reason": None},
            {"id": 2, "company_id": 11, "run_id": 1, "status": "claimed", "recovery_key": "gp03:capability:" + "b" * 64,
             "output_json": None, "output_hash": None},
        ],
    }
    for rows in scoped.values():
        for row in rows:
            row["organization_id"] = 1
    target = copy.deepcopy(scoped)
    source = copy.deepcopy(scoped)
    source["ai_agent_run"].append({"id": 99, "organization_id": 2, "status": "running"})
    return source, target


class ReconstructionTests(unittest.TestCase):
    def test_complete_rows_and_foreign_exclusion(self):
        source, target = fixtures()
        result = verifier.verify_snapshots(source, target, 1)
        self.assertEqual(len(result["tables"]), 9)
        self.assertEqual(result["foreign_source_rows_excluded"], 1)

    def test_missing_table_or_row_is_not_a_vacuous_pass(self):
        for table in verifier.TABLES:
            source, target = fixtures()
            del target[table]
            with self.subTest(table=table), self.assertRaises(ValueError):
                verifier.verify_snapshots(source, target, 1)
            source, target = fixtures()
            source[table] = target[table] = []
            with self.subTest(empty=table), self.assertRaises(ValueError):
                verifier.verify_snapshots(source, target, 1)

    def test_restore_corruption_is_rejected(self):
        for table, field, value in [
            ("ai_spend_budget", "outstanding_units", 0),
            ("ai_agent_run", "company_id", 99),
            ("ai_action_draft", "status", "approved"),
            ("ai_provider_attempt", "status", "accepted"),
        ]:
            source, target = fixtures()
            target[table][0][field] = value
            with self.subTest(table=table), self.assertRaises(ValueError):
                verifier.verify_snapshots(source, target, 1)

    def test_identical_but_invalid_snapshots_are_rejected(self):
        for table, field, value in [
            ("ai_spend_budget", "limit_units", 59),
            ("ai_spend_budget", "outstanding_units", 59),
            ("ai_spend_reservation", "price_snapshot_id", 99),
            ("ai_spend_reservation", "currency", "EUR"),
            ("ai_agent_run_step", "run_id", 99),
            ("ai_agent_run", "action_draft_ids", [1, 1]),
            ("ai_action_draft_request", "company_id", 99),
            ("ai_action_draft", "executed_at", {"some": 1}),
            ("ai_provider_attempt", "reservation_id", 99),
            ("ai_spend_reservation", "status", "settled"),
            ("ai_capability_execution", "output_hash", {"some": "c" * 64}),
            ("ai_capability_execution", "failure_reason", {"some": "failed"}),
        ]:
            source, target = fixtures()
            source[table][0][field] = target[table][0][field] = value
            with self.subTest(table=table, field=field), self.assertRaises(ValueError):
                verifier.verify_snapshots(source, target, 1)

    def test_foreign_restore_and_missing_foreign_source_fail(self):
        source, target = fixtures()
        target["ai_agent_run"].append(copy.deepcopy(source["ai_agent_run"][-1]))
        with self.assertRaises(ValueError):
            verifier.verify_snapshots(source, target, 1)
        source, target = fixtures()
        source["ai_agent_run"].pop()
        with self.assertRaises(ValueError):
            verifier.verify_snapshots(source, target, 1)

    def test_duplicate_correlation_or_execution_fails(self):
        for table in ("ai_action_draft_request", "ai_capability_execution"):
            source, target = fixtures()
            duplicate = copy.deepcopy(source[table][0])
            duplicate["id"] = 100
            source[table].append(duplicate)
            target[table].append(copy.deepcopy(duplicate))
            with self.subTest(table=table), self.assertRaises(ValueError):
                verifier.verify_snapshots(source, target, 1)

    def test_resume_repeat_and_provider_observation_must_match(self):
        coverage = {"organization_id": 1, "watermark": {"sequence": 1, "commit_checksum": "a" * 64}}
        replay = {"verified": True, **copy.deepcopy(coverage)}
        dispatch = {"observation_complete": True, "source_module": verifier.SOURCE, "target_module": verifier.TARGET,
                    "before": 2, "after": 2, **copy.deepcopy(coverage)}
        self.assertEqual(verifier.verify_reports(coverage, replay, replay, dispatch)[0], 1)
        for field, value in [("after", 3), ("before", True), ("observation_complete", False), ("target_module", "production")]:
            bad = {**dispatch, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                verifier.verify_reports(coverage, replay, replay, bad)
        with self.assertRaises(ValueError):
            verifier.verify_reports(coverage, {**replay, "verified": False}, replay, dispatch)

    def test_loopback_only(self):
        for host in ("http://127.0.0.1:3000", "http://localhost:3000"):
            self.assertEqual(verifier.loopback_host(host), host)
        for host in ("https://localhost", "http://example.com", "http://user:pass@localhost", "http://localhost/path", "http://localhost?token=x"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                verifier.loopback_host(host)


if __name__ == "__main__":
    unittest.main()
