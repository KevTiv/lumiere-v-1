import importlib.util
import subprocess
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "measure_ci", Path(__file__).resolve().parents[1] / "measure-ci-builds.py")
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
START = "2026-10-21T10:00:00Z"
END = "2026-10-21T10:01:00Z"


def step(name, status="completed", conclusion="success"):
    return dict(name=name, status=status, conclusion=conclusion,
                started_at=START, completed_at=END)


def job(id=1, **updates):
    return dict(id=id, name="Build exact-commit E2E artifacts", status="completed",
                conclusion="success", created_at=START, started_at=START, completed_at=END,
                steps=[step("Set up job"), step("Compile E2E module")], **updates)


def snapshot(*jobs):
    return dict(captured_at=END, repository="owner/repo", samples=[
        dict(run=dict(id=10, name="E2E smoke"), jobs=list(jobs))])


class MeasurementTests(unittest.TestCase):
    def test_cache_inventory_reports_scope_sizes_and_denied_access(self):
        inventory = {"usage": {"active_caches_count": 2, "active_caches_size_in_bytes": 30},
                     "entries": [{"ref": "refs/heads/main", "size_in_bytes": 10},
                                 {"ref": "refs/pull/1/merge", "size_in_bytes": 20}], "truncated": False}
        result = M.analyse(snapshot(), [], inventory)
        self.assertEqual(result["cache_inventory"]["by_ref"]["refs/heads/main"]["bytes"], 10)
        self.assertEqual(result["cache_inventory"]["by_ref"]["refs/pull/1/merge"]["entries"], 1)
        with patch.object(M, "api", side_effect=subprocess.CalledProcessError(1, "gh")):
            denied = M.collect_inventory("owner/repo")
        self.assertIn("unconfirmed", denied["errors"][0]["error"])
        self.assertFalse(M.analyse(snapshot(), [], denied)["cache_inventory"]["available"])

    def test_bad_timestamps_and_p90(self):
        self.assertIsNone(M.seconds(None, END))
        self.assertIsNone(M.seconds(END, START))
        self.assertIsNone(M.seconds("bad", END))
        self.assertEqual(M.stats([None]), {"n": 0})
        self.assertEqual(M.stats(range(1, 11))["p90_seconds"], 9)

    def test_running_job_is_not_a_zero_duration_build(self):
        running = job()
        running.update(status="in_progress", conclusion=None, completed_at=None)
        running["steps"].append(step("Compile and validate E2E API binaries", "in_progress", None))
        result = M.analyse(snapshot(running), [])
        self.assertNotIn("E2E artifact job (total)", result["successful_step_timings"])
        self.assertNotIn("Compile and validate E2E API binaries", result["successful_step_timings"])
        self.assertEqual(result["successful_step_timings"]["Compile E2E module"]["n"], 1)
        self.assertEqual(result["active_jobs"][0]["elapsed_seconds"], 60)

    def test_cancelled_unstarted_jobs_and_duplicates_do_not_inflate_queue(self):
        cancelled = job(2)
        cancelled.update(status="completed", conclusion="cancelled", steps=[])
        result = M.analyse(snapshot(job(), job(), cancelled), [])
        self.assertEqual(result["jobs"], 2)
        self.assertEqual(result["runner_queue_timings"]["E2E smoke"]["n"], 1)

    def test_only_successful_compilation_is_counted(self):
        failed = job(2)
        failed.update(conclusion="failure")
        failed["steps"][-1]["conclusion"] = "failure"
        result = M.analyse(snapshot(job(), failed), [])
        self.assertEqual(result["successful_step_timings"]["Compile E2E module"]["n"], 1)

    def test_cache_signals_retain_no_raw_environment_and_do_not_confuse_restore_step_with_hit(self):
        signals = M.log_signals("""timestamp SECRET_TOKEN: do-not-retain
timestamp Cache not found for input keys: e2e-wasm-v1-Linux-abc
timestamp Cache saved with key: e2e-wasm-v1-Linux-abc
timestamp Cache restored from key: unknown-secret-key
timestamp Cache restored from key: e2e-api-unsafe$value
timestamp #31 1.0 Compiling serde v1.0.0
timestamp #36 sending cache export 12.5s done
""")
        self.assertNotIn("do-not-retain", str(signals))
        self.assertNotIn("unsafe", str(signals))
        self.assertEqual(signals["compiled_crates"], 1)
        self.assertEqual(signals["cache_export_seconds"], [12.5])
        result = M.analyse(snapshot(job(), job(2)), [
            dict(job=id, run=10, **signals) for id in (1, 2)])
        self.assertEqual(result["cache_lookups"]["e2e-wasm-"]["restores"], 0)
        self.assertEqual(len(result["repeated_exact_input_compilations"]["e2e-wasm-v1-Linux-abc"]), 2)

    def test_collector_paginates_jobs_and_caches_without_writes(self):
        calls = []

        def api(repository, endpoint):
            calls.append(endpoint)
            if endpoint.startswith("actions/runs?"):
                return {"workflow_runs": [dict(id=10, name="E2E smoke")]}
            if endpoint.startswith("actions/runs/10/jobs?"):
                return {"jobs": [job(1 if "page=1" in endpoint else 2)], "total_count": 2}
            if endpoint == "actions/cache/usage":
                return {"active_caches_count": 101}
            return {"actions_caches": [{"id": 1}], "total_count": 1}

        with patch.object(M, "api", side_effect=api):
            saved, logs, inventory = M.collect("owner/repo", 100, 0)
        self.assertEqual(len(saved["samples"][0]["jobs"]), 2)
        self.assertEqual(logs, [])
        self.assertFalse(inventory["truncated"])
        self.assertTrue(any("jobs?per_page=100&page=2" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
