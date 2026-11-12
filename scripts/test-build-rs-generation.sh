#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/lumiere-build-rs-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT

# Own the dependency setup and use Cargo's artifact coordinates: newer Cargo
# versions and custom build directories need not place libraries in debug/deps.
cd "$repo_dir"
cargo build --locked -p serde_json --message-format=json > "$test_dir/artifacts.jsonl"
python3 - "$repo_dir/api-server/build.rs" "$test_dir" <<'PY'
import json
from pathlib import Path
import subprocess
import sys

source, directory = Path(sys.argv[1]), Path(sys.argv[2])
libraries, dependency_dirs = set(), set()
for line in (directory / "artifacts.jsonl").read_text().splitlines():
    artifact = json.loads(line)
    if artifact.get("reason") != "compiler-artifact":
        continue
    for filename in artifact["filenames"]:
        path = Path(filename)
        dependency_dirs.add(path.parent)
        if artifact["target"]["name"] == "serde_json" and path.suffix == ".rlib":
            libraries.add(path)
if len(libraries) != 1:
    raise SystemExit("Cargo must emit exactly one serde_json library for the build-script test")

binary = directory / "build-rs-tests"
command = [
    "rustc", "--edition=2021", "--test", str(source),
    "--extern", f"serde_json={libraries.pop()}", "-o", str(binary),
]
for dependency_dir in sorted(dependency_dirs):
    command.extend(["-L", f"dependency={dependency_dir}"])
subprocess.run(command, check=True)
subprocess.run([str(binary)], check=True)
PY
