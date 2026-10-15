#!/bin/sh
set -eu

port="${PORT:-3000}"
data_dir="${STDB_DATA_DIR:-/data}"
page_pool_max_size="${STDB_PAGE_POOL_MAX_SIZE:-1GiB}"
wasm_pool_size="${STDB_WASM_PROCEDURE_INSTANCE_POOL_SIZE:-1}"

case "$data_dir" in
  ''|*[!A-Za-z0-9_./-]*)
    echo "lumiere-spacetimedb: STDB_DATA_DIR has an invalid format" >&2
    exit 1
    ;;
esac
case "$port" in
  ''|*[!0-9]*)
    echo "lumiere-spacetimedb: PORT must be numeric" >&2
    exit 1
    ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "lumiere-spacetimedb: PORT is outside 1-65535" >&2
  exit 1
fi

case "$wasm_pool_size" in
  ''|*[!0-9]*)
    echo "lumiere-spacetimedb: STDB_WASM_PROCEDURE_INSTANCE_POOL_SIZE must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$wasm_pool_size" -lt 1 ]; then
  echo "lumiere-spacetimedb: STDB_WASM_PROCEDURE_INSTANCE_POOL_SIZE must be a positive integer" >&2
  exit 1
fi

case "$page_pool_max_size" in
  *[!0-9KMGTPkmgptIiBb]*)
    echo "lumiere-spacetimedb: STDB_PAGE_POOL_MAX_SIZE has an invalid format" >&2
    exit 1
    ;;
esac
if [ -z "$page_pool_max_size" ]; then
  echo "lumiere-spacetimedb: STDB_PAGE_POOL_MAX_SIZE is required" >&2
  exit 1
fi

mkdir -p "$data_dir/auth"
config_file="$data_dir/config.toml"
config_tmp="$(mktemp "$data_dir/config.toml.XXXXXX")"

if [ -f "$config_file" ]; then
  awk -v pool="$wasm_pool_size" '
    BEGIN { in_wasm = 0; saw_wasm = 0; wrote_pool = 0 }
    /^\[[^]]+\][[:space:]]*$/ {
      if (in_wasm && !wrote_pool) {
        print "procedure-instance-pool-size = " pool
        wrote_pool = 1
      }
      in_wasm = ($0 == "[wasm]")
      if (in_wasm) saw_wasm = 1
      print
      next
    }
    in_wasm && /^[[:space:]]*procedure-instance-pool-size[[:space:]]*=/ {
      if (!wrote_pool) {
        print "procedure-instance-pool-size = " pool
        wrote_pool = 1
      }
      next
    }
    { print }
    END {
      if (in_wasm && !wrote_pool) {
        print "procedure-instance-pool-size = " pool
      } else if (!saw_wasm) {
        print ""
        print "[wasm]"
        print "procedure-instance-pool-size = " pool
      }
    }
  ' "$config_file" > "$config_tmp"
else
  printf '[wasm]\nprocedure-instance-pool-size = %s\n' "$wasm_pool_size" > "$config_tmp"
fi
mv "$config_tmp" "$config_file"
chown -R 1000:1000 "$data_dir"

exec su -s /bin/sh spacetime -c "exec spacetime start \
  --listen-addr 0.0.0.0:${port} \
  --data-dir ${data_dir} \
  --page_pool_max_size ${page_pool_max_size} \
  --jwt-pub-key-path ${data_dir}/auth/id_ecdsa.pub \
  --jwt-priv-key-path ${data_dir}/auth/id_ecdsa \
  --non-interactive"
