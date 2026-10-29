import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SHA = "1" * 40
DIGEST = "sha256:" + "a" * 64


class ReleaseImagesTests(unittest.TestCase):
    def run_resolver(self, **overrides):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            docker = path / "docker"
            docker.write_text("""#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['TEST_DOCKER_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[:3] == ['buildx', 'imagetools', 'inspect']:
    print(json.dumps({'digest': 'sha256:' + 'a' * 64}))
elif args[:2] == ['pull', '--quiet']:
    assert os.environ.get('DOCKER_CONFIG')
    if os.environ.get('TEST_PRIVATE') and '-web@' in args[-1]:
        sys.exit(1)
elif args[:2] == ['image', 'inspect']:
    revision = os.environ['RELEASE_SHA']
    if os.environ.get('TEST_WRONG_REVISION') and '-api-gateway@' in args[-1]:
        revision = '2' * 40
    print(revision)
else:
    sys.exit(90)
""")
            docker.chmod(0o755)
            env_file = path / "github-env"
            env_file.touch()
            log_file = path / "docker-log"
            env = dict(os.environ, PATH=f"{path}:{os.environ['PATH']}",
                       RELEASE_SHA=SHA, GITHUB_REPOSITORY="KevTiv/lumiere-v-1",
                       GITHUB_ENV=str(env_file), TEST_DOCKER_LOG=str(log_file))
            for name in ("RUST_RUNTIME_IMAGE", "STDB_PUBLISHER_IMAGE", "CHROMIUM_IMAGE", "WEB_IMAGE", "API_GATEWAY_IMAGE"):
                env.pop(name, None)
            env.update(overrides)
            result = subprocess.run(["bash", str(ROOT / "scripts/railway-release-images.sh")],
                                    env=env, capture_output=True, text=True)
            calls = [json.loads(line) for line in log_file.read_text().splitlines()] if log_file.exists() else []
            return result, env_file.read_text(), calls

    def test_resolves_all_images_at_the_same_revision(self):
        result, exported, calls = self.run_resolver()
        self.assertEqual(result.returncode, 0, result.stderr)
        coordinates = dict(line.split("=", 1) for line in exported.splitlines())
        self.assertEqual(set(coordinates), {"RUST_RUNTIME_IMAGE", "STDB_PUBLISHER_IMAGE", "CHROMIUM_IMAGE", "WEB_IMAGE", "API_GATEWAY_IMAGE"})
        self.assertTrue(all(image.endswith("@" + DIGEST) for image in coordinates.values()))
        lookups = [args[3] for args in calls if args[:3] == ["buildx", "imagetools", "inspect"]]
        self.assertEqual(len(lookups), 5)
        self.assertTrue(all(tag.endswith(":" + SHA) for tag in lookups))

    def test_rejects_mismatched_revision_without_exporting_partial_release(self):
        result, exported, _ = self.run_resolver(TEST_WRONG_REVISION="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(exported, "")
        self.assertIn("does not match release", result.stderr)

    def test_rejects_images_railway_cannot_pull_anonymously(self):
        result, exported, _ = self.run_resolver(TEST_PRIVATE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(exported, "")

    def test_accepts_pinned_runtime_but_still_verifies_revision(self):
        image = "ghcr.io/kevtiv/lumiere-v-1-rust-runtime@" + DIGEST
        result, exported, calls = self.run_resolver(RUST_RUNTIME_IMAGE=image)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RUST_RUNTIME_IMAGE=" + image, exported)
        self.assertEqual(sum(args[:3] == ["buildx", "imagetools", "inspect"] for args in calls), 4)
        self.assertEqual(sum(args[:2] == ["image", "inspect"] for args in calls), 5)

    def test_rejects_mutable_override_and_invalid_release_sha(self):
        for override in ({"RUST_RUNTIME_IMAGE": "ghcr.io/kevtiv/lumiere-v-1-rust-runtime:latest"}, {"RELEASE_SHA": "main"}):
            with self.subTest(override=override):
                result, exported, calls = self.run_resolver(**override)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(exported, "")
                self.assertEqual(calls, [])


class MainReleaseWorkflowTests(unittest.TestCase):
    def test_ci_and_all_builds_gate_the_release(self):
        workflow = (ROOT / ".github/workflows/release-main.yml").read_text()
        for guard in ("workflows: [CI]", "branches: [main]",
                      "github.event.workflow_run.conclusion == 'success'",
                      "github.event.workflow_run.event == 'push'",
                      "github.event.workflow_run.head_repository.full_name == github.repository",
                      "needs: [revision, runtime, publisher, edge]",
                      "require_current_main: true", "enable_ai: true"):
            self.assertIn(guard, workflow)
        for builder in ("build-rust-runtime-image.yml", "build-production-stdb-image.yml", "build-production-edge-images.yml"):
            source = (ROOT / ".github/workflows" / builder).read_text()
            self.assertIn("workflow_call:", source)
            self.assertIn("inputs.release_sha || github.event.pull_request.head.sha || github.sha", source)
            push = source.split("  push:", 1)[1].split("  pull_request:", 1)[0]
            self.assertNotIn("main", push)

    def test_release_paths_share_production_lock_and_optional_worker_gates(self):
        web = (ROOT / ".github/workflows/release-railway-web.yml").read_text()
        stack = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        self.assertIn("group: railway-stack-production", web)
        self.assertIn("group: railway-stack-${{ inputs.environment }}", stack)
        self.assertIn("cancel-in-progress: false", stack)
        self.assertIn("if: inputs.enable_owner_reports", stack)
        manifest = json.loads((ROOT / "infra/railway/production-eu-services.json").read_text())
        owner = next(s for s in manifest["services"] if s["name"] == "owner-report-worker")
        self.assertFalse(owner["required"])
        self.assertEqual(owner["featureGate"], "RAILWAY_ENABLE_OWNER_REPORTS")


if __name__ == "__main__":
    unittest.main()
