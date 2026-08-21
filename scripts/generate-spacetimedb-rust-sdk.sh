#!/usr/bin/env bash
# Generate Rust bindings while narrowly recovering from SpacetimeDB's known
# formatter failure for schema fields whose names are Rust keywords.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/.contracts-staging/bindings}"
MODULE_DIR="${2:-$ROOT/spacetimedb}"
SPACETIME_BIN="${SPACETIME_BIN:-spacetime}"
LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/lumiere-stdb-rust-generate.XXXXXX.log")"
trap 'rm -f "$LOG_FILE"' EXIT

mkdir -p "$OUT_DIR"

set +e
"$SPACETIME_BIN" generate \
  --include-private \
  --lang rust \
  --out-dir "$OUT_DIR" \
  --module-path "$MODULE_DIR" 2>&1 | tee "$LOG_FILE"
generate_status="${PIPESTATUS[0]}"
set -e

if [[ "$generate_status" -ne 0 ]]; then
  if ! grep -q 'Could not format generated files' "$LOG_FILE"; then
    echo "SpacetimeDB Rust generation failed before its formatter step" >&2
    exit "$generate_status"
  fi

  unexpected_errors="$({ grep '^error:' "$LOG_FILE" || true; } | \
    grep -Ev '^error: expected identifier, found keyword `[^`]+`$' || true)"
  if [[ -n "$unexpected_errors" ]]; then
    echo "SpacetimeDB Rust generation had unexpected errors:" >&2
    printf '%s\n' "$unexpected_errors" >&2
    exit "$generate_status"
  fi

  echo "Recovering from SpacetimeDB's Rust-keyword formatter failure" >&2
fi

bash "$ROOT/scripts/fix-spacetimedb-rust-sdk-bindings.sh" "$OUT_DIR"

# The CLI's formatter ran before the keyword repair. Run it again to both
# normalize and parse-check every repaired output file.
find "$OUT_DIR" -name '*.rs' -print0 | xargs -0 rustfmt --edition 2021

if [[ ! -s "$OUT_DIR/mod.rs" ]]; then
  echo "SpacetimeDB Rust generation did not produce $OUT_DIR/mod.rs" >&2
  exit 1
fi

echo "Generated and validated Rust bindings in $OUT_DIR"
