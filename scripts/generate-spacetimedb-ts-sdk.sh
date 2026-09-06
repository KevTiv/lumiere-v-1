#!/usr/bin/env bash
# Generate TypeScript bindings and narrowly annotate the two type expressions
# that exceed TypeScript's instantiation depth for Lumiere's large schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/.contracts-staging/ts/generated}"
MODULE_DIR="${2:-$ROOT/spacetimedb}"
SPACETIME_BIN="${SPACETIME_BIN:-spacetime}"
GENERATE_WASM="${STDB_GENERATE_WASM:-}"
INDEX="$OUT_DIR/index.ts"
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

# Bindings are a complete generated snapshot. Clean the exact output directory
# first so reducers removed from the module cannot survive as stale APIs and so
# the generator never pauses for an interactive deletion confirmation.
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
"$SPACETIME_BIN" generate \
  --include-private \
  --lang typescript \
  --out-dir "$OUT_DIR" \
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
