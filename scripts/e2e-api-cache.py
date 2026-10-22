#!/usr/bin/env python3
"""Stage and verify native API executables reused by the E2E builder."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import struct
import sys
import tempfile


BINARIES = ("api-server", "storage-migrate")
ELF_MACHINES = {"x86_64": 62, "aarch64": 183}


def validate_binary(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"missing regular executable: {path.name}")
    mode = path.stat().st_mode
    if not mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
        raise ValueError(f"not executable: {path.name}")
    with path.open("rb") as source:
        header = source.read(64)
    # Never invoke these binaries for validation: storage-migrate immediately
    # applies migrations, and api-server immediately starts the server.
    if len(header) < 64 or header[:7] != b"\x7fELF\x02\x01\x01":
        raise ValueError(f"not a native 64-bit little-endian ELF executable: {path.name}")
    elf_type, machine = struct.unpack_from("<HH", header, 16)
    if elf_type not in (2, 3) or machine != ELF_MACHINES.get(platform.machine()):
        raise ValueError(f"wrong ELF type or architecture: {path.name}")


def checksum(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify(directory: Path, fingerprint: str) -> None:
    manifest_path = directory / "manifest.json"
    if directory.is_symlink() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("missing regular API cache manifest")
    manifest = json.loads(manifest_path.read_text())
    if not isinstance(manifest, dict) or (
        manifest.get("format") != 1
        or manifest.get("fingerprint") != fingerprint
        or manifest.get("machine") != platform.machine()
    ):
        raise ValueError("API cache format, fingerprint, or platform mismatch")
    hashes = manifest.get("sha256")
    if not isinstance(hashes, dict) or set(hashes) != set(BINARIES):
        raise ValueError("API cache must describe both executables")
    for name in BINARIES:
        path = directory / name
        validate_binary(path)
        if hashes[name] != checksum(path):
            raise ValueError(f"API cache checksum mismatch: {name}")


def stage(root: Path, directory: Path, fingerprint: str) -> None:
    # Validate both fresh outputs before replacing a previously staged bundle.
    for name in BINARIES:
        validate_binary(root / "target" / "debug" / name)
    directory.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="e2e-api-stage-", dir=directory.parent) as work:
        bundle = Path(work) / "bundle"
        bundle.mkdir()
        for name in BINARIES:
            shutil.copy2(root / "target" / "debug" / name, bundle / name)
        manifest = {
            "format": 1,
            "fingerprint": fingerprint,
            "machine": platform.machine(),
            "sha256": {name: checksum(bundle / name) for name in BINARIES},
        }
        (bundle / "manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
        verify(bundle, fingerprint)
        if directory.exists() or directory.is_symlink():
            if directory.is_symlink():
                raise ValueError("API cache directory must not be a symlink")
            shutil.rmtree(directory)
        bundle.rename(directory)


def install(root: Path, directory: Path, fingerprint: str) -> None:
    # A corrupt or partial restore must not replace either installed executable.
    verify(directory, fingerprint)
    target = root / "target" / "debug"
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".e2e-api-install-", dir=target) as work:
        for name in BINARIES:
            destination = Path(work) / name
            shutil.copy2(directory / name, destination)
            destination.chmod(0o755)
        for name in BINARIES:
            os.replace(Path(work) / name, target / name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("stage", "install", "verify"))
    parser.add_argument("fingerprint")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{64}", args.fingerprint):
        parser.error("expected a 64-character lowercase build fingerprint")
    if sys.platform != "linux" or platform.machine() not in ELF_MACHINES:
        parser.error("API cache requires a supported native Linux runner")
    if args.command != "verify" and os.environ.get("CI") != "true":
        parser.error("API cache writes are restricted to CI workspaces")
    root = args.root.resolve()
    directory = root / ".ci" / "e2e-api"
    try:
        if args.command == "verify":
            verify(directory, args.fingerprint)
        elif args.command == "stage":
            stage(root, directory, args.fingerprint)
        else:
            install(root, directory, args.fingerprint)
    except (OSError, ValueError) as error:
        print(f"e2e-api-cache: {error}", file=sys.stderr)
        return 1
    print(f"[e2e] API cache {args.command} verified for {args.fingerprint}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
