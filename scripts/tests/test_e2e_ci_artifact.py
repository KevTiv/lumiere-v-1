import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "e2e-ci-artifact.sh"
SHA = "0123456789abcdef0123456789abcdef01234567"


class E2eCiArtifactTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.write("spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm", "wasm")
        self.write("target/debug/api-server", "api", executable=True)
        self.write("target/debug/storage-migrate", "migrate", executable=True)
        self.write("frontend/web/.next/BUILD_ID", "build-id")
        self.write("frontend/web/.next/server/chunk.js", "chunk")
        self.write("frontend/web/.next/cache/compiler.bin", "do-not-package")
        self.staging = self.root / "staging"
        self.staging.mkdir()
        self.env = {
            **os.environ,
            "CI": "true",
            "E2E_CI_ARTIFACT_ROOT": str(self.root),
            "TMPDIR": str(self.staging),
        }

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, relative, content, executable=False):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        if executable:
            path.chmod(0o755)

    def run_script(self, command, sha=SHA, check=True):
        result = subprocess.run(
            [str(SCRIPT), command, sha],
            env=self.env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def snapshot_files(self):
        return {
            path.relative_to(self.root): (
                path.read_bytes(),
                path.stat().st_mode,
                path.stat().st_mtime_ns,
                path.stat().st_ino,
            )
            for path in self.root.rglob("*")
            if path.is_file()
        }

    def rewrite_archive_member(self, relative, *, content=None, mode=None, remove=False):
        archive = self.root / ".ci/e2e-build.tar.gz"
        with tarfile.open(archive, "r:gz") as source:
            members = [
                (member, source.extractfile(member).read() if member.isfile() else None)
                for member in source.getmembers()
            ]
        changed = False
        with tarfile.open(archive, "w:gz") as destination:
            for member, data in members:
                if member.name.removeprefix("./") == relative:
                    changed = True
                    if remove:
                        continue
                    if content is not None:
                        data = content.encode()
                        member.size = len(data)
                    if mode is not None:
                        member.mode = mode
                destination.addfile(member, io.BytesIO(data) if data is not None else None)
        self.assertTrue(changed, f"missing archive member {relative}")

    def test_pack_install_and_verify_exact_commit(self):
        self.run_script("pack")
        archive = self.root / ".ci/e2e-build.tar.gz"
        self.assertTrue(archive.is_file())

        for relative in (
            "spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm",
            "frontend/web/.next",
        ):
            path = self.root / relative
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()

        self.run_script("install")
        self.run_script("verify")
        self.assertTrue(os.access(self.root / ".ci/e2e-build/bin/api-server", os.X_OK))
        self.assertFalse((self.root / "frontend/web/.next/cache").exists())

    def test_verify_rejects_wrong_commit_and_changed_output(self):
        self.run_script("pack")
        self.run_script("install")
        wrong = self.run_script("verify", "f" * 40, check=False)
        self.assertNotEqual(wrong.returncode, 0)

        (self.root / ".ci/e2e-build/bin/api-server").write_text("changed")
        changed = self.run_script("verify", check=False)
        self.assertNotEqual(changed.returncode, 0)

    def test_verify_archive_preserves_build_outputs_and_compiler_cache(self):
        self.run_script("pack")
        # The verifier must check the archive independently of existing outputs.
        self.write("frontend/web/.next/server/chunk.js", "newer builder output")
        self.write("spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm", "newer wasm")
        self.write(".ci/e2e-build/local-marker", "keep existing artifacts")
        before = self.snapshot_files()

        self.run_script("verify-archive")

        self.assertEqual(self.snapshot_files(), before)
        self.assertEqual(list(self.staging.iterdir()), [])

    def test_verify_archive_rejects_wrong_commit_without_changing_workspace(self):
        self.run_script("pack")
        before = self.snapshot_files()

        result = self.run_script("verify-archive", "f" * 40, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshot_files(), before)
        self.assertEqual(list(self.staging.iterdir()), [])

    def test_verify_archive_rejects_invalid_outputs_without_changing_workspace(self):
        for name, mutation in (
            ("changed bytes", {"content": "tampered binary"}),
            ("not executable", {"mode": 0o644}),
            ("missing binary", {"remove": True}),
        ):
            with self.subTest(name=name):
                self.run_script("pack")
                self.rewrite_archive_member(".ci/e2e-build/bin/api-server", **mutation)
                before = self.snapshot_files()

                result = self.run_script("verify-archive", check=False)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot_files(), before)
                self.assertEqual(list(self.staging.iterdir()), [])

    def test_verify_archive_rejects_missing_or_invalid_archive(self):
        missing = self.run_script("verify-archive", check=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("missing archive", missing.stderr)

        self.write(".ci/e2e-build.tar.gz", "not a gzip archive")
        before = self.snapshot_files()
        invalid = self.run_script("verify-archive", check=False)

        self.assertNotEqual(invalid.returncode, 0)
        self.assertEqual(self.snapshot_files(), before)
        self.assertEqual(list(self.staging.iterdir()), [])

    def test_install_requires_ci_workspace(self):
        self.run_script("pack")
        env = {**self.env, "CI": "false"}
        result = subprocess.run(
            [str(SCRIPT), "install", SHA],
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("restricted to CI workspaces", result.stderr)

    def test_workflow_builds_once_and_fans_out_verified_artifact(self):
        workflow = (ROOT / ".github/workflows/e2e-smoke.yml").read_text()
        self.assertIn("  build-e2e:\n", workflow)
        self.assertIn("key: e2e-build-v1-${{ runner.os }}-${{ github.sha }}", workflow)
        self.assertIn("needs: [scope, plan, build-e2e]", workflow)
        self.assertIn("name: e2e-build-${{ github.sha }}", workflow)
        self.assertIn('run: scripts/e2e-ci-artifact.sh install "$GITHUB_SHA"', workflow)
        build_job = workflow.split("  build-e2e:\n", 1)[1].split("\n  e2e-smoke:\n", 1)[0]
        self.assertIn('scripts/e2e-ci-artifact.sh verify-archive "$GITHUB_SHA"', build_job)
        self.assertNotIn('scripts/e2e-ci-artifact.sh install "$GITHUB_SHA"', build_job)
        self.assertIn("E2E_PREBUILT: '1'", workflow)
        self.assertEqual(
            workflow.count("LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime build --module-path ./spacetimedb"),
            1,
        )


if __name__ == "__main__":
    unittest.main()
