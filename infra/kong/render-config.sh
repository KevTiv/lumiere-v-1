#!/bin/sh
set -eu

template="${KONG_DECLARATIVE_TEMPLATE:-/kong/templates/kong.yml}"
config="${KONG_DECLARATIVE_CONFIG:-/kong/declarative/kong.yml}"
web_host="${WEB_UPSTREAM_HOST:-web.railway.internal}"
web_port="${WEB_UPSTREAM_PORT:-3000}"
api_host="${API_SERVER_UPSTREAM_HOST:-api-server.railway.internal}"
api_port="${API_SERVER_UPSTREAM_PORT:-8080}"
redis_host="${REDIS_UPSTREAM_HOST:-redis.railway.internal}"
redis_port="${REDIS_UPSTREAM_PORT:-6379}"
redis_username="${REDIS_UPSTREAM_USERNAME:-}"
redis_password="${REDIS_UPSTREAM_PASSWORD:-}"
cors_origin="${CORS_ORIGIN:-http://localhost:8000}"

umask 077

validate_host() {
  value="$1"
  name="$2"
  case "$value" in
    ''|*[!A-Za-z0-9._-]*)
      echo "render-kong-config: invalid $name" >&2
      exit 1
      ;;
  esac
}

validate_port() {
  value="$1"
  name="$2"
  case "$value" in
    ''|*[!0-9]*)
      echo "render-kong-config: invalid $name" >&2
      exit 1
      ;;
  esac
  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    echo "render-kong-config: $name is outside 1-65535" >&2
    exit 1
  fi
}

validate_host "$web_host" WEB_UPSTREAM_HOST
validate_host "$api_host" API_SERVER_UPSTREAM_HOST
validate_host "$redis_host" REDIS_UPSTREAM_HOST
validate_port "$web_port" WEB_UPSTREAM_PORT
validate_port "$api_port" API_SERVER_UPSTREAM_PORT
validate_port "$redis_port" REDIS_UPSTREAM_PORT

case "$redis_username" in
  *[!A-Za-z0-9._-]*)
    echo "render-kong-config: invalid REDIS_UPSTREAM_USERNAME" >&2
    exit 1
    ;;
esac
if [ -n "$redis_password" ] && printf '%s' "$redis_password" | LC_ALL=C grep -q '[[:cntrl:]]'; then
  echo "render-kong-config: REDIS_UPSTREAM_PASSWORD contains control characters" >&2
  exit 1
fi

if ! printf '%s\n' "$cors_origin" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9._:-]*(/[^[:space:]]*)?$'; then
  echo "render-kong-config: invalid CORS_ORIGIN" >&2
  exit 1
fi

escape_single_quoted_yaml_for_sed() {
  printf '%s' "$1" | sed -e "s/'/''/g" -e 's/[\\&|]/\\&/g'
}

cors_origin_escaped="$(escape_single_quoted_yaml_for_sed "$cors_origin")"
redis_password_escaped="$(escape_single_quoted_yaml_for_sed "$redis_password")"
sed \
  -e "s|__WEB_UPSTREAM_HOST__|$web_host|g" \
  -e "s|__WEB_UPSTREAM_PORT__|$web_port|g" \
  -e "s|__API_SERVER_UPSTREAM_HOST__|$api_host|g" \
  -e "s|__API_SERVER_UPSTREAM_PORT__|$api_port|g" \
  -e "s|__REDIS_UPSTREAM_HOST__|$redis_host|g" \
  -e "s|__REDIS_UPSTREAM_PORT__|$redis_port|g" \
  -e "s|__REDIS_UPSTREAM_USERNAME__|$redis_username|g" \
  -e "s|__REDIS_UPSTREAM_PASSWORD__|$redis_password_escaped|g" \
  -e "s|__CORS_ORIGIN__|$cors_origin_escaped|g" \
  "$template" > "$config"

if [ "${1:-}" = "--render-only" ]; then
  exit 0
fi

# Railway private networking is IPv6. Keep a separate IPv4 listener for the
# public edge while accepting private service traffic on the same proxy port.
export KONG_PROXY_LISTEN="${KONG_PROXY_LISTEN:-0.0.0.0:${PORT:-8000}, [::]:${PORT:-8000} ipv6only=on}"

# The declarative gateway has no operational reason to expose an Admin API or
# Manager listener. Do not allow a stray Railway variable to turn either on.
export KONG_ADMIN_LISTEN=off
export KONG_ADMIN_GUI_LISTEN=off
exec /docker-entrypoint.sh "$@"
