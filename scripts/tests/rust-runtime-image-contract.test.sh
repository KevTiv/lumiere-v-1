#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
dockerfile = (root / "Dockerfile.rust-runtime").read_text(encoding="utf-8")
entrypoint = (root / "scripts/lumiere-runtime-entrypoint.sh").read_text(encoding="utf-8")
workflow = (root / ".github/workflows/build-rust-runtime-image.yml").read_text(encoding="utf-8")

expected = {
    "api-server",
    "gateway",
    "owner-report-worker",
    "projection-worker",
    "storage-migrate",
    "workflow-worker",
}

dockerfile_commands = "\n".join(
    line for line in dockerfile.splitlines() if not line.lstrip().startswith("#")
)
built = set(re.findall(r"--bin\s+([a-z0-9-]+)", dockerfile_commands))
if built != expected:
    raise SystemExit(f"runtime image builds {sorted(built)}, expected {sorted(expected)}")
if "--bins" in dockerfile_commands:
    raise SystemExit("runtime image must build an explicit binary allowlist, not --bins")

installed = set(re.findall(r"target/release/([a-z0-9-]+)", dockerfile))
if installed != expected:
    raise SystemExit(f"runtime image installs {sorted(installed)}, expected {sorted(expected)}")

case_match = re.search(r"\n\s*([^\n]+)\)\n\s*;;", entrypoint)
if not case_match:
    raise SystemExit("could not find runtime dispatcher allowlist")
allowed = set(case_match.group(1).strip().split("|"))
if allowed != expected:
    raise SystemExit(f"runtime dispatcher allows {sorted(allowed)}, expected {sorted(expected)}")

required_workflow_fragments = (
    "cache-from: type=gha,scope=lumiere-rust-runtime",
    "cache-to: type=gha,mode=max,scope=lumiere-rust-runtime",
    "provenance: mode=max",
    "sbom: true",
    "subject-digest: ${{ steps.build.outputs.digest }}",
    "commit image tags are immutable",
    "push: ${{ github.event_name != 'pull_request' }}",
)
for fragment in required_workflow_fragments:
    if fragment not in workflow:
        raise SystemExit(f"runtime image workflow is missing: {fragment}")

if re.search(r"(?:^|\s)(?:latest|stable)(?:\s|$)", workflow):
    raise SystemExit("runtime image workflow must not publish a mutable release tag")
PY
