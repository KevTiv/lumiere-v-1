#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "lint-reducer-call-literals: ripgrep (rg) is required; scan was not run" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

scan_status=0
rg -n --glob '*.rs' --glob '!target/**' '\.call_reducer\(\s*"[a-z0-9_]+"' . || scan_status=$?
case "$scan_status" in
  0)
    echo "literal reducer names must use stdb_client::reducer_call! so reducer renames fail compilation" >&2
    exit 1
    ;;
  1) ;; # ripgrep's no-match result is the only successful empty scan.
  *)
    echo "lint-reducer-call-literals: scanner failed (status $scan_status); scan is unconfirmed" >&2
    exit "$scan_status"
    ;;
esac

echo "lint-reducer-call-literals: ok"
