#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${CONTRACTS_SCHEMA_OUT:-$ROOT/.contracts-staging/module-schema.json}"
MODULE_NAME="${STDB_MODULE:-lumiere-v1-j1uo0}"
SERVER="${STDB_SCHEMA_SERVER:-maincloud}"
HOST="${STDB_SCHEMA_HOST:-https://maincloud.spacetimedb.com}"
SCHEMA_VERSION="${STDB_SCHEMA_VERSION:-9}"

mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp "${OUT}.tmp.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

CLI_SCHEMA=0
if command -v spacetime >/dev/null 2>&1 && [[ "${SCHEMA_SNAPSHOT_HTTP_ONLY:-0}" != "1" ]]; then
  if spacetime describe "$MODULE_NAME" --json -s "$SERVER" >"$TMP" && \
    python3 - "$TMP" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    schema = json.load(handle)
raise SystemExit(0 if all(key in schema for key in ("reducers", "tables", "types", "typespace")) else 1)
PY
  then
    CLI_SCHEMA=1
  else
    echo "schema-snapshot: CLI schema shape is incompatible; using HTTP RawModuleDef" >&2
  fi
fi

if [[ "$CLI_SCHEMA" != "1" ]]; then
  curl --fail --silent --show-error \
    "$HOST/v1/database/$MODULE_NAME/schema?version=$SCHEMA_VERSION" >"$TMP"
fi

python3 - "$TMP" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    schema = json.load(handle)

for key in ("reducers", "tables", "types", "typespace"):
    if key not in schema:
        raise SystemExit(f"schema-snapshot: response is missing {key!r}")
PY

mv "$TMP" "$OUT"
trap - EXIT
echo "schema-snapshot: wrote $OUT"
