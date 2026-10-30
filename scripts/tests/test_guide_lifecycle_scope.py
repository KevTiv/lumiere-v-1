import importlib.util
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "guide_scope", Path(__file__).resolve().parents[1] / "guide-lifecycle-scope.py"
)
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class GuideScopeTests(unittest.TestCase):
    def test_real_guide_owners_select_gate(self):
        for path in (
            "api-server/src/routes/knowledge_guides.rs",
            "ai-gateway/src/routes/guide_retrieval.rs",
            "spacetimedb/src/documents/knowledge_guides.rs",
            "frontend/web/app/(modules)/documents/knowledge/[id]/guide-page-client.tsx",
            "frontend/web/components/assistant-guide-host.tsx",
            "frontend/packages/ui/src/ai-chat/assistant-guide-viewer.tsx",
            "scripts/run-guide-lifecycle.mjs",
            ".github/workflows/e2e-smoke.yml",
        ):
            with self.subTest(path=path):
                self.assertTrue(scope.guide_relevant([path]))

    def test_unrelated_changes_do_not_add_runtime_cost(self):
        self.assertFalse(scope.guide_relevant([
            "docs/PRODUCTION_DEPLOY.md", "scripts/railway-stack-release.sh",
            "frontend/web/app/(modules)/sales/sales-client.tsx",
        ]))
        self.assertFalse(scope.guide_relevant([]))

    def test_actual_git_diff_drives_hosted_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(
                    ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", *args],
                    cwd=root, text=True, stderr=subprocess.DEVNULL,
                ).strip()
            git("init")
            (root / "README.md").write_text("fixture")
            git("add", ".")
            git("commit", "-m", "base")
            base = git("rev-parse", "HEAD")
            for index, path in enumerate(("docs/unrelated.md", "api-server/src/routes/knowledge_guides.rs")):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("fixture")
                git("add", ".")
                git("commit", "-m", "change")
                head = git("rev-parse", "HEAD")
                output = root / "output"
                subprocess.run(
                    ["python3", str(Path(scope.__file__)), "--github-output", str(output)],
                    cwd=root, env={**os.environ, "EVENT_NAME": "pull_request", "BASE_SHA": base, "HEAD_SHA": head},
                    check=True, timeout=10,
                )
                self.assertEqual(output.read_text().splitlines()[-1], f"run_guides={'true' if index else 'false'}")

    def test_required_gate_rejects_missing_failed_or_cancelled_acceptance(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/e2e-smoke.yml").read_text()
        start = workflow.index('          case "${{ needs.scope.outputs.run_guides }}:')
        end = workflow.index("\n          esac", start) + len("\n          esac")
        template = textwrap.dedent(workflow[start:end])
        for selected, state, accepted in (
            ("true", "success", True), ("false", "skipped", True),
            ("true", "failure", False), ("true", "skipped", False),
            ("true", "cancelled", False), ("", "success", False),
        ):
            with self.subTest(selected=selected, state=state):
                script = template.replace("${{ needs.scope.outputs.run_guides }}", selected).replace(
                    "${{ needs.guide-lifecycle.result }}", state
                )
                result = subprocess.run(["bash", "-euo", "pipefail", "-c", script], timeout=10)
                self.assertEqual(result.returncode == 0, accepted)


if __name__ == "__main__":
    unittest.main()
