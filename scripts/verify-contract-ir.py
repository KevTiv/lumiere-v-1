#!/usr/bin/env python3
"""Validate the immutable handoff consumed by lumiere-contracts emitters."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
GIT_OBJECT_ID = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


def fail(message: str) -> None:
    raise SystemExit(f"verify-contract-ir: {message}")


def unique_names(items: list[dict[str, Any]], label: str) -> None:
    names = [item.get("name") for item in items]
    if any(not isinstance(name, str) or not name for name in names):
        fail(f"every {label} must have a non-empty name")
    if len(names) != len(set(names)):
        fail(f"{label} names must be unique")
    if names != sorted(names):
        fail(f"{label} must be sorted by name")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ir", type=Path)
    parser.add_argument(
        "--require-clean",
        action="store_true",
        help="reject an IR extracted from a dirty source checkout",
    )
    parser.add_argument(
        "--expect-schema-hash-from",
        type=Path,
        help="require the same semantic schema hash as another IR artifact",
    )
    args = parser.parse_args()

    raw = args.ir.read_bytes()
    try:
        ir = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"invalid JSON: {error}")

    required = {
        "ir_version",
        "source_commit",
        "source_dirty",
        "schema_hash",
        "operations",
        "resources",
        "tables",
        "types",
    }
    missing = required - ir.keys()
    if missing:
        fail(f"missing fields: {', '.join(sorted(missing))}")
    if ir["ir_version"] != 1:
        fail(f"unsupported ir_version {ir['ir_version']!r}")
    if not isinstance(ir["source_commit"], str) or not GIT_OBJECT_ID.fullmatch(
        ir["source_commit"]
    ):
        fail("source_commit must be a lowercase 40- or 64-character git object ID")
    if not isinstance(ir["source_dirty"], bool):
        fail("source_dirty must be a boolean")
    if args.require_clean and ir["source_dirty"]:
        fail("release IR was extracted from a dirty source checkout")
    if not isinstance(ir["schema_hash"], str) or not SHA256.fullmatch(ir["schema_hash"]):
        fail("schema_hash must be a lowercase sha256 digest")

    for field in ("operations", "resources", "tables", "types"):
        if not isinstance(ir[field], list):
            fail(f"{field} must be an array")
    unique_names(ir["operations"], "operations")
    unique_names(ir["resources"], "resources")
    unique_names(ir["tables"], "tables")

    indexes = [item.get("index") for item in ir["types"]]
    if indexes != list(range(len(indexes))):
        fail("type indexes must be contiguous and ordered from zero")
    for operation in ir["operations"]:
        name = operation["name"]
        kind = operation.get("kind")
        if kind not in {"reducer", "procedure", "view"}:
            fail(f"operation {name} has unsupported kind {kind!r}")
        application = operation.get("application")
        if kind == "reducer" and (not isinstance(application, dict) or application.get("name") != name):
            fail(f"reducer operation {name} application contract does not match")
        if kind != "reducer" and application is not None:
            fail(f"unannotated {kind} operation {name} must have null application metadata")
        if operation.get("schema", {}).get("name") != name:
            fail(f"operation {name} schema name does not match")

    semantic = {
        field: ir[field]
        for field in ("operations", "resources", "tables", "types")
    }
    canonical = json.dumps(
        semantic, ensure_ascii=False, separators=(",", ":")
    ).encode()
    schema_hash = f"sha256:{hashlib.sha256(canonical).hexdigest()}"
    if schema_hash != ir["schema_hash"]:
        fail(f"schema hash mismatch: expected {schema_hash}")
    if args.expect_schema_hash_from is not None:
        try:
            expected_ir = json.loads(args.expect_schema_hash_from.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            fail(f"cannot read expected IR: {error}")
        expected_hash = expected_ir.get("schema_hash")
        if expected_hash != schema_hash:
            fail(
                "semantic schema drift: "
                f"expected {expected_hash!r} from {args.expect_schema_hash_from}, got {schema_hash!r}"
            )

    checksum_path = args.ir.with_suffix(args.ir.suffix + ".sha256")
    checksum_parts = checksum_path.read_text(encoding="utf-8").split()
    if len(checksum_parts) != 2 or checksum_parts[1] != args.ir.name:
        fail(f"malformed checksum file {checksum_path}")
    artifact_hash = hashlib.sha256(raw).hexdigest()
    if checksum_parts[0] != artifact_hash:
        fail(f"artifact checksum mismatch: expected {artifact_hash}")

    print(
        "verify-contract-ir: valid "
        f"v{ir['ir_version']} {ir['schema_hash']} "
        f"({len(ir['operations'])} operations, {len(ir['resources'])} resources, "
        f"{len(ir['tables'])} tables, {len(ir['types'])} types)"
    )


if __name__ == "__main__":
    main()
