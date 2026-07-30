#!/usr/bin/env bash
# ACC-RI-018: every retained double assertion must have a reviewed local rationale.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/frontend/web/app/(modules)/accounting/accounting-client.tsx"
MARKER='ACC-RI-018 rationale:'
violations=0
count=0

while IFS=: read -r line _; do
  [ -z "$line" ] && continue
  count=$((count + 1))
  start=$((line > 2 ? line - 2 : 1))
  if ! sed -n "${start},${line}p" "$TARGET" | grep -F "$MARKER" >/dev/null 2>&1; then
    echo "Unrationalized as-unknown-as cast at ${TARGET#$ROOT/}:$line"
    sed -n "${start},${line}p" "$TARGET" | sed 's/^/  /'
    violations=1
  fi
done < <(grep -nF "as unknown as" "$TARGET" || true)

if [ "$violations" -ne 0 ]; then
  echo ""
  echo "Remove the cast or add an adjacent '$MARKER' comment."
  exit 1
fi

echo "lint-accounting-as-unknown-as: ok ($count rationalized casts)"
