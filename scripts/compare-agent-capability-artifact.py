#!/usr/bin/env python3
"""Compare a regenerated agent capability artifact with a pinned release.

The artifact embeds the provenance of the IR it was generated from
(`source_ir.source_commit` and `source_ir.source_dirty`). Any commit after the
release source commit, including the consumer pin commit itself, regenerates a
different commit ID, so a byte comparison cannot distinguish provenance from
real drift. Everything else, including `source_ir.ir_version`,
`source_ir.schema_hash` and every capability entry, must match exactly.

Each file's checksum sidecar is verified separately by
`verify-agent-capability-artifact.py`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

PROVENANCE_FIELDS = ("source_commit", "source_dirty")


class ArtifactDriftError(ValueError):
    """Raised when two capability artifacts differ beyond provenance."""


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ArtifactDriftError(f"cannot read capability artifact {path}: {error}") from error
    if not isinstance(value, dict) or not isinstance(value.get("source_ir"), dict):
        raise ArtifactDriftError(f"capability artifact {path} has no source_ir object")
    return value


def without_provenance(artifact: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of `artifact` with only source commit provenance removed."""

    normalized = dict(artifact)
    source_ir = dict(artifact["source_ir"])
    for field in PROVENANCE_FIELDS:
        source_ir.pop(field, None)
    normalized["source_ir"] = source_ir
    return normalized


def compare(generated: dict[str, Any], pinned: dict[str, Any]) -> None:
    left = without_provenance(generated)
    right = without_provenance(pinned)
    if left == right:
        return
    differing = sorted(
        key for key in set(left) | set(right) if left.get(key) != right.get(key)
    )
    details = ", ".join(differing)
    if "source_ir" in differing:
        source_fields = sorted(
            key
            for key in set(left["source_ir"]) | set(right["source_ir"])
            if left["source_ir"].get(key) != right["source_ir"].get(key)
        )
        details += f" (source_ir: {', '.join(source_fields)})"
    raise ArtifactDriftError(f"agent capability artifact drifted beyond provenance: {details}")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: compare-agent-capability-artifact.py <generated> <pinned>", file=sys.stderr)
        return 2
    try:
        compare(_load(Path(argv[0])), _load(Path(argv[1])))
    except ArtifactDriftError as error:
        print(f"compare-agent-capability-artifact: {error}", file=sys.stderr)
        return 1
    print("compare-agent-capability-artifact: matches pinned release apart from source provenance")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
