import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


planner = load("ci-playwright-shards")
updater = load("update-playwright-durations")
verifier = load("verify-playwright-shards")


class PlaywrightShardTests(unittest.TestCase):
    def matrix(self, count=3):
        return [{"suite": "full", "clear_db": "1", "shard": f"{i}/{count}", "slot": str(i)}
                for i in range(1, count + 1)]

    def test_balances_expensive_files_and_retains_exact_coverage(self):
        files = [f"tests/e2e/spec-{i}.spec.ts" for i in range(9)]
        times = {file: {"full_ms": 100_000 if i < 3 else 1_000}
                 for i, file in enumerate(files)}
        result = planner.balance(self.matrix(), files, times)
        self.assertEqual([r["estimated_ms"] for r in result], [102_000] * 3)
        assigned = [p for lane in result for p in lane["specs"].split()]
        self.assertEqual(len(assigned), len(set(assigned)))
        self.assertEqual(len(assigned), len(files))
        self.assertTrue(all(p.endswith(r"\.spec\.ts$") for p in assigned))
        self.assertEqual(result, planner.balance(self.matrix(), list(reversed(files)), times))

    def test_new_files_remain_included_and_serial_files_never_split(self):
        files = ["tests/e2e/new.spec.ts", "tests/e2e/serial.spec.ts", "tests/e2e/last.spec.ts"]
        result = planner.balance(self.matrix(), files, {})
        self.assertEqual([r["file_count"] for r in result], [1, 1, 1])

    def test_targeted_and_pretenant_selection_is_unchanged(self):
        matrix = [{"suite": "targeted", "specs": "one.spec.ts", "clear_db": "0"},
                  {"suite": "pretenant", "clear_db": "1"}]
        self.assertEqual(planner.balance(matrix, ["tests/e2e/a.spec.ts"], {}), matrix[::-1])

    def test_rejects_duplicate_or_incomplete_shards(self):
        matrix = self.matrix()
        matrix[1]["shard"] = "1/3"
        with self.assertRaises(ValueError):
            planner.balance(matrix, ["a", "b", "c"], {})

    def test_rejects_missing_or_invalid_inventory_and_weights(self):
        for files, weights in [([], {}), (["a", "a"], {}),
                               (["a", "b", "c"], {"a": {"full_ms": float("nan")}})]:
            with self.subTest(files=files), self.assertRaises(ValueError):
                planner.balance(self.matrix(), files, weights)

    def test_duration_import_rejects_partial_failed_or_duplicate_reports(self):
        report = {"version": 1, "status": "passed", "suite": "full", "source_commit": "abc", "partition": "1/1",
                  "tests": [{"id": "a", "project": "authenticated", "file": "tests/e2e/a.spec.ts",
                             "duration_ms": 1234, "tags": ["@p0"]}]}
        self.assertEqual(updater.combine([report])["files"]["tests/e2e/a.spec.ts"]["p0_ms"], 1234)
        for reports in [[report, report], [{**report, "partition": "1/2"}], [{**report, "status": "failed"}],
                        [report, {**report, "source_commit": "other"}]]:
            with self.subTest(reports=reports), self.assertRaises(ValueError):
                updater.combine(reports)

    def test_real_discovery_coverage_rejects_missing_and_duplicate_owners(self):
        web = Path("/checkout/frontend/web")
        report = {"config": {"rootDir": str(web / "tests/e2e")}, "suites": [
            {"specs": [{"id": "a", "file": "a.spec.ts", "tests": [{"projectName": "authenticated"}]}]},
            {"specs": [{"id": "b", "file": "b.spec.ts", "tests": [{"projectName": "unauthenticated"}]}]},
        ]}
        lanes = [{"specs": r"tests/e2e/a\.spec\.ts$"}, {"specs": r"tests/e2e/b\.spec\.ts$"}]
        self.assertEqual(verifier.verify(report, lanes, web), 2)
        for broken in [lanes[:1], [lanes[0], lanes[0], lanes[1]]]:
            with self.subTest(lanes=broken), self.assertRaises(ValueError):
                verifier.verify(report, broken, web)

    def test_ci_installs_browser_once_and_local_invocation_keeps_install(self):
        recipe = (ROOT / "Makefile").read_text().split("\ne2e-smoke:\n", 1)[1]
        guard = next(line for line in recipe.splitlines()
                     if "E2E_BROWSER_READY:-0" in line).rstrip(" \\")
        with tempfile.TemporaryDirectory() as directory:
            command = Path(directory) / "pnpm"
            command.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE"\n')
            command.chmod(0o755)
            for ready in ("", "0", "1"):
                trace = Path(directory) / "calls"
                trace.unlink(missing_ok=True)
                env = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"],
                       "TRACE": str(trace), "E2E_BROWSER_READY": ready}
                result = subprocess.run(["make", "--silent", "-f", "-", "witness"],
                                        input="SHELL := /bin/bash\nwitness:\n" + guard + "\n",
                                        env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(trace.read_text() if trace.exists() else "",
                                 "" if ready == "1" else "exec playwright install chromium\n")


if __name__ == "__main__":
    unittest.main()
