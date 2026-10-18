#!/usr/bin/env bash
# Start the OrbStack dev stack in WorkOS mode on its own module and database
# (lumiere-v1-workos-e2e / lumiere_workos). Reads .env.workos.local (gitignored).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -f .env.workos.local ] || { echo "[workos-stack] missing .env.workos.local" >&2; exit 1; }
[ -f .env.docker ] || { echo "[workos-stack] missing .env.docker" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "[workos-stack] Docker/OrbStack is not running" >&2; exit 1; }
set -a; . ./.env.workos.local; set +a
: "${WORKOS_CLIENT_ID:?}" "${WORKOS_API_KEY:?}" "${WORKOS_USER_ID:?set WORKOS_USER_ID (the admitted test user)}" "${WORKOS_EMAIL:?}" "${WORKOS_ORGANIZATION_ID:?}"

mkdir -p .tmp/workos
if [ ! -f .tmp/workos/env.sh ]; then
  {
    printf 'export WORKOS_COOKIE_PASSWORD=%q\n' "$(openssl rand -hex 32)"
    printf 'export STDB_CREDENTIAL_ENCRYPTION_KEY=%q\n' "$(openssl rand -hex 32)"
  } > .tmp/workos/env.sh
fi
set -a; . .tmp/workos/env.sh; set +a

export WORKOS_ISSUER="https://api.workos.com/user_management/${WORKOS_CLIENT_ID}"
# The admission must match the email WorkOS holds for the user, which can differ
# from the sign-up email, so read it from the tenant rather than the env file.
EMAIL_LC="$(curl -fsS -m20 "https://api.workos.com/user_management/users/${WORKOS_USER_ID}" -H "Authorization: Bearer ${WORKOS_API_KEY}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["email"].strip().lower())')"
[ -n "$EMAIL_LC" ] || { echo "[workos-stack] could not read the WorkOS user email" >&2; exit 1; }
export LUMIERE_WORKOS_ALPHA_ADMISSIONS="[{\"user_id\":\"${WORKOS_USER_ID}\",\"email\":\"${EMAIL_LC}\",\"organization_id\":null,\"workos_organization_id\":\"${WORKOS_ORGANIZATION_ID}\",\"allow_provision\":true}]"

export E2E_STDB_MODULE="${E2E_STDB_MODULE:-lumiere-v1-workos-e2e}"
export E2E_PG_DATABASE="${E2E_PG_DATABASE:-lumiere_workos}"
E2E_STDB_HOST="${E2E_STDB_HOST:-http://127.0.0.1:3000}"

WASM=spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm
[ -f "$WASM" ] || { echo "[workos-stack] build the module first (make e2e-smoke-setup builds it)" >&2; exit 1; }
echo "[workos-stack] publishing $E2E_STDB_MODULE..."
spacetime publish "$E2E_STDB_MODULE" --bin-path "$WASM" --server local -y --no-config
E2E_STDB_HOST="$E2E_STDB_HOST" node scripts/e2e-local-stdb-token.mjs --login-only
E2E_STDB_TOKEN="$(E2E_STDB_HOST="$E2E_STDB_HOST" STDB_MODULE="$E2E_STDB_MODULE" node scripts/e2e-local-stdb-token.mjs)"
[ -n "$E2E_STDB_TOKEN" ] || { echo "[workos-stack] no owner token" >&2; exit 1; }
export E2E_STDB_TOKEN

compose=(docker compose --env-file .env.docker -f docker-compose.dev.yml -f docker-compose.e2e.yml -f docker-compose.workos.yml)
psql_admin() { "${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -Atq'; }
if [ -z "$(echo "SELECT 1 FROM pg_database WHERE datname = '${E2E_PG_DATABASE}'" | psql_admin)" ]; then
  echo "CREATE DATABASE \"${E2E_PG_DATABASE}\"" | psql_admin
fi

wait_for() { local i; for i in $(seq 1 "$2"); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 5; done; echo "[workos-stack] $1 not ready" >&2; return 1; }
"${compose[@]}" up -d --force-recreate --no-deps api-server
wait_for http://127.0.0.1:8082/health 180
"${compose[@]}" exec -T api-server cargo run --locked -p api-server --bin storage-migrate
wait_for http://127.0.0.1:8082/health/ready 60
if [ "${WORKOS_SKIP_WEB:-0}" != "1" ]; then
  "${compose[@]}" up -d --force-recreate --no-deps web
fi
wait_for http://127.0.0.1:3001 240
echo "[workos-stack] ready (WorkOS mode, module $E2E_STDB_MODULE, database $E2E_PG_DATABASE)."
