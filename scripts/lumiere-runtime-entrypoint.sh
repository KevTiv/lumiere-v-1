#!/usr/bin/env sh
set -eu

binary="${LUMIERE_BIN:-${BIN:-}}"

case "$binary" in
  api-server|gateway|owner-report-worker|projection-worker|storage-migrate|workflow-worker)
    ;;
  "")
    echo "LUMIERE_BIN is required" >&2
    exit 64
    ;;
  *)
    echo "unsupported LUMIERE_BIN: $binary" >&2
    exit 64
    ;;
esac

exec "/usr/local/bin/$binary" "$@"
