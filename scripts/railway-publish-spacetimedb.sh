#!/usr/bin/env bash
set -euo pipefail

: "${STDB_HOST:?STDB_HOST is required}"
: "${STDB_MODULE:?STDB_MODULE is required}"
: "${STDB_SERVER_TOKEN:?STDB_SERVER_TOKEN is required}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
catalog_file="${script_dir}/../spacetimedb/assets/ai-builtin-skills.json"

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

missing_builtin_skills() {
  spacetime --config-path "${config_file}" sql "${STDB_MODULE}" \
    'SELECT skill_key, is_system FROM ai_skill WHERE organization_id = 0' \
    --server "${STDB_HOST}" --format json -y --no-config |
    jq -er --slurpfile catalog "${catalog_file}" '
      ($catalog[0] | map(.skill_key)) as $keys
      | ([.. | objects | select(has("rows")) | .rows]
         | if length == 1 and (.[0] | type) == "array" then .[0]
           else error("expected one built-in AI catalog query result") end) as $rows
      | if ($keys | length == 0 or length != (unique | length))
        then error("invalid bundled AI skill keys")
        elif any($keys[]; . as $key | [$rows[] | select(.[0] == $key)]
            | length > 1 or any(.[]; .[1] != true))
        then error("built-in AI catalog contains an ambiguous or non-system entry")
        else ($keys - [$rows[] | .[0]]) | join(", ")
        end
    '
}

missing="$(missing_builtin_skills)"
if [[ -n "${missing}" ]]; then
  echo "Registering missing built-in AI skills: ${missing}"
  spacetime --config-path "${config_file}" call "${STDB_MODULE}" apply_global_migrations \
    --server "${STDB_HOST}" -y --no-config
  missing="$(missing_builtin_skills)"
  if [[ -n "${missing}" ]]; then
    echo "Built-in AI skills still missing after migration: ${missing}" >&2
    exit 1
  fi
fi

rm -f -- "${config_file}" "${schema_file}"
echo "SpacetimeDB publish and schema verification passed for ${STDB_MODULE}"
