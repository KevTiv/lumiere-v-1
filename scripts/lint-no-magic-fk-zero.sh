#!/usr/bin/env bash
# Fail if coverage/create-params/params-merge mappers use magic FK sentinels (`?? 0n` / `|| 0n`).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATTERN='(\?\?|\|\|)[[:space:]]*0n'

violations=0
count=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  count=$((count + 1))
  if grep -nE "$PATTERN" "$f" >/dev/null 2>&1; then
    echo "Magic FK sentinel in ${f#$ROOT/}:"
    grep -nE "$PATTERN" "$f" | sed 's/^/  /'
    violations=1
  fi
done < <(find \
  "$ROOT/frontend/web/lib" \
  "$ROOT/frontend/packages/erp-shared/src" \
  "$ROOT/frontend/packages/query-hooks/src/hooks" \
  \( -name '*coverage-create-params.ts' -o -name '*create-params.ts' -o -name '*params-merge.ts' \) \
  -type f 2>/dev/null | sort)

if [ "$violations" -ne 0 ]; then
  echo ""
  echo "Replace with fail-closed checks (return null / throw) — never default relation IDs to 0n."
  exit 1
fi

echo "lint-no-magic-fk-zero: ok ($count files scanned)"
