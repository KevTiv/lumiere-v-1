#!/usr/bin/env sh
set -eu

binary="${LUMIERE_BIN:-${BIN:-}}"

case "$binary" in
  api-server|expense-integration-worker|gateway|hr-integration-worker|owner-report-worker|projection-worker|project-integration-worker|storage-migrate|workflow-worker)
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
