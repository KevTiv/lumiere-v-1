#!/bin/sh
set -eu

mode="${LUMIERE_IDENTITY_MODE:-bootstrap}"
if [ "${LUMIERE_IDENTITY_APPLY:-0}" = "1" ]; then
  exec node /app/scripts/bootstrap-production-identities.mjs --apply --mode "$mode"
fi

exec node /app/scripts/bootstrap-production-identities.mjs --mode "$mode"
