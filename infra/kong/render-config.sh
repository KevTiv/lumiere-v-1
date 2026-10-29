#!/bin/sh
set -eu

template="${KONG_DECLARATIVE_TEMPLATE:-/kong/templates/kong.yml}"
config="${KONG_RENDERED_CONFIG:-${KONG_DECLARATIVE_CONFIG:-/kong/declarative/kong.yml}}"
web_host="${WEB_UPSTREAM_HOST:-web.railway.internal}"
web_port="${WEB_UPSTREAM_PORT:-3000}"
api_host="${API_SERVER_UPSTREAM_HOST:-api-server.railway.internal}"
api_port="${API_SERVER_UPSTREAM_PORT:-8080}"
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
validate_port "$web_port" WEB_UPSTREAM_PORT
validate_port "$api_port" API_SERVER_UPSTREAM_PORT

if ! printf '%s\n' "$cors_origin" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9._:-]*(/[^[:space:]]*)?$'; then
  echo "render-kong-config: invalid CORS_ORIGIN" >&2
  exit 1
fi

escape_single_quoted_yaml_for_sed() {
  printf '%s' "$1" | sed -e "s/'/''/g" -e 's/[\\&|]/\\&/g'
}

cors_origin_escaped="$(escape_single_quoted_yaml_for_sed "$cors_origin")"
sed \
  -e "s|__WEB_UPSTREAM_HOST__|$web_host|g" \
  -e "s|__WEB_UPSTREAM_PORT__|$web_port|g" \
  -e "s|__API_SERVER_UPSTREAM_HOST__|$api_host|g" \
  -e "s|__API_SERVER_UPSTREAM_PORT__|$api_port|g" \
  -e "s|__CORS_ORIGIN__|$cors_origin_escaped|g" \
  "$template" > "$config"

if [ "${1:-}" = "--render-only" ]; then
  exit 0
fi

# Railway private networking is IPv6. Keep a separate IPv4 listener for the
# public edge while accepting private service traffic on the same proxy port.
export KONG_PROXY_LISTEN="${KONG_PROXY_LISTEN:-0.0.0.0:${PORT:-8000}, [::]:${PORT:-8000} ipv6only=on}"

# Only the database preparation process gets a temporary loopback Admin API.
# The public process must never expose management listeners.
export KONG_ADMIN_LISTEN=off
export KONG_ADMIN_GUI_LISTEN=off
export KONG_STATUS_LISTEN=off
export KONG_ANONYMOUS_REPORTS=off
unset KONG_DECLARATIVE_CONFIG

if [ "${KONG_DATABASE:-postgres}" != postgres ]; then
  echo 'render-kong-config: PostgreSQL is required for cluster rate limits' >&2
  exit 1
fi
export KONG_DATABASE=postgres
: "${KONG_PG_HOST:?set KONG_PG_HOST to the dedicated Kong PostgreSQL service}"
: "${KONG_PG_PASSWORD:?set KONG_PG_PASSWORD}"

if [ "${LUMIERE_ENV:-}" = production ]; then
  : "${KONG_TRUSTED_IPS:?set the verified ingress proxy CIDRs; never trust every address}"
  KONG_TRUSTED_IPS="$(printf '%s' "$KONG_TRUSTED_IPS" | tr -d '[:space:]')"
  case ",$KONG_TRUSTED_IPS," in
    ,,|*,*/0,*|*,*/00,*)
      echo 'render-kong-config: refusing a globally trusted proxy range' >&2
      exit 1
      ;;
  esac
  export KONG_TRUSTED_IPS
  export KONG_REAL_IP_HEADER=X-Forwarded-For
  export KONG_REAL_IP_RECURSIVE=on
fi

/usr/local/bin/prepare-kong-database "$config"
exec /docker-entrypoint.sh "$@"
