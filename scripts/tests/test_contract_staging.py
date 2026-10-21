import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).parents[2]
OLD_MTIME_NS = 1_600_000_000_000_000_000


def contents(directory):
    return {
        str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in directory.rglob("*")
        if path.is_file()
    }


def mtimes(directory):
    return {
        str(path.relative_to(directory)): path.stat().st_mtime_ns
        for path in [directory, *directory.rglob("*")]
    }


def age(directory):
    for path in [directory, *directory.rglob("*")]:
        os.utime(path, ns=(OLD_MTIME_NS, OLD_MTIME_NS))


class ContractStagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lumiere-contract-staging-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        (self.root / "vendor").mkdir()
        for name in (
            "prepare-vendored-contracts-rust.sh",
            "sync-directory.py",
            "resolve-pinned-contracts.sh",
            "verify-contract-ir.py",
            "verify-agent-capability-artifact.py",
        ):
            shutil.copy2(ROOT / "scripts" / name, self.root / "scripts" / name)
        shutil.copy2(ROOT / "Makefile", self.root / "Makefile")
        version = "1.2.3"
        self.archive = self.root / "vendor" / f"lumiere-contracts-rust-{version}.tar.gz"
        self.checksum = self.archive.with_name(f"lumiere-contracts-rust-{version}.sha256")
        self.vendor = self.root / "vendor/lumiere-contracts"
        self.staging = self.root / ".contracts-staging"
        self.bindings = self.staging / "bindings"

        metadata = {
            "repository": "https://example.invalid/contracts",
            "revision": "1" * 40,
            "version": version,
        }
        (self.root / "release-compatibility-manifest.json").write_text(
            json.dumps({"lumiere_contracts": metadata})
        )
        semantic = {field: [] for field in ("operations", "resources", "tables", "types")}
        schema_hash = "sha256:" + hashlib.sha256(
            json.dumps(semantic, separators=(",", ":")).encode()
        ).hexdigest()
        ir = json.dumps({
            "ir_version": 2,
            "source_commit": metadata["revision"],
            "source_dirty": False,
            "schema_hash": schema_hash,
            **semantic,
        })
        artifact_hash = hashlib.sha256(ir.encode()).hexdigest()
        fixture = self.root / "contracts-fixture"
        files = {
            "CONTRACT_VERSION": version,
            "VENDORED_SOURCE.json": json.dumps(metadata),
            "crates/lumiere-contracts/Cargo.toml": f'[package]\nversion = "{version}"\n',
            "crates/lumiere-contracts/src/bindings/row.rs": "pub struct Row;\n",
            "manifests/reducer-manifest.json": "{}",
            "ir/lumiere-contract-ir-v2.json": ir,
            "ir/lumiere-contract-ir-v2.json.sha256": (
                f"{artifact_hash}  lumiere-contract-ir-v2.json\n"
            ),
            "ir/PIN-v2.json": json.dumps({
                "artifact_sha256": artifact_hash,
                "ir_version": 2,
                "path": "ir/lumiere-contract-ir-v2.json",
                "schema_hash": schema_hash,
                "source_commit": metadata["revision"],
                "source_repository": metadata["repository"],
            }),
            "packages/contracts/src/generated/query-registry.ts": "export {};\n",
            "packages/contracts/src/generated/operation-inputs.ts": "export {};\n",
            "packages/contracts/src/generated/operation-descriptors.ts": "export {};\n",
            "packages/contracts/src/stdb-generated-sql-columns.json": "{}",
            "packages/contracts/src/stdb-reducer-invalidation.ts": "export {};\n",
        }
        for name, text in files.items():
            path = fixture / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.repack(fixture)

        # Exercise the real Make target and validators without fetching crates.
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        cargo = fake_bin / "cargo"
        cargo.write_text('#!/bin/sh\ntest "$*" = "fetch --quiet"\n')
        cargo.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}"}

    def run_command(self, *args, success=True):
        result = subprocess.run(
            args, cwd=self.root, env=self.env, text=True, capture_output=True
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def prepare(self, **kwargs):
        return self.run_command("bash", "scripts/prepare-vendored-contracts-rust.sh", **kwargs)

    def stage(self, **kwargs):
        return self.run_command("make", "contracts-staging-from-pinned", **kwargs)

    def repack(self, source):
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.add(source, arcname="lumiere-contracts")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.checksum.write_text(f"{digest}  {self.archive.name}\n")

    def test_repeated_preparation_and_staging_preserve_all_input_mtimes(self):
        # Keep one integration case on the complete real release. Other cases
        # use the small valid fixture so these scope-job tests stay inexpensive.
        manifest = ROOT / "release-compatibility-manifest.json"
        shutil.copy2(manifest, self.root / manifest.name)
        version = json.loads(manifest.read_text())["lumiere_contracts"]["version"]
        for name in (
            f"lumiere-contracts-rust-{version}.tar.gz",
            f"lumiere-contracts-rust-{version}.sha256",
        ):
            shutil.copy2(ROOT / "vendor" / name, self.root / "vendor" / name)
        self.stage()
        expected = contents(self.staging)
        for directory in (self.vendor, self.staging):
            age(directory)
        original_vendor_mtimes = mtimes(self.vendor)
        original_staging_mtimes = mtimes(self.staging)

        self.prepare()
        self.stage()

        self.assertEqual(contents(self.staging), expected)
        self.assertEqual(mtimes(self.vendor), original_vendor_mtimes)
        self.assertEqual(mtimes(self.staging), original_staging_mtimes)

    def test_preparation_repairs_corrupt_missing_and_stale_files(self):
        self.prepare()
        expected_vendor = contents(self.vendor)
        expected_bindings = contents(self.bindings)
        age(self.vendor)
        age(self.bindings)
        binding = next(self.bindings.glob("*.rs"))
        binding.write_bytes(b"x" * binding.stat().st_size)
        os.utime(binding, ns=(OLD_MTIME_NS, OLD_MTIME_NS))
        vendor_binding = self.vendor / "crates/lumiere-contracts/src/bindings" / binding.name
        vendor_binding.unlink()
        (self.vendor / ".stale").write_text("remove")
        (self.bindings / "stale-directory").mkdir()
        (self.bindings / "stale-directory/file").write_text("remove")

        self.prepare()

        self.assertEqual(contents(self.vendor), expected_vendor)
        self.assertEqual(contents(self.bindings), expected_bindings)
        self.assertFalse((self.vendor / ".stale").exists())
        self.assertFalse((self.bindings / "stale-directory").exists())
        self.assertGreater(binding.stat().st_mtime_ns, OLD_MTIME_NS)
        self.assertGreater(vendor_binding.stat().st_mtime_ns, OLD_MTIME_NS)
        self.assertEqual((self.vendor / "CONTRACT_VERSION").stat().st_mtime_ns, OLD_MTIME_NS)

    def test_changed_verified_archive_updates_files_despite_epoch_timestamps(self):
        self.prepare()
        age(self.vendor)
        age(self.bindings)
        source = self.root / "updated-contracts"
        shutil.copytree(self.vendor, source)
        relative = next((source / "crates/lumiere-contracts/src/bindings").glob("*.rs"))
        relative.write_text(relative.read_text() + "\n// updated contract input\n")
        os.utime(relative, ns=(0, 0))
        removed = source / "crates/lumiere-contracts/src/bindings/retired_type.rs"
        existing = self.vendor / removed.relative_to(source)
        existing.write_text("old generated input")
        (self.bindings / removed.name).write_text("old generated input")
        self.repack(source)

        self.prepare()

        for updated in (
            self.vendor / relative.relative_to(source),
            self.bindings / relative.name,
        ):
            self.assertEqual(updated.read_bytes(), relative.read_bytes())
            self.assertGreater(updated.stat().st_mtime_ns, OLD_MTIME_NS)
        self.assertFalse(existing.exists())
        self.assertFalse((self.bindings / removed.name).exists())
        self.assertEqual((self.vendor / "CONTRACT_VERSION").stat().st_mtime_ns, OLD_MTIME_NS)

    def test_invalid_archive_checksum_does_not_modify_prepared_inputs(self):
        self.prepare()
        before = (contents(self.vendor), mtimes(self.vendor), mtimes(self.bindings))
        with self.archive.open("ab") as archive:
            archive.write(b"corrupt")

        self.prepare(success=False)

        self.assertEqual(
            (contents(self.vendor), mtimes(self.vendor), mtimes(self.bindings)), before
        )

    def test_manifest_revision_mismatch_does_not_modify_prepared_inputs(self):
        self.prepare()
        before = (mtimes(self.vendor), mtimes(self.bindings))
        manifest_path = self.root / "release-compatibility-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["lumiere_contracts"]["revision"] = "0" * 40
        manifest_path.write_text(json.dumps(manifest))

        result = self.prepare(success=False)

        self.assertIn("revision does not match release manifest", result.stderr)
        self.assertEqual((mtimes(self.vendor), mtimes(self.bindings)), before)

    def test_full_staging_removes_stale_outputs_without_touching_bindings(self):
        self.stage()
        expected = contents(self.staging)
        age(self.bindings)
        original_mtimes = mtimes(self.bindings)
        (self.staging / ".stale").write_text("old output")
        (self.staging / "ts/generated/stale.ts").write_text("old output")
        (self.staging / "manifests/stale.json").write_text("{}")

        self.stage()

        self.assertEqual(contents(self.staging), expected)
        self.assertFalse((self.staging / ".stale").exists())
        self.assertEqual(mtimes(self.bindings), original_mtimes)

    def test_invalid_pinned_ir_fails_before_replacing_full_staging(self):
        self.stage()
        before = (contents(self.staging), mtimes(self.staging))
        source = self.root / "invalid-contracts"
        shutil.copytree(self.vendor, source)
        (source / "ir/lumiere-contract-ir-v2.json").write_text("{}")
        self.repack(source)

        result = self.stage(success=False)

        self.assertIn("verify-contract-ir:", result.stderr)
        self.assertEqual((contents(self.staging), mtimes(self.staging)), before)

    def test_incomplete_capability_pair_fails_before_replacing_full_staging(self):
        self.stage()
        before = (contents(self.staging), mtimes(self.staging))
        source = self.root / "invalid-contracts"
        shutil.copytree(self.vendor, source)
        (source / "ir/agent-capability-registry-v1.json").write_text("{}")
        self.repack(source)

        result = self.stage(success=False)

        self.assertIn("capability artifact and checksum sidecar", result.stderr)
        self.assertEqual((contents(self.staging), mtimes(self.staging)), before)


class DirectorySyncTests(unittest.TestCase):
    def test_repairs_entry_types_without_following_destination_symlinks(self):
        with tempfile.TemporaryDirectory(prefix="lumiere-directory-sync-test-") as temp:
            root = Path(temp)
            source = root / "source"
            destination = root / "destination"
            source.mkdir()
            destination.mkdir()
            (source / "directory").mkdir()
            (source / "directory/file").write_text("nested")
            (source / "regular").write_text("file")
            (source / "link").symlink_to("regular")
            (source / ".hidden").write_text("hidden")
            (destination / "directory").write_text("wrong type")
            outside = root / "outside"
            outside.write_text("untouched")
            (destination / "regular").symlink_to(outside)
            (destination / "link").mkdir()
            (destination / "stale-link").symlink_to(outside)

            subprocess.run(
                [
                    "python3", str(ROOT / "scripts/sync-directory.py"),
                    str(source), str(destination),
                ],
                check=True,
            )

            self.assertEqual(contents(destination), contents(source))
            self.assertTrue((destination / "link").is_symlink())
            self.assertFalse((destination / "regular").is_symlink())
            self.assertFalse((destination / "stale-link").is_symlink())
            self.assertEqual(outside.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()
