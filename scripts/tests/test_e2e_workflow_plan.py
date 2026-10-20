"""Execute the workflow's real Bash planner to verify release coverage."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/e2e-smoke.yml"


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
                       DISPATCH_SUITE="p0", DISPATCH_CLEAR_DB="false",
                       GITHUB_OUTPUT=str(output))
            env.update(overrides)
            result = subprocess.run(["bash", "-euo", "pipefail", "-c", planner_script()],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(output.read_text().removeprefix("configs="))

    def assert_shards(self, matrix, suite, clear_db):
        self.assertEqual(len(matrix), 3)
        self.assertEqual([entry["shard"] for entry in matrix], ["1/3", "2/3", "3/3"])
        self.assertEqual([entry["slot"] for entry in matrix], ["1", "2", "3"])
        self.assertTrue(all(entry["suite"] == suite and entry["clear_db"] == clear_db
                            for entry in matrix))

    def test_release_candidate_runs_complete_fresh_suite(self):
        self.assert_shards(self.plan(RELEASE_CANDIDATE="true"), "full", "1")

    def test_release_candidate_cannot_be_narrowed_to_changed_specs(self):
        self.assert_shards(self.plan(RELEASE_CANDIDATE="true", TARGET_SPECS="one.spec.ts"),
                           "full", "1")

    def test_release_candidate_takes_precedence_over_special_pretenant_branch(self):
        self.assert_shards(self.plan(RELEASE_CANDIDATE="true",
                                    HEAD_REF="codex/base05-pretenant-integrated-certification"),
                           "full", "1")

    def test_ordinary_unselected_pr_retains_p0(self):
        self.assert_shards(self.plan(), "p0", "0")

    def test_changed_spec_pr_retains_targeted_matrix(self):
        specs = "one.spec.ts two.spec.ts"
        self.assertEqual(self.plan(TARGET_SPECS=specs),
                         [{"suite": "targeted", "clear_db": "0", "specs": specs}])

    def test_special_pretenant_branch_retains_additional_lane(self):
        matrix = self.plan(HEAD_REF="codex/base05-pretenant-integrated-certification")
        self.assert_shards(matrix[:3], "p0", "0")
        self.assertEqual(matrix[3:], [{"suite": "pretenant", "clear_db": "1"}])

    def test_main_and_scheduled_runs_retain_complete_suite(self):
        for event in ("push", "schedule"):
            with self.subTest(event=event):
                self.assert_shards(self.plan(EVENT_NAME=event), "full", "1")

    def test_explicit_dispatch_retains_selected_suite(self):
        self.assert_shards(self.plan(EVENT_NAME="workflow_dispatch", DISPATCH_SUITE="full",
                                    DISPATCH_CLEAR_DB="true"), "full", "1")


if __name__ == "__main__":
    unittest.main()
