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
NATIVE_KEY = "v0-rust-workspace-native-dev-deps-v2-Linux-compiler-lock"
WASM_KEY = "v0-rust-workspace-wasm-deps-v2-Linux-compiler-lock"
LEGACY_KEY = "v0-rust-workspace-dev-deps-v1-Linux-compiler-lock"


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


def dependency_log(key=NATIVE_KEY, result="exact", restored_key=None):
    lines = [f"{START} Cache Key:", f"{START}     {key}"]
    if result == "miss":
        lines.append(f"{START} No cache found.")
    elif result != "unknown":
        full_match = "true" if result == "exact" else "false"
        lines.append(f'{START} Restored from cache key "{restored_key or key}" full match: {full_match}.')
    return "\n".join(lines) + "\n"


def native_job(status="completed", conclusion="success"):
    value = job()
    value["steps"].append(step(M.NATIVE_API_STEP, status, conclusion))
    return value


class MeasurementTests(unittest.TestCase):
    def test_exact_native_hit_reports_compiler_work_in_the_api_step_only(self):
        value = native_job()
        log = dependency_log() + """2026-10-21T09:59:59Z    Compiling wasm_dep v1.0.0
2026-10-21T10:00:01Z SECRET_TOKEN: do-not-retain
2026-10-21T10:00:10Z    \x1b[32mCompiling\x1b[0m serde v1.0.228
2026-10-21T10:00:20Z    Compiling api-server v0.1.0 (/private/do-not-retain)
2026-10-21T10:01:00Z    Compiling later_dep v1.0.0
2026-10-21T10:01:01Z    Compiling test_dep v1.0.0
"""
        signals = M.log_signals(log, value)
        self.assertEqual(signals["rust_dependency_caches"], [{
            "key": NATIVE_KEY, "result": "exact", "restored_key": NATIVE_KEY}])
        self.assertEqual(signals["native_api_compilation"]["third_party_compilations"], 1)
        self.assertEqual(signals["native_api_compilation"]["local_compilations"], 1)
        self.assertNotIn("do-not-retain", str(signals))
        self.assertNotIn("/private", str(signals))
        result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
        self.assertEqual(result["rust_dependency_cache_lookups"][M.DEPENDENCY_CACHE_PREFIXES[0]]["exact"], 1)
        self.assertEqual(len(result["exact_dependency_hits_with_native_recompilation"]), 1)
        report = M.markdown(result)
        self.assertIn("recompiled third-party crates after an exact", report)
        self.assertIn("| success | exact | 1 | 1 |", report)

    def test_cold_fallback_and_warm_native_compilation_are_distinguished(self):
        for state, compiler_output, third_party in [
            ("miss", "    Compiling serde v1.0.228", 1),
            ("fallback", "    Compiling serde v1.0.228", 1),
            ("exact", "    Compiling api-server v0.1.0 (/local/api-server)", 0),
        ]:
            with self.subTest(state=state):
                value = native_job()
                fallback = NATIVE_KEY + "-older" if state == "fallback" else None
                signals = M.log_signals(dependency_log(result=state, restored_key=fallback)
                                        + f"2026-10-21T10:00:10Z {compiler_output}\n", value)
                result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
                self.assertEqual(signals["rust_dependency_caches"][0]["result"], state)
                self.assertEqual(signals["native_api_compilation"]["third_party_compilations"], third_party)
                self.assertEqual(result["exact_dependency_hits_with_native_recompilation"], [])

    def test_absent_or_unattributable_cargo_output_is_not_a_zero_compile_observation(self):
        samples = [
            "",
            "2026-10-21T09:59:59Z    Compiling serde v1.0.228\n"
            "2026-10-21T10:01:00Z    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s\n",
            "    Compiling serde v1.0.228\n"
            "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s\n",
            "2026-10-21T10:00:10Z CARGO_EXPECTED_OUTPUT: Compiling serde v1.0.228\n"
            "2026-10-21T10:00:20Z unrelated command output\n",
        ]
        for output in samples:
            with self.subTest(output=output):
                value = native_job()
                signals = M.log_signals(dependency_log() + output, value)
                self.assertFalse(signals["native_api_compilation"]["observed"])
                result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
                self.assertEqual(result["exact_dependency_hits_with_native_recompilation"], [])
                self.assertIn("| success | exact | unobserved | unobserved |", M.markdown(result))

    def test_fresh_or_finished_only_output_proves_a_zero_compile_warm_build(self):
        for output in [
            "    Fresh serde v1.0.228",
            "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s",
            "    Finished dev [unoptimized + debuginfo] target(s) in 1m 3s",
        ]:
            with self.subTest(output=output):
                value = native_job()
                signals = M.log_signals(dependency_log() + f"2026-10-21T10:00:10Z {output}\n", value)
                self.assertTrue(signals["native_api_compilation"]["observed"])
                self.assertEqual(signals["native_api_compilation"]["third_party_compilations"], 0)
                self.assertEqual(signals["native_api_compilation"]["local_compilations"], 0)
                result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
                self.assertIn("| success | exact | 0 | 0 |", M.markdown(result))

    def test_git_source_urls_are_third_party_and_only_filesystem_sources_are_local(self):
        value = native_job()
        sources = [
            " (/private/do-not-retain)",
            r" (C:\private\do-not-retain)",
            r" (\\server\private\do-not-retain)",
            " (file:///private/do-not-retain)",
            " (https://example.test/private/do-not-retain#abc123)",
            " (git+https://example.test/private/do-not-retain#abc123)",
            " (ssh://git@example.test/private/do-not-retain#abc123)",
            "",
        ]
        log = dependency_log() + "".join(
            f"2026-10-21T10:00:10Z    Compiling crate_{index} v1.0.0{source}\n"
            for index, source in enumerate(sources)
        )
        signals = M.log_signals(log, value)
        self.assertEqual(signals["native_api_compilation"]["local_compilations"], 4)
        self.assertEqual(signals["native_api_compilation"]["third_party_compilations"], 4)
        self.assertNotIn("do-not-retain", str(signals))
        self.assertNotIn("example.test", str(signals))
        self.assertNotIn("abc123", str(signals))

    def test_wasm_and_unconfirmed_cache_retrieval_are_not_native_exact_hits(self):
        for state in ["unknown", "miss"]:
            with self.subTest(native_restore=state):
                value = native_job()
                log = dependency_log(WASM_KEY) + dependency_log(result=state)
                log += "2026-10-21T10:00:10Z    Compiling serde v1.0.228\n"
                signals = M.log_signals(log, value)
                result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
                self.assertEqual(result["exact_dependency_hits_with_native_recompilation"], [])
                self.assertEqual(result["native_api_dependency_reuse"][0]["dependency_caches"], [
                    {"key": NATIVE_KEY, "result": state}])
                self.assertEqual(result["rust_dependency_cache_lookups"][M.DEPENDENCY_CACHE_PREFIXES[1]]["exact"], 1)

    def test_cancelled_running_and_missing_time_windows_are_incomplete_evidence(self):
        for status, conclusion in [("completed", "cancelled"), ("in_progress", None), ("completed", "skipped")]:
            with self.subTest(status=status, conclusion=conclusion):
                value = native_job(status, conclusion)
                if status == "in_progress":
                    value["steps"][-1]["completed_at"] = None
                signals = M.log_signals(dependency_log()
                    + "2026-10-21T10:00:10Z    Compiling serde v1.0.228\n", value)
                self.assertFalse(signals["native_api_compilation"]["complete"])
                result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
                self.assertEqual(result["exact_dependency_hits_with_native_recompilation"], [])
                self.assertIn("(incomplete)", M.markdown(result))
        value = native_job()
        value["steps"][-1]["started_at"] = None
        signals = M.log_signals(dependency_log(), value)
        self.assertFalse(signals["native_api_compilation"]["observed"])
        result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
        self.assertIn("| success | exact | unobserved | unobserved |", M.markdown(result))

    def test_completed_native_step_remains_evidence_when_later_job_work_fails(self):
        value = native_job()
        value["conclusion"] = "failure"
        signals = M.log_signals(dependency_log(LEGACY_KEY)
            + "2026-10-21T10:00:10Z    Compiling serde v1.0.228\n", value)
        result = M.analyse(snapshot(value), [dict(job=1, run=10, **signals)])
        self.assertEqual(len(result["exact_dependency_hits_with_native_recompilation"]), 1)
        self.assertEqual(result["rust_dependency_cache_lookups"][M.DEPENDENCY_CACHE_PREFIXES[2]]["exact"], 1)

    def test_dependency_signals_reject_unsafe_keys_and_preserve_legacy_observations(self):
        for invalid in [NATIVE_KEY + "$SECRET", "unknown-prefix-secret", NATIVE_KEY + "x" * 512]:
            with self.subTest(invalid=invalid):
                signals = M.log_signals(dependency_log(invalid))
                self.assertEqual(signals["rust_dependency_caches"], [])
                self.assertEqual(signals["observations"], [])
                self.assertNotIn(invalid, str(signals))
        old = {"job": 1, "run": 10, "observations": [], "compiled_crates": 1, "cache_export_seconds": []}
        result = M.analyse(snapshot(job()), [old])
        self.assertEqual(result["native_api_dependency_reuse"], [])
        self.assertEqual(result["rust_dependency_cache_lookups"], {})
        self.assertIn("Rust dependency cache reuse", M.markdown(result))

    def test_collector_includes_cancelled_and_ci_rust_logs_without_writes(self):
        value = native_job("completed", "cancelled")
        value.update(name="Rust", conclusion="cancelled")

        def api(repository, endpoint):
            if endpoint.startswith("actions/runs?"):
                return {"workflow_runs": [dict(id=10, name="CI")]}
            return {"jobs": [value], "total_count": 1}

        with patch.object(M, "api", side_effect=api), \
                patch.object(M, "collect_inventory", return_value={"errors": []}), \
                patch.object(M.subprocess, "check_output", return_value=dependency_log(result="miss")) as fetch:
            _, logs, _ = M.collect("owner/repo", 100, 30)
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["rust_dependency_caches"][0]["result"], "miss")
        self.assertFalse(logs[0]["native_api_compilation"]["complete"])
        self.assertEqual(fetch.call_args.args[0], ["gh", "api", "repos/owner/repo/actions/jobs/1/logs"])

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
