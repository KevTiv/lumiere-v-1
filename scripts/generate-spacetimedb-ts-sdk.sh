#!/usr/bin/env bash
# Generate TypeScript bindings and narrowly annotate the two type expressions
# that exceed TypeScript's instantiation depth for Lumiere's large schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/.contracts-staging/ts/generated}"
MODULE_DIR="${2:-$ROOT/spacetimedb}"
SPACETIME_BIN="${SPACETIME_BIN:-spacetime}"
INDEX="$OUT_DIR/index.ts"
BUILDER='export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}'
BUILDER_ANNOTATION="// @ts-expect-error -- generated module size exceeds TypeScript's instantiation depth"
REDUCERS='export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);'
REDUCERS_ANNOTATION="// @ts-ignore -- generated module size exceeds TypeScript's instantiation depth in consumers"

mkdir -p "$OUT_DIR"
"$SPACETIME_BIN" generate \
  --include-private \
  --lang typescript \
  --out-dir "$OUT_DIR" \
  --module-path "$MODULE_DIR"

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
