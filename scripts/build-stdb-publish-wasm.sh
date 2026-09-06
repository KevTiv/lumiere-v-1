#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE_DIR="${1:-$ROOT/spacetimedb}"
OUTPUT="${2:-$MODULE_DIR/target/wasm32-unknown-unknown/release/lumiere_v1.publish.wasm}"
BUILT="$MODULE_DIR/target/wasm32-unknown-unknown/release/lumiere_v1.wasm"
MAX_BYTES="${STDB_MAX_PUBLISH_WASM_BYTES:-32505856}"

command -v spacetime >/dev/null || { echo "spacetime CLI is required" >&2; exit 1; }
command -v wasm-tools >/dev/null || { echo "wasm-tools is required" >&2; exit 1; }

if [[ "${STDB_SKIP_WASM_BUILD:-0}" != "1" ]]; then
  spacetime build --module-path "$MODULE_DIR"
fi

if [[ ! -s "$BUILT" ]]; then
  echo "missing built module $BUILT" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
# `spacetime build` owns the publishable artifact. Its `.opt.wasm` sibling is an
# internal optimizer intermediate and is not guaranteed to retain the module
# encoding Maincloud expects, even when a generic WebAssembly validator accepts it.
cp "$BUILT" "$OUTPUT"
wasm-tools validate "$OUTPUT"

size="$(wc -c <"$OUTPUT" | tr -d ' ')"
if (( size > MAX_BYTES )); then
  echo "publishable WASM is $size bytes; limit is $MAX_BYTES" >&2
  exit 1
fi

echo "publishable WASM: $OUTPUT ($size bytes; limit $MAX_BYTES)"
