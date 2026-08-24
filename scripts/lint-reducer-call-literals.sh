#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if rg -n --glob '*.rs' --glob '!target/**' '\.call_reducer\(\s*"[a-z0-9_]+"' .; then
  echo "literal reducer names must use stdb_client::reducer_call! so reducer renames fail compilation" >&2
  exit 1
fi

echo "lint-reducer-call-literals: ok"
