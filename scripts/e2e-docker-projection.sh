#!/usr/bin/env bash
# Durable-projection proof for `make e2e-docker`.
#   start   register service identities on the e2e module, start projection-worker on it
#   settle  re-register (orgs created by the tests), then require every organization to
#           reach its SpacetimeDB head with no error and no quarantine
# Requires E2E_STDB_TOKEN and E2E_STDB_MODULE in the environment.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${E2E_STDB_TOKEN:?}" "${E2E_STDB_MODULE:?}"
E2E_PG_DATABASE="${E2E_PG_DATABASE:-lumiere_e2e}"
export E2E_STDB_TOKEN E2E_STDB_MODULE E2E_PG_DATABASE
compose=(docker compose --env-file .env.docker -f docker-compose.dev.yml -f docker-compose.e2e.yml)

pg() { "${compose[@]}" exec -T postgres psql -U lumiere -d "$E2E_PG_DATABASE" -Atc "$1"; }

register() {
  # The registration script reads one env file; point it at the e2e module and
  # token without touching .env.docker. Never printed, removed immediately.
  local tmp
  tmp="$(mktemp .tmp/e2e/identities.XXXXXX)"
  trap 'rm -f "$tmp"' RETURN
  chmod 600 "$tmp"
  grep -vE '^(STDB_MODULE|STDB_SERVER_TOKEN)=' .env.docker > "$tmp"
  printf 'STDB_MODULE=%s\nSTDB_SERVER_TOKEN=%s\n' "$E2E_STDB_MODULE" "$E2E_STDB_TOKEN" >> "$tmp"
  node scripts/register-local-service-identities.mjs "$tmp"
}

case "${1:-}" in
  start)
    register
    echo "[e2e-docker] Starting projection-worker on ${E2E_STDB_MODULE} -> ${E2E_PG_DATABASE}..."
    "${compose[@]}" up -d --force-recreate --no-deps projection-worker
    ;;
  settle)
    register
    echo "[e2e-docker] Waiting for the projection to reach every organization's head..."
    for _ in $(seq 1 60); do
      # rows, behind, errored, quarantined
      read -r rows behind errored quarantined <<<"$(pg "select count(*), count(*) filter (where durable_sequence < stdb_head_sequence), count(*) filter (where last_error is not null), count(*) filter (where quarantined_sequence is not null) from organization_projection_status" | tr '|' ' ')"
      if [ "$rows" -gt 0 ] && [ "$behind" = 0 ] && [ "$errored" = 0 ] && [ "$quarantined" = 0 ]; then
        echo "[e2e-docker] Projection converged: ${rows} organization(s) at head, no error, no quarantine."
        pg "select organization_id, durable_sequence, stdb_head_sequence from organization_projection_status order by organization_id"
        exit 0
      fi
      sleep 5
    done
    echo "[e2e-docker] Projection did NOT converge (orgs=${rows:-0} behind=${behind:-?} errored=${errored:-?} quarantined=${quarantined:-?})." >&2
    pg "select organization_id, durable_sequence, stdb_head_sequence, backlog_commits, quarantined_sequence, left(last_error, 300) from organization_projection_status order by organization_id" >&2 || true
    exit 1
    ;;
  *) echo "usage: $0 start|settle" >&2; exit 2 ;;
esac
