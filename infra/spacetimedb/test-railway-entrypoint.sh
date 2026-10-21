#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/bin" "$tmp/data"

cat > "$tmp/bin/chown" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$tmp/bin/su" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" > "${TEST_SU_ARGS:?}"
EOF
chmod +x "$tmp/bin/chown" "$tmp/bin/su"

PATH="$tmp/bin:$PATH" \
PORT=3100 \
STDB_DATA_DIR="$tmp/data" \
STDB_PAGE_POOL_MAX_SIZE=768MiB \
STDB_WASM_PROCEDURE_INSTANCE_POOL_SIZE=1 \
TEST_SU_ARGS="$tmp/su-args" \
  sh "$root/infra/spacetimedb/railway-entrypoint.sh"

grep -Fq 'procedure-instance-pool-size = 1' "$tmp/data/config.toml"
grep -Fq -- '--listen-addr 0.0.0.0:3100' "$tmp/su-args"
grep -Fq -- "--data-dir $tmp/data" "$tmp/su-args"
grep -Fq -- '--page_pool_max_size 768MiB' "$tmp/su-args"

cat > "$tmp/data/config.toml" <<'EOF'
[logs]
directives = "info"

[wasm]
procedure-instance-pool-size = 8
EOF

PATH="$tmp/bin:$PATH" \
STDB_DATA_DIR="$tmp/data" \
STDB_WASM_PROCEDURE_INSTANCE_POOL_SIZE=2 \
TEST_SU_ARGS="$tmp/su-args" \
  sh "$root/infra/spacetimedb/railway-entrypoint.sh"

test "$(grep -c '^\[wasm\]$' "$tmp/data/config.toml")" -eq 1
grep -Fq 'procedure-instance-pool-size = 2' "$tmp/data/config.toml"
if grep -Fq 'procedure-instance-pool-size = 8' "$tmp/data/config.toml"; then
  echo 'entrypoint test: stale WASM pool size remained' >&2
  exit 1
fi

echo 'SpacetimeDB Railway entrypoint test: ok'
