#!/usr/bin/env python3
"""Content fingerprints for local reuse; never prints source or secret values."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess

EXCLUDED = {"node_modules", ".git", ".next", ".turbo", ".tmp", "target", "dist",
            "__pycache__", "playwright-report", "test-results", ".auth"}
COMMON = ("scripts/build-fingerprint.py", "scripts/e2e-dx.sh", "Makefile")
RUST = ("Cargo.toml", "Cargo.lock", ".cargo", "rust-toolchain", "rust-toolchain.toml")


def fingerprint(root: Path, kind: str, environ: dict, tool_version: str = "") -> str:
    if kind == "api":
        staging = Path(environ.get("CONTRACTS_STAGING_DIR", "../.contracts-staging"))
        staging = (root / "api-server" / staging).resolve()
        inputs = (*COMMON, *RUST, "api-server", "crates", staging / "bindings",
                  *root.glob("frontend/web/.env*"))
        prefixes = ("CARGO_", "RUST", "STDB_", "LUMIERE_", "PG_", "WORKOS_", "E2E_BUILD_")
    elif kind == "stdb":
        inputs = (*COMMON, "spacetimedb", *root.glob("scripts/e2e*"),
                  "frontend/web/scripts", "frontend/web/package.json", "frontend/pnpm-lock.yaml")
        prefixes = ("CARGO_", "RUST", "SPACETIME_", "E2E_BUILD_")
    else:
        inputs = (*COMMON, "frontend", ".env", ".env.local", ".env.production")
        prefixes = ("NEXT_PUBLIC_", "LUMIERE_", "STDB_", "POSTHOG_", "WORKOS_")
    files = set()
    missing = set()
    for entry in inputs:
        path = root / entry
        if path.is_dir():
            for directory, names, leaves in os.walk(path):
                names[:] = sorted(name for name in names if name not in EXCLUDED)
                files.update(Path(directory) / name for name in leaves if not name.endswith((".pyc", ".tsbuildinfo")))
        elif path.is_file():
            files.add(path)
        else:
            missing.add(str(path))
    digest = hashlib.sha256()

    def add(value: bytes):
        digest.update(len(value).to_bytes(8, "big"))
        digest.update(value)

    add(f"lumiere-build-v1:{kind}:{tool_version}".encode())
    for name in sorted(missing):
        add(f"missing:{name}".encode())
    for path in sorted(files):
        add(os.fsencode(path))
        add(path.read_bytes())
    for key, value in sorted(environ.items()):
        if key.startswith(prefixes) or key in {"NODE_ENV", "DEV_MOCK_ORG_ID", "CORS_ORIGINS"}:
            add(key.encode())
            add(value.encode())
    return digest.hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("api", "frontend", "stdb"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    command = ["node", "--version"] if args.kind == "frontend" else ["rustc", "--version"]
    version = subprocess.check_output(command, text=True).strip()
    print(fingerprint(args.root.resolve(), args.kind, dict(os.environ), version))
