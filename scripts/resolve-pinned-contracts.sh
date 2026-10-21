#!/usr/bin/env bash
# Print the root of the checksum-verified lumiere-contracts release.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/vendor/lumiere-contracts"

if [ ! -f "$CONTRACTS/CONTRACT_VERSION" ]; then
  "$ROOT/scripts/prepare-vendored-contracts-rust.sh" >&2
fi

printf '%s\n' "$CONTRACTS"
