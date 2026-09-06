#!/usr/bin/env bash
# Exercise committed-failure resume and fresh-run idempotency against a target
# that the operator has already wiped and republished for this drill.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required=(C7_DISPOSABLE_STDB STDB_HOST STDB_MODULE STDB_RECONSTRUCTION_TOKEN \
  STDB_RECONSTRUCTION_READ_TOKEN STDB_RECONSTRUCTION_IDENTITY \
  RECONSTRUCTION_PLACEMENT_GENERATION RECONSTRUCTION_CELL_ID \
  RECONSTRUCTION_DURABLE_STORE_ID RECONSTRUCTION_RUN_ID)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[c7-drill] $name is required; refusing to run" >&2
    exit 2
  fi
done

if [[ "${C7_DISPOSABLE_STDB}" != "1" ]]; then
  echo "[c7-drill] C7_DISPOSABLE_STDB=1 is required" >&2
  exit 2
fi
case "${STDB_HOST}" in
  http://127.0.0.1|http://127.0.0.1:*|http://localhost|http://localhost:*) ;;
  *) echo "[c7-drill] STDB_HOST must be loopback" >&2; exit 2 ;;
esac
if [[ "${STDB_MODULE}" != lumiere-c7-* ]]; then
  echo "[c7-drill] STDB_MODULE must use the disposable 'lumiere-c7-' prefix" >&2
  exit 2
fi

organization_id="${1:-}"
if [[ ! "${organization_id}" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: scripts/c7-reconstruction-drill.sh <organization-id>" >&2
  exit 2
fi

if [[ -n "${C7_RECONSTRUCTION_BIN:-}" ]]; then
  if [[ ! -x "${C7_RECONSTRUCTION_BIN}" ]]; then
    echo "[c7-drill] C7_RECONSTRUCTION_BIN must be an executable file" >&2
    exit 2
  fi
  reconstruction_command=("${C7_RECONSTRUCTION_BIN}")
else
  reconstruction_command=(cargo run -p api-server --bin reconstruct-organization --)
fi

failure_log="$(mktemp "${TMPDIR:-/tmp}/lumiere-c7-failure.XXXXXX.log")"
trap 'rm -f "$failure_log"' EXIT

cd "$root"
set +e
C7_INJECT_FAILURE_AFTER_BATCH=1 \
  "${reconstruction_command[@]}" "$organization_id" \
  2>&1 | tee "$failure_log"
failure_status="${PIPESTATUS[0]}"
set -e
if [[ "$failure_status" -eq 0 ]] || ! grep -Fq \
  "C7 injected failure after a committed reconstruction batch" "$failure_log"; then
  echo "[c7-drill] expected committed-batch failure was not observed" >&2
  exit 1
fi

# Resume the exact failed run, then prove a new run does not duplicate rows.
if [[ -n "${C7_RESUME_REPORT:-}" ]]; then
  "${reconstruction_command[@]}" "$organization_id" | tee "${C7_RESUME_REPORT}"
else
  "${reconstruction_command[@]}" "$organization_id"
fi
if [[ -n "${C7_REPEAT_REPORT:-}" ]]; then
  RECONSTRUCTION_RUN_ID="${RECONSTRUCTION_RUN_ID}-repeat" \
    "${reconstruction_command[@]}" "$organization_id" | tee "${C7_REPEAT_REPORT}"
else
  RECONSTRUCTION_RUN_ID="${RECONSTRUCTION_RUN_ID}-repeat" \
    "${reconstruction_command[@]}" "$organization_id"
fi
