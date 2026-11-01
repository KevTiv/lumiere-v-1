#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "lint-trusted-route-boundaries: ripgrep (rg) is required; scan was not run" >&2
  exit 2
fi

# Normalize only a confirmed no-match (1). All other scanner failures propagate
# through checked assignments, never a swallowed process-substitution status.
scan() {
  local status=0
  rg "$@" || status=$?
  if (( status > 1 )); then
    echo "lint-trusted-route-boundaries: scanner failed (status $status); scan is unconfirmed" >&2
    return "$status"
  fi
  return 0
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTES="$ROOT/api-server/src/routes"
failed=0

fail() {
  echo "lint-trusted-route-boundaries: $1" >&2
  failed=1
}

matches="$(scan -n '\.call_reducer\(|ReducerCall::from_name\(' "$ROUTES" --glob '*.rs')"
if [[ -n "$matches" ]]; then
  printf '%s\n' "$matches"
  fail "route modules must dispatch reducers through trusted command helpers"
fi

files="$(scan -l 'client_with_token\(&session\.stdb_token\)' "$ROUTES" --glob '*.rs')"
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  case "${file#$ROOT/}" in
    api-server/src/routes/admin.rs|api-server/src/routes/operations.rs|api-server/src/routes/queries.rs)
      ;;
    *)
      fail "raw session-token client construction is forbidden in ${file#$ROOT/}"
      ;;
  esac
done <<< "$files"

files="$(scan -l 'client_with_token\(' "$ROUTES" --glob '*.rs')"
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  case "${file#$ROOT/}" in
    api-server/src/routes/admin.rs|api-server/src/routes/health.rs|api-server/src/routes/operations.rs|api-server/src/routes/queries.rs)
      ;;
    *)
      fail "token-bearing STDB client construction is forbidden in ${file#$ROOT/}"
      ;;
  esac
done <<< "$files"

matches="$(scan -n 'stdb_token:\s*&str' "$ROUTES" --glob '*.rs')"
if [[ -n "$matches" ]]; then
  printf '%s\n' "$matches"
  fail "route helpers must receive trusted context rather than raw STDB tokens"
fi

files="$(scan -l '\.query_sql\(' "$ROUTES" --glob '*.rs')"
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  case "${file#$ROOT/}" in
    api-server/src/routes/admin.rs|api-server/src/routes/health.rs)
      ;;
    *)
      trusted_context="$(scan -l 'TrustedOperationContext' "$file")"
      if [[ -z "$trusted_context" ]]; then
        fail "handwritten SQL lacks trusted read authority in ${file#$ROOT/}"
      fi
      ;;
  esac
done <<< "$files"

matches="$(scan -n 'get\("stdb_identity"\)' "$ROUTES/auth/invitations.rs")"
if [[ -n "$matches" ]]; then
  printf '%s\n' "$matches"
  fail "invitation authorization must not trust the identity cookie directly"
fi

if (( failed != 0 )); then
  exit 1
fi

echo "lint-trusted-route-boundaries: ok"
