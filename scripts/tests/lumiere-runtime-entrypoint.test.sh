#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ENTRYPOINT="$ROOT/scripts/lumiere-runtime-entrypoint.sh"
readonly TEST_BIN_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_BIN_DIR"' EXIT

for binary in \
  api-server expense-integration-worker gateway hr-integration-worker owner-report-worker \
  projection-worker project-integration-worker storage-migrate workflow-worker; do
  sed "s/__BINARY__/$binary/" >"$TEST_BIN_DIR/$binary" <<'SCRIPT'
#!/usr/bin/env sh
printf '%s\n' '__BINARY__'
printf '%s\n' "$@"
SCRIPT
  chmod +x "$TEST_BIN_DIR/$binary"
done

# Exercise the same fixed-path dispatch logic without writing to /usr/local/bin.
sed "s#/usr/local/bin/#$TEST_BIN_DIR/#g" "$ENTRYPOINT" >"$TEST_BIN_DIR/entrypoint"
chmod +x "$TEST_BIN_DIR/entrypoint"

for binary in \
  api-server expense-integration-worker gateway hr-integration-worker owner-report-worker \
  projection-worker project-integration-worker storage-migrate workflow-worker; do
  output="$(LUMIERE_BIN="$binary" "$TEST_BIN_DIR/entrypoint" first second)"
  [[ "$output" == "$binary"$'\nfirst\nsecond' ]]
done

output="$(BIN=gateway "$TEST_BIN_DIR/entrypoint")"
[[ "$output" == "gateway" ]]

output="$(LUMIERE_BIN=api-server BIN=gateway "$TEST_BIN_DIR/entrypoint")"
[[ "$output" == "api-server" ]]

if LUMIERE_BIN=../../bin/sh "$TEST_BIN_DIR/entrypoint" 2>/dev/null; then
  echo "entrypoint accepted an arbitrary executable" >&2
  exit 1
fi

if "$TEST_BIN_DIR/entrypoint" 2>/dev/null; then
  echo "entrypoint accepted a missing binary selector" >&2
  exit 1
fi
