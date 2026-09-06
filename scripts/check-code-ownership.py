#!/usr/bin/env python3
"""Check structural ownership guardrails for modularized API paths."""

from __future__ import annotations

import argparse
from pathlib import Path


RETIRED_FLAT_FILES = (
    "api-server/src/workflow_reads.rs",
    "api-server/src/query_exec.rs",
    "api-server/src/http_app.rs",
)
REQUIRED_MODULE_FILES = (
    "api-server/src/workflow_reads/mod.rs",
    "api-server/src/query_exec/mod.rs",
    "api-server/src/http_app/mod.rs",
    "api-server/src/realtime/bridge.rs",
    "api-server/src/realtime/socket.rs",
    "api-server/src/realtime/subscription.rs",
    # Preserve the generated descriptor and active cold-read owners. Existence
    # does not prove their behavior;
    # fail-closed merge semantics require separate runtime tests.
    "api-server/src/cold_tier/read_descriptor.rs",
    "api-server/src/cold_tier/pos_order_read.rs",
)


def check_repo(root: Path) -> list[str]:
    """Return structural ownership violations for *root*."""
    errors: list[str] = []
    for relative in RETIRED_FLAT_FILES:
        if (root / relative).exists():
            errors.append(f"retired flat owner still exists: {relative}")
    for relative in REQUIRED_MODULE_FILES:
        if not (root / relative).is_file():
            errors.append(f"required module owner is missing: {relative}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).parents[1])
    args = parser.parse_args()
    errors = check_repo(args.root.resolve())
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("code ownership guardrails passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
