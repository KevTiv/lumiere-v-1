#!/usr/bin/env python3
"""Exercise physical restore against disposable archive fixtures."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "railway-stdb-restore.py"
IMAGE = "registry.example/spacetimedb@sha256:" + "1" * 64


class RestoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.target = self.work / "restored-data"
        self.archive = self.work / "data.tar.gz.age"
        self.manifest = self.work / "manifest.json"
        self.identity = self.work / "age.key"
        self.identity.touch()
        age = self.work / "age"
        age.write_text('#!/bin/sh\ncat\nexit "${AGE_TEST_STATUS:-0}"\n')
        age.chmod(0o700)
        self.env = {
            name: value
            for name, value in os.environ.items()
            if not name.startswith(("RAILWAY_", "STDB_RECOVERY_"))
        }
        self.env.update(
            PATH=f"{self.work}{os.pathsep}{self.env['PATH']}",
            STDB_RECOVERY_ISOLATED="1",
            STDB_RECOVERY_IMAGE=IMAGE,
        )
        self.write_archive()

    def write_archive(self, extra_member=None):
        with tarfile.open(self.archive, "w:gz") as archive:
            for name in ("./metadata.toml", "./replicas/1/data", "./auth/id_ecdsa", "./spacetime.pid"):
                entry = tarfile.TarInfo(name)
                contents = name.encode()
                entry.size = len(contents)
                archive.addfile(entry, io.BytesIO(contents))
            snapshot = tarfile.TarInfo("./snapshot/data")
            snapshot.type = tarfile.LNKTYPE
            snapshot.linkname = "./replicas/1/data"
            archive.addfile(snapshot)
            if extra_member:
                archive.addfile(extra_member)

        self.write_manifest()

    def write_manifest(self, **overrides):
        contents = self.archive.read_bytes()
        manifest = {
            "format": "lumiere-spacetimedb-physical-v1",
            "backup_id": "test",
            "image": IMAGE,
            "object_key": "physical/test/data.tar.gz.age",
            "size_bytes": len(contents),
            "sha256": hashlib.sha256(contents).hexdigest(),
        }
        self.manifest.write_text(json.dumps(manifest | overrides))

    def restore(self):
        return subprocess.run(
            [
                sys.executable,
                SCRIPT,
                self.manifest,
                self.archive,
                self.identity,
                self.target,
            ],
            env=self.env,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def assert_restore_rejected(self, reason):
        result = self.restore()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(reason, result.stderr)
        self.assertFalse(self.target.exists())
        self.assertEqual(list(self.work.glob(".stdb-restore-*")), [])

    def test_restores_database_hard_links_with_fresh_authentication(self):
        result = self.restore()
        self.assertEqual(result.returncode, 0, result.stderr)
        database = self.target / "replicas/1/data"
        snapshot = self.target / "snapshot/data"
        self.assertEqual(database.read_bytes(), b"./replicas/1/data")
        self.assertEqual(database.stat().st_ino, snapshot.stat().st_ino)
        self.assertFalse((self.target / "auth").exists())
        self.assertFalse((self.target / "spacetime.pid").exists())

    def test_rejects_wrong_digest_or_incompatible_image(self):
        self.write_manifest(sha256="2" * 64)
        self.assert_restore_rejected("checksum")
        self.write_manifest(size_bytes=1)
        self.assert_restore_rejected("size")
        self.write_manifest(image="registry.example/spacetimedb@sha256:" + "2" * 64)
        self.assert_restore_rejected("expected recovery image")

    def test_rejects_decrypt_failure_after_staging(self):
        self.env["AGE_TEST_STATUS"] = "1"
        self.assert_restore_rejected("could not authenticate and decrypt")

    def test_rejects_path_traversal_and_links_to_signing_keys(self):
        self.write_archive(tarfile.TarInfo("../outside"))
        self.assert_restore_rejected("unsafe archive path")
        self.assertFalse((self.work / "outside").exists())

        alias = tarfile.TarInfo("./public-key-alias")
        alias.type = tarfile.LNKTYPE
        alias.linkname = "./auth/id_ecdsa"
        self.write_archive(alias)
        self.assert_restore_rejected("invalid archive hard link")

    def test_rejects_live_environment_and_preserves_existing_directory(self):
        self.env["RAILWAY_ENVIRONMENT_NAME"] = "production"
        self.assert_restore_rejected("require spacetimedb-recovery in the recovery environment")
        self.env.update(
            RAILWAY_ENVIRONMENT_NAME="recovery",
            RAILWAY_SERVICE_NAME="spacetimedb-recovery",
            RAILWAY_VOLUME_MOUNT_PATH=str(self.work),
        )
        self.target.mkdir()
        sentinel = self.target / "existing"
        sentinel.touch()
        self.assertIn("must not exist", self.restore().stderr)
        self.assertTrue(sentinel.exists())


if __name__ == "__main__":
    unittest.main()
