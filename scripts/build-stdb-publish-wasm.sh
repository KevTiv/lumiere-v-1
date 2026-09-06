#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE_DIR="${1:-$ROOT/spacetimedb}"
OUTPUT="${2:-$MODULE_DIR/target/wasm32-unknown-unknown/release/lumiere_v1.publish.wasm}"
OPTIMIZED="$MODULE_DIR/target/wasm32-unknown-unknown/release/lumiere_v1.opt.wasm"
MAX_BYTES="${STDB_MAX_PUBLISH_WASM_BYTES:-32505856}"

command -v spacetime >/dev/null || { echo "spacetime CLI is required" >&2; exit 1; }
command -v wasm-tools >/dev/null || { echo "wasm-tools is required" >&2; exit 1; }

if [[ "${STDB_SKIP_WASM_BUILD:-0}" != "1" ]]; then
  spacetime build --module-path "$MODULE_DIR"
fi

if [[ ! -s "$OPTIMIZED" ]]; then
  echo "missing optimized module $OPTIMIZED" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
# Preserve component metadata while removing diagnostic names and producers.
# These custom sections are not used to execute or describe the STDB module.
wasm-tools strip --delete '^(name|producers)$' "$OPTIMIZED" -o "$OUTPUT"
wasm-tools validate "$OUTPUT"

size="$(wc -c <"$OUTPUT" | tr -d ' ')"
if (( size > MAX_BYTES )); then
  echo "publishable WASM is $size bytes; limit is $MAX_BYTES" >&2
  exit 1
fi

echo "publishable WASM: $OUTPUT ($size bytes; limit $MAX_BYTES)"
