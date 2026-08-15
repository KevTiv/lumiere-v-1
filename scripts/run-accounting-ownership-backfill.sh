#!/usr/bin/env bash
# Run the idempotent ACC-RI-001 backfill and its fail-closed completion gate.
# Usage: ./scripts/run-accounting-ownership-backfill.sh [module-name] [server]
set -euo pipefail

MODULE="${1:-${STDB_CLOUD_MODULE:-lumiere-v1-j1uo0}}"
SERVER="${2:-maincloud}"

echo "[accounting-backfill] module=$MODULE server=$SERVER"
spacetime call "$MODULE" run_accounting_ownership_backfill --server "$SERVER"
spacetime call "$MODULE" validate_accounting_ownership_backfill --server "$SERVER"

echo "[accounting-backfill] persisted run evidence"
spacetime sql "$MODULE" \
  "SELECT scope, scanned_rows, backfilled_rows, unresolved_rows, completed_at FROM accounting_ownership_backfill_run" \
  --server "$SERVER" --yes

echo "[accounting-backfill] unresolved issue evidence (must be empty)"
spacetime sql "$MODULE" \
  "SELECT table_name, record_id, company_id, parent_id, issue FROM accounting_ownership_backfill_issue" \
  --server "$SERVER" --yes
