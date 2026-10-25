"""Execute the workflow's real Bash planner to verify suite and changed-spec coverage."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/e2e-smoke.yml"
SELECTOR_SPEC = importlib.util.spec_from_file_location(
    "ci_e2e_targets", Path(__file__).parents[1] / "ci-e2e-targets.py")
selector = importlib.util.module_from_spec(SELECTOR_SPEC)
SELECTOR_SPEC.loader.exec_module(selector)
E2E = "frontend/web/tests/e2e"


def planner_script():
    workflow = WORKFLOW.read_text()
    step = workflow.split("      - id: plan\n", 1)[1]
    body = step.split("        run: |\n", 1)[1]
    lines = []
    for line in body.splitlines():
        if line.strip() and not line.startswith("          "):
            break
        lines.append(line)
    return textwrap.dedent("\n".join(lines))


class E2eWorkflowPlanTests(unittest.TestCase):
    def plan(self, **overrides):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            env = dict(os.environ, EVENT_NAME="pull_request", HEAD_REF="feature",
                       RELEASE_CANDIDATE="false", TARGET_SPECS="", DISPATCH_SPECS="",
                       FALLBACK_CONFIGS="[]",
                       DISPATCH_SUITE="p0", DISPATCH_CLEAR_DB="false",
                       GITHUB_OUTPUT=str(output))
            env.update(overrides)
            result = subprocess.run(["bash", "-euo", "pipefail", "-c", planner_script()],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(output.read_text().removeprefix("configs="))

    def assert_shards(self, matrix, suite, clear_db, count=3):
        self.assertEqual(len(matrix), count)
        self.assertEqual([entry["shard"] for entry in matrix],
                         [f"{index}/{count}" for index in range(1, count + 1)])
        self.assertEqual([entry["slot"] for entry in matrix],
                         [str(index) for index in range(1, count + 1)])
        self.assertTrue(all(entry["suite"] == suite and entry["clear_db"] == clear_db
                            for entry in matrix))

    def plan_changed(self, changed, sources):
        selected = selector.plan_targets(changed, sources)
        return self.plan(TARGET_SPECS=selected["specs"],
                         FALLBACK_CONFIGS=json.dumps(selected["fallback_configs"]))

    def test_release_candidate_runs_complete_fresh_suite(self):
        self.assert_shards(self.plan(RELEASE_CANDIDATE="true"), "full", "1", count=6)

    def test_release_candidate_cannot_be_narrowed_to_changed_specs(self):
        self.assert_shards(self.plan(RELEASE_CANDIDATE="true", TARGET_SPECS="one.spec.ts"),
                           "full", "1", count=6)

    def test_release_candidate_takes_precedence_over_special_pretenant_branch(self):
        self.assert_shards(self.plan(RELEASE_CANDIDATE="true",
                                    HEAD_REF="codex/base05-pretenant-integrated-certification"),
                           "full", "1", count=6)

    def test_ordinary_unselected_pr_retains_p0(self):
        self.assert_shards(self.plan(), "p0", "0")

    def test_changed_spec_pr_retains_targeted_matrix(self):
        specs = "one.spec.ts two.spec.ts"
        self.assertEqual(self.plan(TARGET_SPECS=specs),
                         [{"suite": "targeted", "clear_db": "0", "specs": specs}])

    def test_broad_helper_plus_explicit_board_specs_keeps_p0_and_fixtures(self):
        helper = f"{E2E}/helpers-legacy.ts"
        fixtures = [f"{E2E}/work-board-{name}.spec.ts"
                    for name in ("concurrency", "delegation", "revocation", "rollback")]
        sources = {
            helper: "export const signIn = () => {}\n",
            f"{E2E}/helpers.ts": 'export * from "./helpers-legacy"\n',
            **{f"{E2E}/p0-{index:02}.spec.ts": 'import { signIn } from "./helpers"\n'
               for index in range(26)},
            **{path: '// @dev-fixture\n' for path in fixtures},
        }
        matrix = self.plan_changed([helper, *fixtures, f"{E2E}/removed.spec.ts"], sources)
        self.assert_shards(matrix[:3], "p0", "0")
        self.assertEqual(matrix[3:], [{
            "suite": "targeted", "clear_db": "0", "slot": "changed-1",
            "specs": " ".join(path.removeprefix("frontend/web/") for path in fixtures),
        }])
        for changed in ([helper], [helper, f"{E2E}/removed.spec.ts"]):
            with self.subTest(changed=changed):
                self.assert_shards(self.plan_changed(changed, sources), "p0", "0")

    def test_batched_explicit_specs_keep_complete_p0_and_unique_targeted_jobs(self):
        specs = [f"{E2E}/fixture-{index:02}.spec.ts" for index in range(52)]
        matrix = self.plan_changed([*specs, specs[0], f"{E2E}/deleted.spec.ts"],
                                   {path: "// @dev-fixture\n" for path in specs})
        self.assert_shards(matrix[:3], "p0", "0")
        batches = matrix[3:]
        self.assertEqual([batch["slot"] for batch in batches], ["changed-1", "changed-2", "changed-3"])
        self.assertEqual([len(batch["specs"].split()) for batch in batches], [25, 25, 2])
        self.assertEqual([path for batch in batches for path in batch["specs"].split()],
                         [path.removeprefix("frontend/web/") for path in specs])
        self.assertTrue(all(batch["suite"] == "targeted" and batch["clear_db"] == "0"
                            and "shard" not in batch for batch in batches))
        identities = [(entry["suite"], entry["slot"]) for entry in matrix]
        self.assertEqual(len(identities), len(set(identities)))

    def test_special_pretenant_branch_retains_additional_lane(self):
        matrix = self.plan(HEAD_REF="codex/base05-pretenant-integrated-certification")
        self.assert_shards(matrix[:3], "p0", "0")
        self.assertEqual(matrix[3:], [{"suite": "pretenant", "clear_db": "1"}])

    def test_main_and_scheduled_runs_retain_complete_suite(self):
        for event in ("push", "schedule"):
            with self.subTest(event=event):
                self.assert_shards(self.plan(EVENT_NAME=event), "full", "1", count=6)

    def test_explicit_dispatch_retains_selected_suite(self):
        self.assert_shards(self.plan(EVENT_NAME="workflow_dispatch", DISPATCH_SUITE="full",
                                    DISPATCH_CLEAR_DB="true"), "full", "1", count=6)

    def test_supplemental_configs_do_not_override_other_planning_paths(self):
        fallback = json.dumps([{"suite": "targeted", "clear_db": "0", "slot": "changed-1",
                                "specs": "tests/e2e/fixture.spec.ts"}])
        cases = [
            {"TARGET_SPECS": "tests/e2e/selected.spec.ts"},
            {"RELEASE_CANDIDATE": "true"},
            {"HEAD_REF": "codex/base05-pretenant-integrated-certification"},
            {"EVENT_NAME": "push"},
            {"EVENT_NAME": "schedule"},
            {"EVENT_NAME": "workflow_dispatch", "DISPATCH_SUITE": "p0"},
            {"EVENT_NAME": "workflow_dispatch", "DISPATCH_SUITE": "full", "DISPATCH_CLEAR_DB": "true"},
            {"EVENT_NAME": "workflow_dispatch", "DISPATCH_SUITE": "targeted",
             "DISPATCH_SPECS": "tests/e2e/dispatched.spec.ts"},
        ]
        for overrides in cases:
            with self.subTest(overrides=overrides):
                self.assertEqual(self.plan(**overrides, FALLBACK_CONFIGS=fallback), self.plan(**overrides))


if __name__ == "__main__":
    unittest.main()
