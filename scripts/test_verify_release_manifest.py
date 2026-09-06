#!/usr/bin/env python3
"""Focused regression tests for the C4 release compatibility verifier."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify-release-manifest.py"


def contracts_checkout() -> Path:
    result = subprocess.run(
        ["bash", str(ROOT / "scripts/resolve-pinned-contracts.sh")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return Path(result.stdout.strip())


class ReleaseManifestTest(unittest.TestCase):
    def _run(self, manifest: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(VERIFIER),
                str(manifest),
                "--root",
                str(ROOT),
                "--contracts-root",
                str(contracts_checkout()),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def _tampered_manifest(self, update):
        temp = tempfile.TemporaryDirectory()
        path = Path(temp.name) / "release-compatibility-manifest.json"
        data = json.loads((ROOT / "release-compatibility-manifest.json").read_text())
        update(data)
        path.write_text(json.dumps(data), encoding="utf-8")
        return temp, path

    def test_current_release_manifest_is_valid(self):
        result = self._run(ROOT / "release-compatibility-manifest.json")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_changed_config_fails_closed(self):
        temp, path = self._tampered_manifest(
            lambda data: data["deployment"]["config_sources"][0].update({"sha256": "0" * 64})
        )
        self.addCleanup(temp.cleanup)
        result = self._run(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("config source changed", result.stderr)

    def test_changed_migration_checksum_fails_closed(self):
        temp, path = self._tampered_manifest(
            lambda data: data["durable_postgres"].update({"checksum": "sha256:" + "0" * 64})
        )
        self.addCleanup(temp.cleanup)
        result = self._run(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("migration checksum", result.stderr)

    def test_changed_application_migration_catalog_version_fails_closed(self):
        temp, path = self._tampered_manifest(
            lambda data: data["durable_postgres"].update(
                {"application_catalog_version": 999}
            )
        )
        self.addCleanup(temp.cleanup)
        result = self._run(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("catalog version", result.stderr)

    def test_invalid_application_migration_catalog_checksum_fails_closed(self):
        temp, path = self._tampered_manifest(
            lambda data: data["durable_postgres"].update(
                {"application_catalog_checksum": "sha256:" + "0" * 63}
            )
        )
        self.addCleanup(temp.cleanup)
        result = self._run(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("application_catalog_checksum is invalid", result.stderr)

    def test_changed_operation_history_checksum_fails_closed(self):
        temp, path = self._tampered_manifest(
            lambda data: data["operation_history"].update(
                {"checksum": "sha256:" + "0" * 64}
            )
        )
        self.addCleanup(temp.cleanup)
        result = self._run(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("operation history checksum", result.stderr)


if __name__ == "__main__":
    unittest.main()
