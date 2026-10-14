#!/usr/bin/env bash
# Build the deterministic application bundle from a lumiere-contracts release checkout.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 CONTRACTS_ROOT VERSION OUTPUT_DIR" >&2
  exit 2
fi

SOURCE_ROOT="$(cd "$1" && pwd)"
VERSION="$2"
OUTPUT_DIR="$3"
REVISION="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
REPOSITORY="ssh://git@github.com/KevTiv/lumiere-contracts.git"
test "$(cat "$SOURCE_ROOT/CONTRACT_VERSION")" = "$VERSION" || {
  echo "contracts checkout does not declare version $VERSION" >&2
  exit 1
}

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
BUNDLE="$STAGING/lumiere-contracts"

mkdir -p "$BUNDLE/crates" "$BUNDLE/packages/contracts" "$BUNDLE/scripts"
cp "$SOURCE_ROOT/CONTRACT_VERSION" "$BUNDLE/"
python3 - "$BUNDLE/VENDORED_SOURCE.json" "$VERSION" "$REVISION" "$REPOSITORY" <<'PY'
import json
import sys
from pathlib import Path

path, version, revision, repository = sys.argv[1:]
Path(path).write_text(
    json.dumps(
        {"repository": repository, "revision": revision, "version": version},
        indent=2,
        sort_keys=True,
    ) + "\n",
    encoding="utf-8",
)
PY
cp -a "$SOURCE_ROOT/crates/lumiere-contracts" "$BUNDLE/crates/"
cp -a "$SOURCE_ROOT/manifests" "$SOURCE_ROOT/ir" "$BUNDLE/"
cp -a "$SOURCE_ROOT/packages/contracts/src" "$BUNDLE/packages/contracts/"
cp "$SOURCE_ROOT/scripts/generate-from-ir.py" "$BUNDLE/scripts/"

ARCHIVE="lumiere-contracts-rust-$VERSION.tar.gz"
CHECKSUM="lumiere-contracts-rust-$VERSION.sha256"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -C "$STAGING" -czf "$OUTPUT_DIR/$ARCHIVE" lumiere-contracts
(cd "$OUTPUT_DIR" && sha256sum "$ARCHIVE" > "$CHECKSUM")
