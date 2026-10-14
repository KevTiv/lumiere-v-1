#!/usr/bin/env bash
set -euo pipefail

: "${STDB_HOST:?STDB_HOST is required}"
: "${STDB_MODULE:?STDB_MODULE is required}"
: "${STDB_SERVER_TOKEN:?STDB_SERVER_TOKEN is required}"

config_dir="/root/.config/spacetime"
config_file="${config_dir}/cli.toml"
mkdir -p "${config_dir}"
chmod 0700 "${config_dir}"
umask 077
printf 'spacetimedb_token = "%s"\n' "${STDB_SERVER_TOKEN}" > "${config_file}"

spacetime publish "${STDB_MODULE}" \
  --bin-path /app/spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm \
  --server "${STDB_HOST}" \
  -y

rm -f -- "${config_file}"
echo "SpacetimeDB module ${STDB_MODULE} published successfully"
exec sleep infinity
