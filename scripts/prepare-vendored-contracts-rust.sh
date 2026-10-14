#!/usr/bin/env bash
# Verify and unpack the immutable lumiere-contracts release used by Cargo,
# code generation, and release-manifest validation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(python3 - "$ROOT/release-compatibility-manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["lumiere_contracts"]["version"])
PY
)"
ARCHIVE="$ROOT/vendor/lumiere-contracts-rust-$VERSION.tar.gz"
CHECKSUM="$ROOT/vendor/lumiere-contracts-rust-$VERSION.sha256"
TARGET="$ROOT/vendor/lumiere-contracts"
TEMP="$(mktemp -d "$ROOT/vendor/.lumiere-contracts.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT

test -f "$ARCHIVE" || { echo "missing vendored contracts archive: $ARCHIVE" >&2; exit 1; }
test -f "$CHECKSUM" || { echo "missing vendored contracts checksum: $CHECKSUM" >&2; exit 1; }
(cd "$ROOT/vendor" && sha256sum -c "$(basename "$CHECKSUM")")
tar -xzf "$ARCHIVE" -C "$TEMP" --strip-components=1

CRATE_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$TEMP/crates/lumiere-contracts/Cargo.toml" | head -1)"
test "$CRATE_VERSION" = "$VERSION" || {
  echo "vendored contracts crate is $CRATE_VERSION; release manifest requires $VERSION" >&2
  exit 1
}
test "$(cat "$TEMP/CONTRACT_VERSION")" = "$VERSION" || {
  echo "vendored CONTRACT_VERSION does not match $VERSION" >&2
  exit 1
}
python3 - "$ROOT/release-compatibility-manifest.json" "$TEMP/VENDORED_SOURCE.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    expected = json.load(handle)["lumiere_contracts"]
with open(sys.argv[2], encoding="utf-8") as handle:
    actual = json.load(handle)
for field in ("repository", "revision", "version"):
    if actual.get(field) != expected.get(field):
        raise SystemExit(f"vendored contracts {field} does not match release manifest")
PY

rm -rf "$TARGET"
mv "$TEMP" "$TARGET"
trap - EXIT

# Build scripts consume generated bindings from this conventional location.
# Populate it from the same verified release.
mkdir -p "$ROOT/.contracts-staging/bindings"
rm -rf "$ROOT/.contracts-staging/bindings"/*
cp -R "$TARGET/crates/lumiere-contracts/src/bindings/." "$ROOT/.contracts-staging/bindings/"
