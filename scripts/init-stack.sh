#!/usr/bin/env bash
# Bootstrap the local OrbStack stack without putting tokens or a development
# secret in version control. The local owner token is created by the host CLI,
# and separate worker identities are minted by the local server. They are
# passed to their intended containers through .env.docker.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$root/.env.docker"
compose=(docker compose --env-file "$env_file" -f "$root/docker-compose.dev.yml")
module_name="${STDB_MODULE:-lumiere-v1}"
force=false

usage() {
  echo "Usage: make init-stack [STDB_MODULE=local-module-name]"
  echo "       bash scripts/init-stack.sh [--force] [module-name]"
}

for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    -h|--help) usage; exit 0 ;;
    -*) usage >&2; exit 2 ;;
    *) module_name="$arg" ;;
  esac
done

if [[ -e "$env_file" && "$force" != true ]]; then
  echo "$env_file already exists; keeping its credentials." >&2
  echo "Use 'bash scripts/init-stack.sh --force $module_name' to replace it." >&2
  exit 1
fi

if ! command -v openssl >/dev/null; then
  echo "openssl is required to generate LUMIERE_AI_GATEWAY_INTERNAL_SECRET" >&2
  exit 1
fi

secret="$(openssl rand -hex 32)"
temp_file="$(mktemp "${env_file}.XXXXXX")"
trap 'rm -f "$temp_file"' EXIT

sed \
  -e "s|^STDB_MODULE=.*|STDB_MODULE=$module_name|" \
  -e 's|^STDB_SERVER_TOKEN=.*|STDB_SERVER_TOKEN=replace-with-local-owner-token|' \
  -e 's|^STDB_TOKEN=.*|STDB_TOKEN=replace-with-local-owner-token|' \
  -e "s|^LUMIERE_AI_GATEWAY_INTERNAL_SECRET=.*|LUMIERE_AI_GATEWAY_INTERNAL_SECRET=$secret|" \
  "$root/.env.docker.example" >"$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$env_file"

echo "[init-stack] Starting local SpacetimeDB..."
"${compose[@]}" up -d spacetimedb

echo "[init-stack] Waiting for SpacetimeDB..."
for _ in $(seq 1 30); do
  if curl -fsS -X POST http://127.0.0.1:3000/v1/identity >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS -X POST http://127.0.0.1:3000/v1/identity >/dev/null 2>&1; then
  echo "SpacetimeDB did not become ready; inspect: docker compose -f docker-compose.dev.yml logs spacetimedb" >&2
  exit 1
fi

echo "[init-stack] Registering a local SpacetimeDB identity..."
spacetime login --server-issued-login local --no-browser

echo "[init-stack] Publishing module '$module_name' (the first Rust/WASM build can take a while)..."
spacetime publish "$module_name" --module-path "$root/spacetimedb" --server local -y

echo "[init-stack] Reading and validating the local owner token..."
token="$(STDB_MODULE="$module_name" E2E_STDB_HOST=http://127.0.0.1:3000 node "$root/scripts/e2e-local-stdb-token.mjs")"
if [[ -z "$token" ]]; then
  echo "Could not obtain a local SpacetimeDB owner token" >&2
  exit 1
fi

echo "[init-stack] Minting a distinct local finalization-worker identity..."
mint_worker_token() {
  local worker_identity_json
  worker_identity_json="$(curl -fsS -X POST http://127.0.0.1:3000/v1/identity)"
  WORKER_IDENTITY_JSON="$worker_identity_json" node -e '
  const payload = JSON.parse(process.env.WORKER_IDENTITY_JSON ?? "{}");
  if (typeof payload.token !== "string" || payload.token.length === 0) process.exit(1);
  process.stdout.write(payload.token);
'
}

worker_token="$(mint_worker_token)"
owner_report_worker_token="$(mint_worker_token)"
workflow_worker_token="$(mint_worker_token)"
expense_worker_token="$(mint_worker_token)"
hr_worker_token="$(mint_worker_token)"
project_worker_token="$(mint_worker_token)"
worker_tokens=(
  "$worker_token"
  "$owner_report_worker_token"
  "$workflow_worker_token"
  "$expense_worker_token"
  "$hr_worker_token"
  "$project_worker_token"
)
for worker_candidate in "${worker_tokens[@]}"; do
  if [[ -z "$worker_candidate" || "$worker_candidate" == "$token" ]]; then
    echo "Could not obtain distinct local worker tokens" >&2
    exit 1
  fi
done
if [[ "$(printf '%s\n' "${worker_tokens[@]}" | sort -u | wc -l | tr -d ' ')" != "${#worker_tokens[@]}" ]]; then
  echo "Could not obtain distinct local worker tokens" >&2
  exit 1
fi

sed \
  -e "s|^STDB_SERVER_TOKEN=.*|STDB_SERVER_TOKEN=$token|" \
  -e "s|^STDB_FINALIZATION_TOKEN=.*|STDB_FINALIZATION_TOKEN=$worker_token|" \
  -e "s|^STDB_OWNER_REPORT_WORKER_TOKEN=.*|STDB_OWNER_REPORT_WORKER_TOKEN=$owner_report_worker_token|" \
  -e "s|^STDB_WORKFLOW_WORKER_TOKEN=.*|STDB_WORKFLOW_WORKER_TOKEN=$workflow_worker_token|" \
  -e "s|^STDB_EXPENSE_WORKER_TOKEN=.*|STDB_EXPENSE_WORKER_TOKEN=$expense_worker_token|" \
  -e "s|^STDB_HR_WORKER_TOKEN=.*|STDB_HR_WORKER_TOKEN=$hr_worker_token|" \
  -e "s|^STDB_PROJECT_WORKER_TOKEN=.*|STDB_PROJECT_WORKER_TOKEN=$project_worker_token|" \
  -e "s|^STDB_TOKEN=.*|STDB_TOKEN=$token|" \
  "$env_file" >"$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$env_file"

echo "[init-stack] Complete. Register each worker identity for the organizations it processes, then start the full stack with: make docker-dev"
