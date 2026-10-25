#!/usr/bin/env bash
set -euo pipefail

: "${STDB_HOST:?STDB_HOST is required}"
: "${STDB_MODULE:?STDB_MODULE is required}"
: "${STDB_SERVER_TOKEN:?STDB_SERVER_TOKEN is required}"

umask 077
config_file="$(mktemp)"
schema_file="$(mktemp)"
printf 'spacetimedb_token = "%s"\n' "${STDB_SERVER_TOKEN}" > "${config_file}"
cleanup() {
  rm -f -- "${config_file}" "${schema_file}"
}
trap cleanup EXIT

spacetime --config-path "${config_file}" publish "${STDB_MODULE}" \
  --bin-path "${STDB_WASM_PATH:-/app/spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm}" \
  --server "${STDB_HOST}" \
  --delete-data=never \
  --yes=remote,migrate,break-clients,skip-login --no-config

spacetime --config-path "${config_file}" describe \
  --server "${STDB_HOST}" \
  --json --no-config "${STDB_MODULE}" > "${schema_file}"

test -s "${schema_file}"
jq -e '
  def canonical_table_name:
    if type == "string" then .
    elif type == "object" then
      (.source_name // .name // .table_name // .tableName // .table.name? // empty)
      | if type == "object" then (.name // .value // empty) else . end
    else empty
    end;
  # CLI 2.8 returns RawModuleDefV10 sections; older schemas use direct fields.
  if type == "object" and (.sections | type) == "array" then
    reduce .sections[] as $section ({}; . + $section)
    | {reducers: .Reducers, tables: .Tables, types: .Types, typespace: .Typespace}
  else . end
  | type == "object"
  and (.reducers | type) == "array"
  and (.types | type) == "array"
  and (.typespace | type) == "object"
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
