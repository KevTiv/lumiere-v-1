#!/usr/bin/env bash
# ACC-RI-018: every retained double assertion must have a reviewed local rationale.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_ROOT="${1:-$ROOT/frontend/web/app/(modules)/accounting}"
MARKER='ACC-RI-018 rationale:'
violations=0
count=0

if [ ! -d "$TARGET_ROOT" ]; then
  echo "Accounting source directory does not exist: $TARGET_ROOT" >&2
  exit 1
fi

# Feature extractions must retain the same review boundary as the controller.
# Other existing Accounting pages retain their separately reviewed debt scope.
source_files() {
  printf '%s\0' "$TARGET_ROOT/accounting-client.tsx"
  if [ -d "$TARGET_ROOT/features" ]; then
    rg --files --null "$TARGET_ROOT/features" -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx'
  fi
}

while IFS= read -r -d '' TARGET; do
  if [ ! -f "$TARGET" ]; then
    echo "Accounting controller does not exist: $TARGET" >&2
    exit 1
  fi
  while IFS=: read -r line _; do
    [ -z "$line" ] && continue
    count=$((count + 1))
    start=$((line > 2 ? line - 2 : 1))
    if ! sed -n "${start},${line}p" "$TARGET" | grep -F "$MARKER" >/dev/null 2>&1; then
      echo "Unrationalized as-unknown-as cast at ${TARGET#$ROOT/}:$line"
      sed -n "${start},${line}p" "$TARGET" | sed 's/^/  /'
      violations=1
    fi
  done < <(rg -nF "as unknown as" "$TARGET" || true)
done < <(source_files)

if [ "$violations" -ne 0 ]; then
  echo ""
  echo "Remove the cast or add an adjacent '$MARKER' comment."
  exit 1
fi

echo "lint-accounting-as-unknown-as: ok ($count rationalized casts)"
