#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import re
import shlex
import sys

root = Path(sys.argv[1])
dockerfile = (root / "Dockerfile.rust-runtime").read_text(encoding="utf-8")
entrypoint = (root / "scripts/lumiere-runtime-entrypoint.sh").read_text(encoding="utf-8")
workflow = (root / ".github/workflows/build-rust-runtime-image.yml").read_text(encoding="utf-8")

expected = {
    "api-server",
    "expense-integration-worker",
    "gateway",
    "hr-integration-worker",
    "owner-report-worker",
    "projection-worker",
    "project-integration-worker",
    "storage-migrate",
    "workflow-worker",
}

for binary in expected - {"gateway"}:
    source = (
        root / "api-server" / "src" / "main.rs"
        if binary == "api-server"
        else root / "api-server" / "src" / "bin" / f"{binary}.rs"
    )
    if not source.is_file():
        raise SystemExit(f"runtime image selects missing api-server binary source: {binary}")

dockerfile_commands = "\n".join(
    line for line in dockerfile.splitlines() if not line.lstrip().startswith("#")
)
builder_commands, _, runtime_commands = dockerfile_commands.partition("\nFROM debian:")
planner, separator, application = builder_commands.partition("\nFROM chef AS builder\n")
if not separator or "RUN cargo chef prepare --recipe-path /app/recipe.json" not in planner:
    raise SystemExit("runtime image must prepare a dependency recipe in a separate planner stage")
dependencies, separator, _ = application.partition("COPY release-compatibility-manifest.json ./")
if not separator or "COPY --from=planner /app/recipe.json ./recipe.json" not in dependencies:
    raise SystemExit("runtime dependency stage must consume only the prepared recipe")
if re.search(r"^COPY (?!\-\-from=planner /app/recipe.json)", dependencies, re.MULTILINE):
    raise SystemExit("application sources must not invalidate the dependency compilation layer")
if "cargo install cargo-chef --version 0.1.73 --locked" not in planner:
    raise SystemExit("runtime dependency builder must pin cargo-chef with its lockfile")
if "cargo chef cook --locked --release" not in dependencies:
    raise SystemExit("runtime dependencies must compile in the locked production release profile")
if "RUN scripts/prepare-vendored-contracts-rust.sh" not in application:
    raise SystemExit("runtime application stage must replace dummy contracts with verified real contracts")

# Keep dependency feature selection aligned with both application build commands.
def selected_targets(commands, prefix):
    selections = []
    for command in commands.split(prefix)[1:]:
        command = command.split("&&", 1)[0]
        selections.append((re.findall(r"-p\s+([a-z0-9-]+)", command),
                           re.findall(r"--bin\s+([a-z0-9-]+)", command)))
    return selections

if selected_targets(dependencies, "cargo chef cook ") != selected_targets(application, "cargo build "):
    raise SystemExit("dependency recipe and application must build the same packages and binaries")
builder_sources = {
    source.removeprefix("./").rstrip("/")
    for line in builder_commands.splitlines()
    if line.startswith("COPY ")
    for source in shlex.split(line)[1:-1]
    if not source.startswith("--")
}
if builder_sources & {"", ".", "*", "Makefile", "scripts"}:
    raise SystemExit("runtime compilation must not depend on the whole context, Makefile, or scripts tree")
build_helpers = {
    "scripts/prepare-vendored-contracts-rust.sh",
    "scripts/sync-directory.py",
}
if {source for source in builder_sources if source.startswith("scripts/")} != build_helpers:
    raise SystemExit("runtime builder must copy only the two required contract preparation helpers")
if (
    "COPY --chmod=0755 scripts/lumiere-runtime-entrypoint.sh /usr/local/bin/lumiere-runtime-entrypoint"
    not in runtime_commands
):
    raise SystemExit("runtime dispatcher must be copied directly into the final runtime stage")

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
