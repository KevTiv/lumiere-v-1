#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTES="$ROOT/api-server/src/routes"
failed=0

fail() {
  echo "lint-trusted-route-boundaries: $1" >&2
  failed=1
}

if rg -n '\.call_reducer\(|ReducerCall::from_name\(' "$ROUTES" --glob '*.rs'; then
  fail "route modules must dispatch reducers through trusted command helpers"
fi

while IFS= read -r file; do
  case "${file#$ROOT/}" in
    api-server/src/routes/admin.rs|api-server/src/routes/operations.rs|api-server/src/routes/queries.rs)
      ;;
    *)
      fail "raw session-token client construction is forbidden in ${file#$ROOT/}"
      ;;
  esac
done < <(rg -l 'client_with_token\(&session\.stdb_token\)' "$ROUTES" --glob '*.rs' || true)

while IFS= read -r file; do
  case "${file#$ROOT/}" in
    api-server/src/routes/admin.rs|api-server/src/routes/health.rs|api-server/src/routes/operations.rs|api-server/src/routes/queries.rs)
      ;;
    *)
      fail "token-bearing STDB client construction is forbidden in ${file#$ROOT/}"
      ;;
  esac
done < <(rg -l 'client_with_token\(' "$ROUTES" --glob '*.rs' || true)

if rg -n 'stdb_token:\s*&str' "$ROUTES" --glob '*.rs'; then
  fail "route helpers must receive trusted context rather than raw STDB tokens"
fi

while IFS= read -r file; do
  case "${file#$ROOT/}" in
    api-server/src/routes/admin.rs|api-server/src/routes/health.rs)
      ;;
    *)
      if ! rg -q 'TrustedOperationContext' "$file"; then
        fail "handwritten SQL lacks trusted read authority in ${file#$ROOT/}"
      fi
      ;;
  esac
done < <(rg -l '\.query_sql\(' "$ROUTES" --glob '*.rs' || true)

if rg -n 'get\("stdb_identity"\)' "$ROUTES/auth/invitations.rs"; then
  fail "invitation authorization must not trust the identity cookie directly"
fi

if (( failed != 0 )); then
  exit 1
fi

echo "lint-trusted-route-boundaries: ok"
