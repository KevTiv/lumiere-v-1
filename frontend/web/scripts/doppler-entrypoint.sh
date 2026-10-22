#!/bin/sh
set -eu

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  if [ "${DOPPLER_REQUIRED:-0}" = "1" ]; then
    echo "lumiere-with-secrets: DOPPLER_TOKEN is required" >&2
    exit 1
  fi
  exec "$@"
fi

exec /usr/local/bin/doppler run -- "$@"
