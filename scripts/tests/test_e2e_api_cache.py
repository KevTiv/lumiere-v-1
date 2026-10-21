import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "e2e-api-cache.py"
FINGERPRINT = "a" * 64
BINARIES = ("api-server", "storage-migrate")


class E2eApiCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target = self.root / "target" / "debug"
        self.target.mkdir(parents=True)
        self.cache = self.root / ".ci" / "e2e-api"
        self.env = {**os.environ, "CI": "true"}
        # Use real ELF executables, but never invoke them: validation must not
        # start a server or apply migrations, even when a bundle is valid.
        for name in BINARIES:
            path = self.target / name
            shutil.copyfile(Path(sys.executable).resolve(), path)
            with path.open("ab") as output:
                output.write(name.encode())
            path.chmod(0o755)

    def run_script(self, command, fingerprint=FINGERPRINT, *, check=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), command, fingerprint, "--root", str(self.root)],
            env=self.env,
            cwd=self.root,
            text=True,
            capture_output=True,
            timeout=10,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def snapshot(self, directory):
        return {
            path.name: (path.read_bytes(), path.stat().st_mode, path.stat().st_mtime_ns)
            for path in directory.iterdir()
        }

    def rewrite_manifest(self, update):
        path = self.cache / "manifest.json"
        manifest = json.loads(path.read_text())
        update(manifest)
        path.write_text(json.dumps(manifest))

    def test_round_trip_restores_both_binaries_and_permissions(self):
        original = self.snapshot(self.target)
        self.run_script("stage")
        self.run_script("verify")
        self.assertEqual(self.snapshot(self.target), original)
        shutil.rmtree(self.target)

        self.run_script("install")

        self.assertEqual(self.snapshot(self.target), original)
        self.assertEqual(set(path.name for path in self.cache.iterdir()), {*BINARIES, "manifest.json"})

    def test_wrong_fingerprint_rejects_restore_without_replacing_outputs(self):
        self.run_script("stage")
        before = self.snapshot(self.target)

        result = self.run_script("install", "b" * 64, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("fingerprint", result.stderr)
        self.assertEqual(self.snapshot(self.target), before)

    def test_corrupt_partial_and_nonexecutable_restores_preserve_installed_outputs(self):
        for damage in ("changed bytes", "missing binary", "nonexecutable", "symlink"):
            with self.subTest(damage=damage):
                self.run_script("stage")
                path = self.cache / "storage-migrate"
                if damage == "changed bytes":
                    with path.open("ab") as output:
                        output.write(b"corrupt")
                elif damage == "missing binary":
                    path.unlink()
                elif damage == "nonexecutable":
                    path.chmod(0o644)
                else:
                    path.unlink()
                    path.symlink_to(self.target / "storage-migrate")
                before = self.snapshot(self.target)

                result = self.run_script("install", check=False)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot(self.target), before)

    def test_manifest_requires_both_exact_binary_checksums(self):
        for damage in ("missing hash", "extra hash", "wrong format", "wrong platform", "invalid json"):
            with self.subTest(damage=damage):
                self.run_script("stage")
                if damage == "missing hash":
                    self.rewrite_manifest(lambda manifest: manifest["sha256"].pop("storage-migrate"))
                elif damage == "extra hash":
                    self.rewrite_manifest(lambda manifest: manifest["sha256"].update({"other": "a" * 64}))
                elif damage == "wrong format":
                    self.rewrite_manifest(lambda manifest: manifest.update(format=2))
                elif damage == "wrong platform":
                    self.rewrite_manifest(lambda manifest: manifest.update(machine="different-runner"))
                else:
                    (self.cache / "manifest.json").write_text("not json")
                before = self.snapshot(self.target)

                result = self.run_script("install", check=False)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot(self.target), before)

    def test_rejects_wrong_elf_architecture_type_and_invalid_files_even_with_matching_hash(self):
        for damage in ("architecture", "object file", "empty", "script"):
            with self.subTest(damage=damage):
                self.run_script("stage")
                path = self.cache / "api-server"
                data = bytearray(path.read_bytes())
                if damage == "architecture":
                    struct.pack_into("<H", data, 18, 0)
                elif damage == "object file":
                    struct.pack_into("<H", data, 16, 1)
                elif damage == "empty":
                    data = b""
                else:
                    data = b"#!/bin/sh\ntouch SHOULD_NOT_EXECUTE\n"
                path.write_bytes(data)
                self.rewrite_manifest(
                    lambda manifest: manifest["sha256"].update({"api-server": hashlib.sha256(data).hexdigest()})
                )
                before = self.snapshot(self.target)

                result = self.run_script("install", check=False)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot(self.target), before)
                self.assertFalse((self.root / "SHOULD_NOT_EXECUTE").exists())

    def test_failed_stage_preserves_previous_valid_bundle(self):
        self.run_script("stage")
        before = self.snapshot(self.cache)
        (self.target / "storage-migrate").unlink()

        result = self.run_script("stage", "b" * 64, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshot(self.cache), before)
        self.run_script("verify")

    def test_missing_manifest_and_invalid_fingerprint_fail_without_writes(self):
        before = self.snapshot(self.target)
        for command, fingerprint in (("install", FINGERPRINT), ("stage", "bad")):
            with self.subTest(command=command):
                result = self.run_script(command, fingerprint, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot(self.target), before)
                self.assertFalse(self.cache.exists())

    def test_writes_require_ci(self):
        self.env["CI"] = "false"
        result = self.run_script("stage", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("restricted to CI", result.stderr)
        self.assertFalse(self.cache.exists())


if __name__ == "__main__":
    unittest.main()
