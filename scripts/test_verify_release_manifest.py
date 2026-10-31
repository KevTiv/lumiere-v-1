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

class DurableMigrationListTest(unittest.TestCase):
    """verify_pg against a small synthetic contracts checkout."""

    BASELINE = "-- baseline\nCREATE TABLE IF NOT EXISTS \"t\" (id bigint);\n"
    FOLLOW_UP = "-- follow-up\nCREATE INDEX IF NOT EXISTS \"t_id\" ON \"t\" (id);\n"

    def _verifier(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("verify_release_manifest", VERIFIER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _checkout(self, update=None, durable_version=11, application_version=None):
        import hashlib

        application_version = application_version or durable_version
        follow_up_name = f"{durable_version:04d}_durable_projection_delta"
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        contracts = base / "contracts"
        migrations = contracts / "manifests/pg_ddl/migrations"
        migrations.mkdir(parents=True)
        files = {
            "0001_durable_projection": self.BASELINE,
            follow_up_name: self.FOLLOW_UP,
        }
        checks = {}
        for name, sql in files.items():
            (migrations / f"{name}.sql").write_text(sql, encoding="utf-8")
            checks[name] = "sha256:" + hashlib.sha256(sql.encode()).hexdigest()
        catalog = base / "root/api-server/src/cold_tier/migrate.rs"
        catalog.parent.mkdir(parents=True)
        frozen = base / "root/lumiere-codegen/pg-migration-ledger"
        frozen.mkdir(parents=True)
        (frozen / f"{follow_up_name}.sql").write_text(self.FOLLOW_UP, encoding="utf-8")
        crate = contracts / "crates/lumiere-contracts/src/lib.rs"
        crate.parent.mkdir(parents=True)
        crate.write_text(
            'pub mod manifests {\n'
            '    pub const PG_DDL_MIGRATIONS_0001_DURABLE_PROJECTION: &str = include_str!("../../../manifests/pg_ddl/migrations/0001_durable_projection.sql");\n'
            '}\n',
            encoding="utf-8",
        )
        entries = ""
        for n in range(1, application_version + 1):
            sql = ""
            if n == 1:
                sql = "        sql: lumiere_contracts::manifests::PG_DDL_MIGRATIONS_0001_DURABLE_PROJECTION,\n"
            elif n == application_version:
                sql = f'        sql: include_str!("../../../lumiere-codegen/pg-migration-ledger/{follow_up_name}.sql"),\n'
            entries += f"    Migration {{\n        version: {n},\n{sql}    }},\n"
        catalog.write_text(
            "pub const MIGRATIONS: &[Migration] = &[\n" + entries + "];\n", encoding="utf-8"
        )
        schema = {
            "migration": {
                "version": 1,
                "name": "0001_durable_projection",
                "sql_file": "manifests/pg_ddl/migrations/0001_durable_projection.sql",
                "checksum": checks["0001_durable_projection"],
            },
            "migrations": [
                {
                    "version": 1,
                    "name": "0001_durable_projection",
                    "sql_file": "manifests/pg_ddl/migrations/0001_durable_projection.sql",
                    "checksum": checks["0001_durable_projection"],
                    "state": "released",
                },
                {
                    "version": durable_version,
                    "name": follow_up_name,
                    "sql_file": f"manifests/pg_ddl/migrations/{follow_up_name}.sql",
                    "checksum": checks[follow_up_name],
                    "state": "released",
                },
            ],
        }
        manifest = {
            "durable_postgres": {
                "migration_version": 1,
                "migration_name": "0001_durable_projection",
                "sql_path": "manifests/pg_ddl/migrations/0001_durable_projection.sql",
                "manifest_path": "manifests/durable-pg-schema-manifest.json",
                "checksum": checks["0001_durable_projection"],
                "application_catalog_path": "api-server/src/cold_tier/migrate.rs",
                "application_catalog_version": application_version,
                "application_catalog_checksum": "sha256:" + "a" * 64,
            }
        }
        if update:
            update(schema, manifest, migrations)
        (contracts / "manifests/durable-pg-schema-manifest.json").write_text(
            json.dumps(schema), encoding="utf-8"
        )
        return base / "root", contracts, manifest

    def _verify(self, update=None):
        root, contracts, manifest = self._checkout(update)
        module = self._verifier()
        module.verify_pg(root, contracts, manifest)

    def _failure(self, update):
        with self.assertRaises(SystemExit) as raised:
            self._verify(update)
        return str(raised.exception)

    def test_released_follow_up_is_accepted(self):
        self._verify()

    def test_generated_30_sql_can_be_registered_at_application_31(self):
        root, contracts, manifest = self._checkout(durable_version=30, application_version=31)
        self._verifier().verify_pg(root, contracts, manifest)

    def test_application_31_receipt_sql_does_not_register_unreferenced_generated_31(self):
        root, contracts, manifest = self._checkout(durable_version=31, application_version=31)
        # The same SQL bytes at a different artifact identity must not stand in
        # for the future generated migration merely because app version 31 exists.
        frozen = root / "lumiere-codegen/pg-migration-ledger/0030_durable_projection_delta.sql"
        frozen.write_text(self.FOLLOW_UP, encoding="utf-8")
        catalog = root / "api-server/src/cold_tier/migrate.rs"
        catalog.write_text(
            catalog.read_text(encoding="utf-8").replace(
                "0031_durable_projection_delta.sql", "0030_durable_projection_delta.sql"
            ),
            encoding="utf-8",
        )
        with self.assertRaises(SystemExit) as raised:
            self._verifier().verify_pg(root, contracts, manifest)
        self.assertIn("migration 31 SQL is missing from the application migration catalog", str(raised.exception))

    def test_registered_local_sql_must_match_the_released_artifact_bytes(self):
        root, contracts, manifest = self._checkout()
        frozen = root / "lumiere-codegen/pg-migration-ledger/0011_durable_projection_delta.sql"
        frozen.write_text("-- edited application SQL\n", encoding="utf-8")
        with self.assertRaises(SystemExit) as raised:
            self._verifier().verify_pg(root, contracts, manifest)
        self.assertIn("registered SQL checksum does not match", str(raised.exception))

    def test_baseline_constant_must_actually_reference_the_verified_baseline(self):
        root, contracts, manifest = self._checkout()
        crate = contracts / "crates/lumiere-contracts/src/lib.rs"
        crate.write_text(
            crate.read_text(encoding="utf-8").replace(
                "0001_durable_projection.sql", "0011_durable_projection_delta.sql"
            ),
            encoding="utf-8",
        )
        with self.assertRaises(SystemExit) as raised:
            self._verifier().verify_pg(root, contracts, manifest)
        self.assertIn("migration 1 SQL is missing from the application migration catalog", str(raised.exception))

    def test_pending_follow_up_is_rejected(self):
        message = self._failure(lambda schema, _m, _d: schema["migrations"][1].update({"state": "pending"}))
        self.assertIn("still pending", message)

    def test_follow_up_with_changed_sql_is_rejected(self):
        def change(_schema, _manifest, migrations):
            (migrations / "0011_durable_projection_delta.sql").write_text("-- edited\n", encoding="utf-8")

        self.assertIn("checksum does not match its SQL", self._failure(change))

    def test_follow_up_missing_from_the_application_catalog_is_rejected(self):
        message = self._failure(lambda schema, _m, _d: schema["migrations"][1].update({"version": 12}))
        self.assertIn("missing from the application migration catalog", message)

    def test_baseline_entry_must_match_the_release_manifest(self):
        message = self._failure(
            lambda schema, _m, _d: schema["migrations"][0].update({"checksum": "sha256:" + "0" * 64})
        )
        self.assertIn("baseline migration does not match", message)

    def test_manifest_without_a_migration_list_is_still_accepted(self):
        def drop(schema, _manifest, _migrations):
            del schema["migrations"]

        self._verify(drop)


if __name__ == "__main__":
    unittest.main()
