import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REDUCERS = ("run_all_inventory_tests", "run_all_analytics_tests")
SUCCESS = "[e2e] Inventory and Analytics aggregate tests passed."


def aggregate_blocks():
    """Test the actual recipe text through Make, not a copied shell equivalent."""
    lines = (ROOT / "Makefile").read_text().splitlines(keepends=True)
    blocks = []
    for start, line in enumerate(lines):
        if 'E2E_RUN_DOMAIN_AGGREGATES:-0}" = "1"' not in line:
            continue
        indent = line[:len(line) - len(line.lstrip())]
        for end in range(start + 1, len(lines)):
            if lines[end] == indent + "fi; \\\n":
                blocks.append("".join(lines[start:end + 1]))
                break
    return blocks


class DomainAggregateTests(unittest.TestCase):
    def setUp(self):
        self.blocks = aggregate_blocks()
        self.assertEqual(len(self.blocks), 2, "Both E2E recipes must be covered")

    def run_recipe(self, recipe, enabled, failure=""):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            trace = directory / "calls"
            spacetime = directory / "spacetime"
            spacetime.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$*" >> "$CALL_TRACE"\n'
                'if [ "$1" = call ] && [ "$3" = "$FAIL_REDUCER" ]; then exit 1; fi\n'
            )
            spacetime.chmod(0o755)
            env = os.environ.copy()
            env.pop("E2E_RUN_DOMAIN_AGGREGATES", None)
            env.pop("MAKEFLAGS", None)
            env.pop("MFLAGS", None)
            env.update(
                PATH=f"{directory}{os.pathsep}{env['PATH']}",
                CALL_TRACE=str(trace),
                FAIL_REDUCER=failure,
                E2E_CLEAR_DB="0",
                E2E_FORCE_REBUILD="0",
            )
            if enabled is not None:
                env["E2E_RUN_DOMAIN_AGGREGATES"] = enabled
            result = subprocess.run(
                ["make", "--silent", "--no-print-directory", "-f", "-", "witness"],
                input="E2E_DB := certification-test\nwitness:\n" + recipe,
                text=True,
                capture_output=True,
                env=env,
                cwd=ROOT,
                timeout=10,
            )
            calls = trace.read_text().splitlines() if trace.exists() else []
            return result, calls

    def test_enabled_runs_both_aggregates(self):
        for index, block in enumerate(self.blocks):
            with self.subTest(recipe=index):
                result, calls = self.run_recipe(block, "1")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls, [
                    f"call certification-test {reducer} --server local --no-config"
                    for reducer in REDUCERS
                ])
                for reducer in REDUCERS:
                    self.assertIn(f"[e2e] Calling {reducer} aggregate...", result.stdout)
                self.assertIn(SUCCESS, result.stdout)

    def test_unset_or_disabled_skips_aggregates(self):
        for index, block in enumerate(self.blocks):
            for enabled in (None, "0"):
                with self.subTest(recipe=index, enabled=enabled):
                    result, calls = self.run_recipe(block, enabled)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(calls, [])
                    self.assertNotIn(SUCCESS, result.stdout)

    def test_either_failure_stops_certification(self):
        for index, block in enumerate(self.blocks):
            for failed_index, reducer in enumerate(REDUCERS):
                with self.subTest(recipe=index, failed=reducer):
                    result, calls = self.run_recipe(block, "1", failure=reducer)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(calls, [
                        f"call certification-test {name} --server local --no-config"
                        for name in REDUCERS[:failed_index + 1]
                    ] + ["logs certification-test --server local --no-config"])
                    self.assertNotIn(SUCCESS, result.stdout)

    def test_requested_certification_bypasses_setup_cache(self):
        lines = (ROOT / "Makefile").read_text().splitlines(keepends=True)
        start = next(
            index for index, line in enumerate(lines)
            if 'if [' in line and 'STDB_HASH_FILE' in line
        )
        recipe = (
            '\tSTDB_HASH_FILE="$$CALL_TRACE"; CUR_STDB_HASH=fixture; STDB_FAST_PATH=0; \\\n'
            '\tprintf "%s" "$$CUR_STDB_HASH" > "$$STDB_HASH_FILE"; \\\n'
            + "".join(lines[start:start + 3])
            + '\tprintf "FAST_PATH=%s\\n" "$$STDB_FAST_PATH"\n'
        )
        for enabled, expected in ((None, 1), ("0", 1), ("1", 0)):
            with self.subTest(enabled=enabled):
                result, _ = self.run_recipe(recipe, enabled)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), f"FAST_PATH={expected}")

    def test_ci_rejects_missing_execution_evidence(self):
        workflow = (ROOT / ".github/workflows/e2e-smoke.yml").read_text()
        start = workflow.index('          if [ "${E2E_RUN_DOMAIN_AGGREGATES:-0}" = "1" ]; then')
        end = workflow.index("\n          fi\n", start) + len("\n          fi\n")
        verification = textwrap.dedent(workflow[start:end])
        markers = [f"[e2e] Calling {reducer} aggregate..." for reducer in REDUCERS] + [SUCCESS]
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "e2e-smoke.log"
            env = {**os.environ, "RUNNER_TEMP": directory, "E2E_RUN_DOMAIN_AGGREGATES": "1"}
            # A success-only log must not substitute for proof of both invocations.
            for omitted in (None, *markers, "all"):
                with self.subTest(omitted=omitted):
                    log.write_text("".join(
                        marker + "\n" for marker in markers
                        if marker != omitted and omitted != "all"
                    ))
                    result = subprocess.run(
                        ["bash", "-euo", "pipefail", "-c", verification],
                        env=env, text=True, capture_output=True, timeout=10,
                    )
                    self.assertEqual(result.returncode == 0, omitted is None, result.stdout)

    def test_ci_pipeline_preserves_make_failure(self):
        workflow = (ROOT / ".github/workflows/e2e-smoke.yml").read_text()
        step = workflow.index("      - name: Run make e2e-smoke\n")
        start = workflow.index("        run: |\n", step) + len("        run: |\n")
        end = workflow.index("\n      - name: Upload Playwright report", start)
        script = textwrap.dedent(workflow[start:end])
        with tempfile.TemporaryDirectory() as directory:
            make = Path(directory) / "make"
            # Even convincing markers cannot hide a failed make behind tee.
            make.write_text(
                "#!/bin/sh\n"
                + "".join(f"echo '[e2e] Calling {reducer} aggregate...'\n" for reducer in REDUCERS)
                + f"echo '{SUCCESS}'\n"
                + 'exit "$MOCK_EXIT_CODE"\n'
            )
            make.chmod(0o755)
            env = {
                **os.environ, "PATH": f"{directory}{os.pathsep}{os.environ['PATH']}",
                "RUNNER_TEMP": directory, "PNPM_HOME": directory,
                "E2E_RUN_DOMAIN_AGGREGATES": "1", "E2E_SUITE": "targeted",
                "E2E_CLEAR_DB": "0", "E2E_SHARD": "", "E2E_SPEC_FILES": "",
            }
            for exit_code in (0, 9):
                with self.subTest(make_exit=exit_code):
                    result = subprocess.run(
                        ["bash", "-c", script], env={**env, "MOCK_EXIT_CODE": str(exit_code)},
                        text=True, capture_output=True, timeout=10,
                    )
                    self.assertEqual(result.returncode, exit_code, result.stderr)


if __name__ == "__main__":
    unittest.main()
