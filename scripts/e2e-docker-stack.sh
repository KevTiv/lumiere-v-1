#!/usr/bin/env bash
# Retarget the OrbStack dev stack's api-server and web at the e2e module and wait
# until both serve it. Called by `make e2e-smoke-setup E2E_DOCKER=1`.
# Requires E2E_STDB_TOKEN, STDB_CREDENTIAL_ENCRYPTION_KEY, E2E_STDB_MODULE in the env.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${E2E_STDB_TOKEN:?}" "${STDB_CREDENTIAL_ENCRYPTION_KEY:?}" "${E2E_STDB_MODULE:?}"
[ -f .env.docker ] || { echo "[e2e-docker] Missing .env.docker (make init-stack)" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "[e2e-docker] Docker/OrbStack is not running" >&2; exit 1; }
E2E_PG_DATABASE="${E2E_PG_DATABASE:-lumiere_e2e}"
export E2E_STDB_TOKEN STDB_CREDENTIAL_ENCRYPTION_KEY E2E_STDB_MODULE E2E_PG_DATABASE

compose=(docker compose --env-file .env.docker -f docker-compose.dev.yml -f docker-compose.e2e.yml)

wait_for() { # url attempts container
  local i
  for i in $(seq 1 "$2"); do
    curl -fsS "$1" >/dev/null 2>&1 && return 0
    sleep 5
  done
  echo "[e2e-docker] $1 not ready; see: docker logs $3" >&2
  return 1
}

# Dedicated Postgres database so the dev database's migration history is never
# touched. E2E_CLEAR_DB=1 recreates it (FORCE drops the previous api-server's
# connections); otherwise it is created only when missing.
psql_admin() { "${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -Atq' ; }
if [ "${E2E_CLEAR_DB:-0}" = "1" ]; then
  echo "SELECT 'DROP DATABASE IF EXISTS \"${E2E_PG_DATABASE}\" WITH (FORCE)'" | psql_admin | psql_admin
fi
if [ -z "$(echo "SELECT 1 FROM pg_database WHERE datname = '${E2E_PG_DATABASE}'" | psql_admin)" ]; then
  echo "[e2e-docker] Creating PostgreSQL database ${E2E_PG_DATABASE}..."
  echo "CREATE DATABASE \"${E2E_PG_DATABASE}\"" | psql_admin
fi

echo "[e2e-docker] Recreating api-server on module ${E2E_STDB_MODULE}..."
# Not ready until PostgreSQL is migrated, so wait on liveness first, and start
# web only afterwards (its depends_on waits for a healthy api-server).
"${compose[@]}" up -d --force-recreate --no-deps api-server
wait_for http://127.0.0.1:8082/health 180 lumiere-dev-api-server-1
echo "[e2e-docker] Applying checksum-verified PostgreSQL migrations in the container..."
"${compose[@]}" exec -T api-server cargo run --locked -p api-server --bin storage-migrate
wait_for http://127.0.0.1:8082/health/ready 60 lumiere-dev-api-server-1
echo "[e2e-docker] Recreating web (production build)..."
"${compose[@]}" up -d --force-recreate --no-deps web
# Web has a production build to finish (next build) before it listens.
wait_for http://127.0.0.1:3001 240 lumiere-dev-web-1
echo "[e2e-docker] Stack ready."
