#!/bin/sh
set -eu

# This database belongs only to this gateway. Never point it at the ERP database:
# decK owns its full route/plugin configuration, including deleting stale routes.
config="${1:?rendered gateway configuration is required}"
export KONG_DATABASE=postgres
unset KONG_DECLARATIVE_CONFIG

# Initializes a fresh Kong schema; already initialized databases are unchanged.
# Version upgrades still require the normal, explicitly planned Kong procedure.
kong migrations bootstrap

# Reconcile routes before accepting any public traffic. Admin is available only
# on loopback during this temporary process, then disabled by the entrypoint.
KONG_PROXY_LISTEN=off KONG_ADMIN_LISTEN=127.0.0.1:8001 \
  KONG_ADMIN_GUI_LISTEN=off KONG_STATUS_LISTEN=off kong start
cleanup() {
  kong stop >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
deck gateway sync "$config" --kong-addr http://127.0.0.1:8001
kong stop
trap - EXIT HUP INT TERM
