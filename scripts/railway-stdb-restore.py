#!/usr/bin/env python3
"""Materialize a verified physical backup on a fresh, isolated volume."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from typing import BinaryIO
import zlib


BACKUP_FORMAT = "lumiere-spacetimedb-physical-v1"
BACKUP_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
IMAGE_REFERENCE = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")
SHA256 = re.compile(r"[0-9a-f]{64}")
EXCLUDED_ROOT_ENTRIES = {"auth", "id_ecdsa", "id_ecdsa.pub", "spacetime.pid"}


def restore_target(path: Path) -> Path:
    if os.environ.get("STDB_RECOVERY_ISOLATED") != "1":
        raise ValueError("set STDB_RECOVERY_ISOLATED=1 on an isolated recovery target")
    if not BACKUP_ID.fullmatch(path.name):
        raise ValueError("provide a fresh recovery data directory")

    target = path.parent.resolve(strict=True) / path.name
    if target.exists() or target.is_symlink():
        raise ValueError("the recovery data directory must not exist")
    if any(
        name in os.environ
        for name in (
            "RAILWAY_PROJECT_ID",
            "RAILWAY_ENVIRONMENT_NAME",
            "RAILWAY_SERVICE_NAME",
            "RAILWAY_VOLUME_MOUNT_PATH",
        )
    ):
        mount = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH")
        if (
            os.environ.get("RAILWAY_ENVIRONMENT_NAME") != "recovery"
            or os.environ.get("RAILWAY_SERVICE_NAME") != "spacetimedb-recovery"
            or not mount
            or target.parent != Path(mount).resolve(strict=True)
        ):
            raise ValueError(
                "Railway restores require spacetimedb-recovery in the recovery "
                "environment and a fresh directory directly under its volume mount"
            )
    return target


def read_manifest(path: Path) -> dict[str, object]:
    expected_image = os.environ.get("STDB_RECOVERY_IMAGE", "")
    if not IMAGE_REFERENCE.fullmatch(expected_image):
        raise ValueError("STDB_RECOVERY_IMAGE must be a digest-pinned image reference")

    with path.open(encoding="utf-8") as source:
        manifest = json.load(source)
    if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
        raise ValueError("unsupported backup manifest format")
    if manifest.get("image") != expected_image:
        raise ValueError("backup image does not match the expected recovery image")

    backup_id = manifest.get("backup_id")
    checksum = manifest.get("sha256")
    size = manifest.get("size_bytes")
    if (
        not isinstance(backup_id, str)
        or not BACKUP_ID.fullmatch(backup_id)
        or manifest.get("object_key") != f"physical/{backup_id}/data.tar.gz.age"
        or not isinstance(checksum, str)
        or not SHA256.fullmatch(checksum)
        or type(size) is not int
        or size < 1
    ):
        raise ValueError("backup manifest has invalid object metadata")
    return manifest


def relative_archive_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe archive path: {name!r}")
    return path


def extract_archive(source: BinaryIO, destination: Path) -> None:
    files: set[PurePosixPath] = set()
    with gzip.GzipFile(fileobj=source) as decompressed:
        with tarfile.open(fileobj=decompressed, mode="r|") as archive:
            for member in archive:
                path = relative_archive_path(member.name)
                if not path.parts:
                    if not member.isdir():
                        raise ValueError("the archive root must be a directory")
                    continue
                if path.parts[0] in EXCLUDED_ROOT_ENTRIES:
                    continue
                entry = destination / path
                if member.isdir():
                    entry.mkdir(parents=True, exist_ok=True)
                    continue
                entry.parent.mkdir(parents=True, exist_ok=True)
                if member.isreg():
                    with archive.extractfile(member) as contents, entry.open("xb") as output:
                        shutil.copyfileobj(contents, output)
                elif member.islnk():
                    original = relative_archive_path(member.linkname)
                    if original not in files:
                        raise ValueError(f"invalid archive hard link: {member.name!r}")
                    os.link(destination / original, entry)
                else:
                    raise ValueError(f"unsupported archive member: {member.name!r}")
                files.add(path)
        # tar stops at the end marker. Read the gzip trailer and all decrypted data
        # before publishing the staged directory.
        while decompressed.read(1024 * 1024):
            pass
    if (
        PurePosixPath("metadata.toml") not in files
        or not (destination / "metadata.toml").stat().st_size
        or not (destination / "replicas").is_dir()
    ):
        raise ValueError("backup archive is missing SpacetimeDB metadata.toml or replicas")


def restore(manifest_path: Path, archive_path: Path, identity: Path, output: Path) -> None:
    target = restore_target(output)
    manifest = read_manifest(manifest_path)
    with archive_path.open("rb") as encrypted:
        if os.fstat(encrypted.fileno()).st_size != manifest["size_bytes"]:
            raise ValueError("backup archive size does not match its manifest")
        if hashlib.file_digest(encrypted, "sha256").hexdigest() != manifest["sha256"]:
            raise ValueError("backup archive checksum does not match its manifest")
        encrypted.seek(0)

        with tempfile.TemporaryDirectory(prefix=".stdb-restore-", dir=target.parent) as temp:
            staged = Path(temp) / "data"
            staged.mkdir()
            with subprocess.Popen(
                ["age", "--decrypt", "--identity", str(identity)],
                stdin=encrypted,
                stdout=subprocess.PIPE,
            ) as process:
                assert process.stdout is not None
                try:
                    extract_archive(process.stdout, staged)
                except BaseException:
                    process.kill()
                    raise
                if process.wait():
                    raise ValueError("age could not authenticate and decrypt the backup archive")

            # Claim the name before rename so two restores can never replace each other.
            target.mkdir()
            try:
                staged.rename(target)
            except OSError:
                target.rmdir()
                raise
    print(f"restored backup {manifest['backup_id']} to {target}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("archive", type=Path)
    parser.add_argument("age_identity_file", type=Path)
    parser.add_argument("fresh_data_dir", type=Path)
    args = parser.parse_args()

    os.umask(0o077)
    try:
        restore(args.manifest, args.archive, args.age_identity_file, args.fresh_data_dir)
    except (ValueError, OSError, EOFError, tarfile.TarError, zlib.error) as error:
        print(f"SpacetimeDB restore failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
