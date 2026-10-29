#!/usr/bin/env bash
# Generate TypeScript bindings and narrowly annotate the two type expressions
# that exceed TypeScript's instantiation depth for Lumiere's large schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/.contracts-staging/ts/generated}"
MODULE_DIR="${2:-$ROOT/spacetimedb}"
SPACETIME_BIN="${SPACETIME_BIN:-spacetime}"
GENERATE_WASM="${STDB_GENERATE_WASM:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lumiere-stdb-ts-generate.XXXXXX")"
GENERATED_DIR="$TMP_ROOT/generated"
OPTION_METADATA_DIR="$TMP_ROOT/option-metadata"
INDEX="$GENERATED_DIR/index.ts"
trap 'rm -rf "$TMP_ROOT"' EXIT
BUILDER='export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}'
BUILDER_ANNOTATION="// @ts-expect-error -- generated module size exceeds TypeScript's instantiation depth"
REDUCERS='export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);'
REDUCERS_ANNOTATION="// @ts-ignore -- generated module size exceeds TypeScript's instantiation depth in consumers"

if [[ -z "$GENERATE_WASM" ]]; then
  "$SPACETIME_BIN" build --module-path "$MODULE_DIR"
  GENERATE_WASM="$MODULE_DIR/target/wasm32-unknown-unknown/release/lumiere_v1.wasm"
fi
if [[ ! -s "$GENERATE_WASM" ]]; then
  echo "SpacetimeDB generation source WASM is missing: $GENERATE_WASM" >&2
  exit 1
fi

# Validate a fresh snapshot before touching the existing bindings. Syncing the
# complete snapshot afterwards removes stale APIs while preserving unchanged
# build inputs and the previous snapshot if generation fails.
mkdir -p "$GENERATED_DIR"
"$SPACETIME_BIN" generate \
  --include-private \
  --lang typescript \
  --out-dir "$GENERATED_DIR" \
  --bin-path "$GENERATE_WASM"

if ! grep -Fqx "$BUILDER_ANNOTATION" "$INDEX"; then
  matches="$(grep -Fxc "$BUILDER" "$INDEX" || true)"
  if [[ "$matches" != "1" ]]; then
    echo "Expected exactly one generated DbConnectionBuilder declaration; found $matches" >&2
    exit 1
  fi
  perl -0pi -e 's{\Qexport class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}\E}{// \@ts-expect-error -- generated module size exceeds TypeScript\x27s instantiation depth\nexport class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}}' "$INDEX"
fi

if ! grep -Fqx "$REDUCERS_ANNOTATION" "$INDEX"; then
  matches="$(grep -Fxc "$REDUCERS" "$INDEX" || true)"
  if [[ "$matches" != "1" ]]; then
    echo "Expected exactly one generated reducers declaration; found $matches" >&2
    exit 1
  fi
  perl -0pi -e 's{\Qexport const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);\E}{// \@ts-ignore -- generated module size exceeds TypeScript\x27s instantiation depth in consumers\nexport const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);}' "$INDEX"
fi

# Keep the committed contract artifact byte-stable across CLI versions that
# disagree only about extra blank lines at end of file.
perl -0pi -e 's/\n+\z/\n/' "$INDEX"

# HTTP Option metadata is derived from the same complete generated snapshot.
# Parse it before publishing either bindings or metadata, so an unsupported
# generated type leaves both existing outputs intact.
python3 "$ROOT/scripts/generate-stdb-http-option-metadata.py" \
  --types "$GENERATED_DIR/types.ts" --out-dir "$OPTION_METADATA_DIR"

python3 "$ROOT/scripts/sync-directory.py" "$GENERATED_DIR" "$OUT_DIR"
# Metadata shares its destination with authored sources; copy only its two
# generated files rather than mirroring the entire src directory.
python3 - "$OPTION_METADATA_DIR" "$ROOT/frontend/packages/stdb/src" <<'PY'
import filecmp
from pathlib import Path
import shutil
import sys

source, destination = map(Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=True)
for item in source.iterdir():
    target = destination / item.name
    if not target.is_file() or not filecmp.cmp(item, target, shallow=False):
        shutil.copyfile(item, target)
PY

echo "Generated and validated TypeScript bindings in $OUT_DIR"
