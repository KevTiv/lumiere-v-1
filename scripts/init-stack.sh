#!/usr/bin/env bash
# Bootstrap the local OrbStack stack without putting a token or development
# secret in version control. The local owner token is created by the host CLI,
# then used by the containers through .env.docker.
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

sed \
  -e "s|^STDB_SERVER_TOKEN=.*|STDB_SERVER_TOKEN=$token|" \
  -e "s|^STDB_TOKEN=.*|STDB_TOKEN=$token|" \
  "$env_file" >"$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$env_file"

echo "[init-stack] Complete. Start the full stack with: make docker-dev"
