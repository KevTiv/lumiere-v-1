#!/usr/bin/env python3
"""Content fingerprints for build reuse; never prints source or secret values."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

EXCLUDED = {"node_modules", ".git", ".next", ".turbo", ".tmp", "target", "dist",
            "__pycache__", "playwright-report", "test-results", ".auth"}
COMMON = ("scripts/build-fingerprint.py", "scripts/e2e-dx.sh", "Makefile")
RUST = (
    "Cargo.toml",
    "Cargo.lock",
    ".cargo",
    "rust-toolchain",
    "rust-toolchain.toml",
    "scripts/prepare-vendored-contracts-rust.sh",
)
API_CI_RECIPE = (
    *COMMON,
    "scripts/e2e-api-cache.py",
    "scripts/prepare-vendored-contracts-rust.sh",
    "scripts/resolve-pinned-contracts.sh",
    "scripts/sync-directory.py",
    "scripts/verify-contract-ir.py",
    "scripts/verify-agent-capability-artifact.py",
    ".github/workflows/e2e-smoke.yml",
    ".github/actions/prepare-contracts/action.yml",
)
API_CI_ENV = {
    "RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion", "CONTRACTS_STAGING_DIR",
    "CC", "CXX", "AR", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "ARFLAGS", "LDFLAGS",
    "HOST_CC", "HOST_CXX", "HOST_AR", "TARGET_CC", "TARGET_CXX", "TARGET_AR",
    "CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "LIBRARY_PATH", "LD_LIBRARY_PATH",
    "CRATE_CC_NO_DEFAULTS", "SOURCE_DATE_EPOCH",
}


def api_ci_inputs(root: Path, environ: dict):
    """Native Actions binaries require a complete, prepared Cargo workspace."""
    import tomllib

    for key in ("RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion"):
        if not environ.get(key):
            raise ValueError(f"api-ci requires {key}")
    if environ.get("CARGO_BUILD_TARGET"):
        raise ValueError("api-ci does not support CARGO_BUILD_TARGET")
    compiler_overrides = {"RUSTC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "CC", "CXX", "AR",
                          "HOST_CC", "HOST_CXX", "HOST_AR", "TARGET_CC", "TARGET_CXX", "TARGET_AR",
                          "CARGO_BUILD_RUSTC", "CARGO_BUILD_RUSTC_WRAPPER", "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER"}
    if any(value and (key in compiler_overrides or key.endswith("_LINKER")
                      or key.startswith(("CC_", "CXX_", "AR_")))
           for key, value in environ.items()):
        raise ValueError("api-ci requires the runner's default native compiler and linker")

    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--offline", "--locked", "--format-version", "1"],
        cwd=root, env=environ, text=True,
    ))
    if Path(metadata["workspace_root"]).resolve() != root:
        raise ValueError("api-ci requires the repository Cargo workspace")
    if Path(metadata["target_directory"]).resolve() != root / "target":
        raise ValueError("api-ci requires the default target/debug output layout")

    packages = set()
    for package in metadata["packages"]:
        if package["source"] is None:
            manifest = Path(package["manifest_path"])
            if not manifest.resolve().is_relative_to(root):
                raise ValueError("api-ci does not support Cargo packages outside the checkout")
            if not manifest.is_file():
                raise ValueError("api-ci requires every local Cargo package manifest")
            packages.add(manifest.parent)
    if root / "api-server" not in packages:
        raise ValueError("api-ci metadata is missing api-server")

    staging = (root / "api-server" / environ.get(
        "CONTRACTS_STAGING_DIR", "../.contracts-staging",
    )).resolve()
    if not staging.is_relative_to(root):
        raise ValueError("api-ci requires contracts staging inside the checkout")
    release = json.loads((root / "release-compatibility-manifest.json").read_text())
    version = release["lumiere_contracts"]["version"]
    if not isinstance(version, str) or not version or "/" in version or "\\" in version:
        raise ValueError("api-ci requires a valid contracts release version")
    required = (
        *API_CI_RECIPE, "Cargo.toml", "Cargo.lock", "api-server/build.rs",
        "release-compatibility-manifest.json",
        f"vendor/lumiere-contracts-rust-{version}.tar.gz",
        f"vendor/lumiere-contracts-rust-{version}.sha256",
        "vendor/lumiere-contracts/CONTRACT_VERSION",
        "vendor/lumiere-contracts/VENDORED_SOURCE.json",
        "vendor/lumiere-contracts/crates/lumiere-contracts/Cargo.toml",
        "crates/stdb-auth/assets/resource_registry.json",
        "lumiere-codegen/storage-policy-manifest.json",
        "lumiere-codegen/read-descriptor-policies.json",
        "lumiere-codegen/contract-operation-ids.json",
    )
    directories = (
        *packages, "crates", "vendor/lumiere-contracts",
        "vendor/lumiere-contracts/manifests", "lumiere-codegen/pg-migration-ledger",
        staging / "bindings", staging / "manifests", staging / "ir",
    )
    for entry in required:
        if not (root / entry).is_file():
            raise ValueError(f"api-ci missing required input: {entry}")
    for entry in directories:
        path = root / entry
        if not path.is_dir() or not any(path.iterdir()):
            raise ValueError(f"api-ci missing prepared input directory: {path.relative_to(root)}")

    # Cargo also reads ancestor and user configuration. Keep those contents in
    # the key without making an identical checkout depend on its absolute path.
    cargo_home = root / environ.get("CARGO_HOME", str(Path(environ.get("HOME", str(Path.home()))) / ".cargo"))
    config_paths = [directory / ".cargo" / name
                    for directory in (root, *root.parents)
                    for name in ("config", "config.toml")]
    config_paths.extend(cargo_home / name for name in ("config", "config.toml"))
    external_names = {}
    for path in dict.fromkeys(config_paths):
        if not path.exists():
            continue
        config = tomllib.loads(path.read_text())
        build = config.get("build", {})
        if build.get("target"):
            raise ValueError("api-ci does not support Cargo config build.target")
        if (any(build.get(key) for key in ("rustc", "rustc-wrapper", "rustc-workspace-wrapper"))
                or any(target.get("linker") for target in config.get("target", {}).values())
                or compiler_overrides.intersection(config.get("env", {}))):
            raise ValueError("api-ci requires the runner's default native compiler and linker")
        external_names[path] = f"cargo-config/{len(external_names)}"
    return (*required, *directories, *RUST, *external_names), external_names


def fingerprint(root: Path, kind: str, environ: dict, tool_version: str = "") -> str:
    external_names = {}
    if kind == "api-ci":
        inputs, external_names = api_ci_inputs(root, environ)
        if not tool_version:
            commands = (["rustc", "--version", "--verbose"], ["cargo", "--version"],
                        ["cc", "--version"], ["ld", "--version"], ["ldd", "--version"])
            versions = [subprocess.check_output(command, cwd=root, env=environ, text=True).strip()
                        for command in commands]
            if not all(versions):
                raise ValueError("api-ci requires every native tool version")
            tool_version = "\n".join(versions)
        prefixes = ("CARGO_", "RUST", "STDB_", "LUMIERE_", "PG_", "WORKOS_", "E2E_BUILD_",
                    "CC_", "CXX_", "AR_", "CFLAGS_", "CXXFLAGS_", "CPPFLAGS_", "ARFLAGS_",
                    "HOST_", "TARGET_", "PKG_CONFIG", "OPENSSL_", "DEP_", "CMAKE_",
                    "BINDGEN_", "CLANG_", "LLVM_", "RING_", "AWS_LC_")
    elif kind == "api":
        staging = Path(environ.get("CONTRACTS_STAGING_DIR", "../.contracts-staging"))
        staging = (root / "api-server" / staging).resolve()
        inputs = (*COMMON, *RUST, "api-server", "crates", staging / "bindings",
                  *root.glob("vendor/lumiere-contracts-rust-*.tar.gz"),
                  *root.glob("vendor/lumiere-contracts-rust-*.sha256"),
                  *root.glob("frontend/web/.env*"))
        prefixes = ("CARGO_", "RUST", "STDB_", "LUMIERE_", "PG_", "WORKOS_", "E2E_BUILD_")
    elif kind == "stdb-wasm":
        # This is a compiled module, independent of browser tests and API code.
        # Include all local crates (including the embedded resource registry),
        # module fixtures, external policy data, and the CI build recipe.
        inputs = (*RUST, "scripts/build-fingerprint.py", "spacetimedb", "crates",
                  "lumiere-codegen/storage-policy-manifest.json",
                  "spacetime.json", "spacetime.local.json",
                  ".github/workflows/e2e-smoke.yml",
                  ".github/actions/setup-spacetime-cli/action.yml")
        prefixes = ("CARGO_", "RUST", "SPACETIME_", "LUMIERE_", "WASM_", "BINARYEN_")
    elif kind == "stdb":
        inputs = (*COMMON, "spacetimedb", *root.glob("scripts/e2e*"),
                  "frontend/web/scripts", "frontend/web/package.json", "frontend/pnpm-lock.yaml")
        prefixes = ("CARGO_", "RUST", "SPACETIME_", "E2E_BUILD_")
    else:
        inputs = (*COMMON, "frontend", ".env", ".env.local", ".env.production")
        prefixes = ("NEXT_PUBLIC_", "LUMIERE_", "STDB_", "POSTHOG_", "WORKOS_")
    files = set()
    missing = set()

    def check_source(path: Path):
        if kind == "api-ci" and path not in external_names:
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError(f"api-ci requires ordinary checkout inputs: {path}")

    def walk_error(error):
        raise error

    for entry in inputs:
        path = root / entry
        check_source(path)
        if path.is_dir():
            for directory, names, leaves in os.walk(path, onerror=walk_error if kind == "api-ci" else None):
                names[:] = sorted(name for name in names if name not in EXCLUDED)
                if kind == "api-ci":
                    for name in (*names, *leaves):
                        check_source(Path(directory) / name)
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
    def input_name(path: Path) -> str:
        # Identical checkouts must share CI fingerprints regardless of location.
        # Existing local API builds may intentionally use external staging.
        if path.is_relative_to(root):
            return str(path.relative_to(root))
        return external_names.get(path, str(path))

    for name in sorted(missing):
        add(f"missing:{input_name(Path(name))}".encode())
    for path in sorted(files, key=input_name if kind == "api-ci" else None):
        if kind == "api-ci" and not path.is_file():
            raise ValueError(f"api-ci requires a regular input file: {input_name(path)}")
        add(os.fsencode(input_name(path)))
        add(path.read_bytes())
    for key, value in sorted(environ.items()):
        if key.startswith(prefixes) or key in {"NODE_ENV", "DEV_MOCK_ORG_ID", "CORS_ORIGINS"} or (kind == "api-ci" and key in API_CI_ENV):
            if kind == "api-ci":
                value = value.replace(str(root) + os.sep, "{checkout}/")
                if value == str(root):
                    value = "{checkout}"
            add(key.encode())
            add(value.encode())
    return digest.hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("api", "api-ci", "frontend", "stdb", "stdb-wasm"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if args.kind == "api-ci":
        commands = ()
    elif args.kind == "stdb-wasm":
        commands = (["rustc", "--version", "--verbose"], ["cargo", "--version"],
                    ["spacetime", "--version"], ["wasm-opt", "--version"])
    else:
        commands = (["node", "--version"] if args.kind == "frontend" else ["rustc", "--version"],)
    version = "\n".join(subprocess.check_output(command, text=True).strip() for command in commands)
    print(fingerprint(args.root.resolve(), args.kind, dict(os.environ), version))
