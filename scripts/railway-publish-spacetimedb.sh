#!/usr/bin/env bash
set -euo pipefail

: "${STDB_HOST:?STDB_HOST is required}"
: "${STDB_MODULE:?STDB_MODULE is required}"
: "${STDB_SERVER_TOKEN:?STDB_SERVER_TOKEN is required}"

config_dir="${HOME:-/root}/.config/spacetime"
config_file="${config_dir}/cli.toml"
mkdir -p "${config_dir}"
chmod 0700 "${config_dir}"
umask 077
printf 'spacetimedb_token = "%s"\n' "${STDB_SERVER_TOKEN}" > "${config_file}"

schema_file="$(mktemp)"
cleanup() {
  rm -f -- "${config_file}" "${schema_file}"
}
trap cleanup EXIT

spacetime publish "${STDB_MODULE}" \
  --bin-path /app/spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm \
  --server "${STDB_HOST}" \
  --delete-data=never \
  -y

spacetime describe "${STDB_MODULE}" \
  --server "${STDB_HOST}" \
  --json > "${schema_file}"

test -s "${schema_file}"
jq -e '
  def canonical_table_name:
    if type == "string" then .
    elif type == "object" then
      (.name // .table_name // .tableName // .table.name? // empty)
      | if type == "object" then (.name // .value // empty) else . end
    else empty
    end;
  type == "object"
  and has("reducers")
  and has("tables")
  and has("types")
  and has("typespace")
  and (
    if (.tables | type) == "array" then
      any(.tables[]; canonical_table_name == "organization")
    elif (.tables | type) == "object" then
      (.tables | has("organization"))
      or any(.tables[]; canonical_table_name == "organization")
    else false
    end
  )
' "${schema_file}" >/dev/null

rm -f -- "${config_file}" "${schema_file}"
echo "SpacetimeDB publish and schema verification passed for ${STDB_MODULE}"
