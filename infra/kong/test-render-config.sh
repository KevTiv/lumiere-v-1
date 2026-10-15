#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

render() {
  KONG_DECLARATIVE_TEMPLATE="$root/infra/kong/kong.yml" \
  KONG_DECLARATIVE_CONFIG="$tmp/kong.yml" \
  CORS_ORIGIN=https://erp.example.test \
    sh "$root/infra/kong/render-config.sh" --render-only
}

render

assert_contains() {
  expected="$1"
  if ! grep -Fq -- "$expected" "$tmp/kong.yml"; then
    echo "render-kong-config test: missing $expected" >&2
    exit 1
  fi
}

assert_contains 'url: http://web.railway.internal:3000'
assert_contains 'url: http://api-server.railway.internal:8080/v1/query'
assert_contains 'url: http://api-server.railway.internal:8080/v1/operations'
assert_contains 'url: http://api-server.railway.internal:8080/v1/compat/reducer'
assert_contains '- /api/operations'
assert_contains '- /api/compat/reducer'
assert_contains 'policy: local'
assert_contains "- /health/ready"
assert_contains "body: '{\"status\":\"ok\",\"service\":\"api-gateway\"}'"

if grep -Eq '__[A-Z0-9_]+__' "$tmp/kong.yml"; then
  echo 'render-kong-config test: unresolved placeholder' >&2
  exit 1
fi

if grep -Eq 'policy: redis|^[[:space:]]+redis:' "$tmp/kong.yml"; then
  echo 'render-kong-config test: Redis rate limiting remains enabled' >&2
  exit 1
fi

if WEB_UPSTREAM_HOST='web.railway.internal;bad' \
  KONG_DECLARATIVE_TEMPLATE="$root/infra/kong/kong.yml" \
  KONG_DECLARATIVE_CONFIG="$tmp/invalid.yml" \
    sh "$root/infra/kong/render-config.sh" --render-only 2>/dev/null; then
  echo 'render-kong-config test: unsafe host was accepted' >&2
  exit 1
fi

echo 'render-kong-config test: ok'
