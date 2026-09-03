#!/usr/bin/env python3
"""Verify the checked-in release compatibility set.

The manifest is a release boundary, not descriptive documentation. Every
referenced artifact is read and compared with the pinned values. Missing
inputs, mutable contract references, generated-file edits, or version drift
fail closed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


HEX64 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT_ID = re.compile(r"^[0-9a-f]{40}$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def fail(message: str) -> None:
    raise SystemExit(f"verify-release-manifest: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def object_field(obj: dict[str, Any], key: str, kind: type) -> Any:
    value = obj.get(key)
    require(type(value) is kind, f"{key} must be {kind.__name__}")
    return value


def relative_path(root: Path, value: Any, label: str) -> Path:
    require(isinstance(value, str) and value, f"{label} must be a non-empty relative path")
    path = Path(value)
    require(not path.is_absolute() and ".." not in path.parts, f"{label} must stay inside the checkout")
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root.resolve()), f"{label} escapes the checkout")
    return resolved


def read_json(path: Path, label: str) -> dict[str, Any]:
    require(path.is_file(), f"{label} is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{label} is not valid JSON: {error}")
    require(isinstance(value, dict), f"{label} must be a JSON object")
    return value


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_contract(root: Path, manifest: dict[str, Any], contracts: Path) -> None:
    expected = object_field(manifest, "application_contract", dict)
    require(contracts.is_dir(), f"lumiere-contracts checkout is missing: {contracts}")

    ir_relative = object_field(expected, "ir_path", str)
    pin_relative = object_field(expected, "pin_path", str)
    ir_path = relative_path(contracts, ir_relative, "application_contract.ir_path")
    pin_path = relative_path(contracts, pin_relative, "application_contract.pin_path")
    ir = read_json(ir_path, "contract IR")
    pin = read_json(pin_path, "contract PIN")

    ir_version = object_field(expected, "ir_version", int)
    artifact_sha = object_field(expected, "artifact_sha256", str)
    schema_hash = object_field(expected, "schema_hash", str)
    source_commit = object_field(expected, "source_commit", str)
    source_repository = object_field(expected, "source_repository", str)
    require(HEX64.fullmatch(artifact_sha), "application_contract.artifact_sha256 must be lowercase SHA-256")
    require(schema_hash.startswith("sha256:") and HEX64.fullmatch(schema_hash[7:]), "application_contract.schema_hash is invalid")
    require(GIT_OBJECT_ID.fullmatch(source_commit), "application_contract.source_commit is invalid")
    require(sha256(ir_path) == artifact_sha, "contract IR artifact checksum does not match manifest")

    require(ir.get("ir_version") == ir_version, "contract IR ir_version does not match manifest")
    require(ir.get("schema_hash") == schema_hash, "contract IR schema_hash does not match manifest")
    require(ir.get("source_commit") == source_commit, "contract IR source_commit does not match manifest")
    require(ir.get("source_dirty") is False, "contract IR must come from a clean source checkout")
    require("persistence" in ir, "contract IR persistence section is required")

    pin_expected = {
        "artifact_sha256": artifact_sha,
        "ir_version": ir_version,
        "path": ir_relative,
        "schema_hash": schema_hash,
        "source_commit": source_commit,
        "source_repository": source_repository,
    }
    require(pin == pin_expected, "contract PIN does not exactly match application_contract")
    sidecar = ir_path.with_name(ir_path.name + ".sha256")
    require(sidecar.is_file(), "contract IR checksum sidecar is missing")
    sidecar_text = sidecar.read_text(encoding="utf-8").strip().split()
    require(len(sidecar_text) == 2 and sidecar_text[0] == artifact_sha and sidecar_text[1] == ir_path.name, "contract IR checksum sidecar does not match artifact")

    contracts_expected = object_field(manifest, "lumiere_contracts", dict)
    package = object_field(contracts_expected, "package", str)
    version = object_field(contracts_expected, "version", str)
    tag = object_field(contracts_expected, "tag", str)
    revision = object_field(contracts_expected, "revision", str)
    repository = object_field(contracts_expected, "repository", str)
    require(package == "lumiere-contracts", "unsupported contracts package")
    require(SEMVER.fullmatch(version), "lumiere_contracts.version must be semantic version")
    require(tag == f"v{version}", "lumiere_contracts.tag must match version")
    require(GIT_OBJECT_ID.fullmatch(revision), "lumiere_contracts.revision must be a 40-character immutable revision")
    require(repository.startswith("ssh://") or repository.startswith("https://"), "lumiere_contracts.repository must be an explicit URL")

    contract_version_file = contracts / "CONTRACT_VERSION"
    require(contract_version_file.is_file(), "lumiere-contracts CONTRACT_VERSION is missing")
    require(contract_version_file.read_text(encoding="utf-8").strip() == version, "CONTRACT_VERSION does not match manifest")

    lock_path = root / "Cargo.lock"
    require(lock_path.is_file(), "Cargo.lock is required to bind the immutable contract revision")
    lock = lock_path.read_text(encoding="utf-8")
    package_match = re.search(r'(?ms)^\[\[package\]\]\s+name = "lumiere-contracts"\s+version = "([^"]+)"\s+source = "([^"]+)"', lock)
    require(package_match is not None, "Cargo.lock has no lumiere-contracts package entry")
    locked_version, locked_source = package_match.groups()
    require(locked_version == version, "Cargo.lock lumiere-contracts version does not match manifest")
    require(f"?tag={tag}#{revision}" in locked_source, "Cargo.lock does not pin the manifest tag and immutable revision")


def verify_operation_history(root: Path, contracts: Path, manifest: dict[str, Any]) -> None:
    expected = object_field(manifest, "operation_history", dict)
    history_path = relative_path(root, expected.get("path"), "operation_history.path")
    digest = object_field(expected, "checksum", str)
    require(
        digest.startswith("sha256:") and HEX64.fullmatch(digest[7:]),
        "operation_history.checksum is invalid",
    )
    require(
        digest == f"sha256:{sha256(history_path)}",
        "operation history checksum does not match release manifest",
    )
    ir_path = relative_path(
        contracts,
        manifest["application_contract"].get("ir_path"),
        "application_contract.ir_path",
    )
    verifier = root / "scripts" / "verify-operation-history.py"
    require(verifier.is_file(), "operation history verifier is missing")
    result = subprocess.run(
        [sys.executable, str(verifier), str(ir_path), str(history_path)],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    require(
        result.returncode == 0,
        f"operation history verification failed: {result.stderr.strip()}",
    )


def verify_stdb(root: Path, manifest: dict[str, Any]) -> None:
    expected = object_field(manifest, "stdb_module", dict)
    cargo_path = relative_path(root, expected.get("source_path"), "stdb_module.source_path")
    cargo = read_text(cargo_path, "STDB module Cargo.toml")
    package_name = re.search(r'(?ms)^\[package\].*?^name\s*=\s*"([^"]+)"', cargo)
    package_version = re.search(r'(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"', cargo)
    require(package_name and package_name.group(1) == expected.get("name"), "STDB module package name does not match manifest")
    require(package_version and package_version.group(1) == expected.get("version"), "STDB module version does not match manifest")
    source = read_text(relative_path(root, expected.get("contract_source_path"), "stdb_module.contract_source_path"), "STDB module contract source")
    match = re.search(r'(?m)^pub const CONTRACT_VERSION:\s*&str\s*=\s*"([^"]+)";', source)
    require(match and match.group(1) == expected.get("contract_version"), "STDB module contract version does not match manifest")


def read_text(path: Path, label: str) -> str:
    require(path.is_file(), f"{label} is missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"cannot read {label}: {error}")


def verify_pg(root: Path, manifest: dict[str, Any]) -> None:
    expected = object_field(manifest, "durable_postgres", dict)
    sql_path = relative_path(root, expected.get("sql_path"), "durable_postgres.sql_path")
    schema_path = relative_path(root, expected.get("manifest_path"), "durable_postgres.manifest_path")
    schema = read_json(schema_path, "durable PG schema manifest")
    migration = schema.get("migration")
    require(isinstance(migration, dict), "durable PG schema manifest has no migration section")
    require(migration.get("version") == expected.get("migration_version"), "durable PG migration version does not match manifest")
    require(migration.get("name") == expected.get("migration_name"), "durable PG migration name does not match manifest")
    require(migration.get("sql_file") == expected.get("sql_path"), "durable PG migration path does not match manifest")
    digest = object_field(expected, "checksum", str)
    require(digest.startswith("sha256:") and HEX64.fullmatch(digest[7:]), "durable_postgres.checksum is invalid")
    require(digest == f"sha256:{sha256(sql_path)}", "durable PG migration checksum does not match SQL")
    require(migration.get("checksum") == digest, "durable PG schema manifest checksum does not match release manifest")


def verify_services(root: Path, manifest: dict[str, Any]) -> None:
    services = object_field(manifest, "services", dict)
    api = object_field(services, "api_server", dict)
    api_text = read_text(relative_path(root, api.get("source_path"), "services.api_server.source_path"), "api-server Cargo.toml")
    api_package = re.search(r"(?ms)^\[package\].*?(?=^\[|\Z)", api_text)
    require(api_package is not None, "api-server Cargo.toml has no package section")
    api_version = re.search(r'^version\s*=\s*"([^"]+)"', api_package.group(0), re.MULTILINE)
    if api_version is None:
        uses_workspace_version = re.search(r"^version\.workspace\s*=\s*true\s*$", api_package.group(0), re.MULTILINE)
        require(uses_workspace_version is not None, "api-server package version is not explicit or workspace-inherited")
        root_cargo = read_text(root / "Cargo.toml", "workspace Cargo.toml")
        workspace_package = re.search(r"(?ms)^\[workspace\.package\].*?(?=^\[|\Z)", root_cargo)
        require(workspace_package is not None, "workspace Cargo.toml has no workspace.package section")
        api_version = re.search(r'^version\s*=\s*"([^"]+)"', workspace_package.group(0), re.MULTILINE)
    require(api_version and api_version.group(1) == api.get("version"), "api-server version does not match manifest")
    web = object_field(services, "web", dict)
    web_json = read_json(relative_path(root, web.get("source_path"), "services.web.source_path"), "web package.json")
    require(web_json.get("version") == web.get("version"), "web version does not match manifest")


def verify_minimum_client(manifest: dict[str, Any]) -> None:
    expected = object_field(manifest, "minimum_client_contract", dict)
    require(expected.get("version") == "ir-v2", "minimum client contract must be ir-v2")
    require(expected.get("ir_version") == 2, "minimum client IR version must be 2")
    require(expected.get("generated_contract_release") == manifest["lumiere_contracts"]["version"], "minimum client release must match generated contract release")


def verify_deployment(root: Path, manifest: dict[str, Any]) -> None:
    expected = object_field(manifest, "deployment", dict)
    generation = expected.get("config_generation")
    require(isinstance(generation, int) and generation >= 1, "deployment.config_generation must be a positive integer")
    sources = expected.get("config_sources")
    require(
        isinstance(sources, list)
        and sources == sorted(sources, key=lambda item: item.get("path", "") if isinstance(item, dict) else ""),
        "deployment.config_sources must be sorted",
    )
    for source in sources:
        require(isinstance(source, dict), "deployment config source must be an object")
        path = relative_path(root, source.get("path"), "deployment.config_sources.path")
        digest = source.get("sha256")
        require(isinstance(digest, str) and HEX64.fullmatch(digest), f"deployment config checksum is invalid for {path}")
        require(sha256(path) == digest, f"deployment config source changed: {path}")


def resolve_contracts_checkout(root: Path) -> Path:
    resolver = root / "scripts" / "resolve-pinned-contracts.sh"
    require(resolver.is_file(), "scripts/resolve-pinned-contracts.sh is missing")
    try:
        result = subprocess.run(["bash", str(resolver)], cwd=root, capture_output=True, text=True, check=False)
    except OSError as error:
        fail(f"could not resolve lumiere-contracts checkout: {error}")
    require(result.returncode == 0 and result.stdout.strip(), "could not resolve the fetched lumiere-contracts checkout")
    return Path(result.stdout.strip()).resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", nargs="?", type=Path, default=Path("release-compatibility-manifest.json"))
    parser.add_argument("--root", type=Path, help="repository root (defaults to the manifest's parent)")
    parser.add_argument("--contracts-root", type=Path, help="resolved lumiere-contracts checkout (for CI/tests)")
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    root = (args.root or manifest_path.parent).resolve()
    manifest = read_json(manifest_path, "release manifest")
    require(manifest.get("schema_version") == 1, "unsupported release manifest schema_version")
    contracts = (
        args.contracts_root.resolve()
        if args.contracts_root
        else resolve_contracts_checkout(root)
    )
    verify_contract(root, manifest, contracts)
    verify_operation_history(root, contracts, manifest)
    verify_stdb(root, manifest)
    verify_pg(root, manifest)
    verify_services(root, manifest)
    verify_minimum_client(manifest)
    verify_deployment(root, manifest)
    print(f"release compatibility verified: {manifest_path}")


if __name__ == "__main__":
    main()
