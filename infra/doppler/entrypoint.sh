#!/bin/sh
set -eu

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  if [ "${DOPPLER_REQUIRED:-0}" = "1" ]; then
    echo "lumiere-with-secrets: DOPPLER_TOKEN is required" >&2
    exit 1
  fi
  exec "$@"
fi

# Doppler injects the service-scoped config into this process only. Secret
# values never pass through arguments, files, or shell interpolation.
exec /usr/local/bin/doppler run -- "$@"
