#!/usr/bin/env bash
# Compose the seeded-source snapshot and real reconstruction drill, then prove
# all-module and deletion/idempotency coverage on the disposable target.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required=(C7_COVERAGE_BIN C7_RECONSTRUCTION_BIN C7_SOURCE_STDB_MODULE \
  C7_SOURCE_STDB_TOKEN C7_SOURCE_STDB_IDENTITY C7_DISPOSABLE_STDB \
  STDB_HOST STDB_MODULE STDB_RECONSTRUCTION_TOKEN STDB_RECONSTRUCTION_READ_TOKEN \
  STDB_RECONSTRUCTION_IDENTITY \
  RECONSTRUCTION_PLACEMENT_GENERATION RECONSTRUCTION_CELL_ID \
  RECONSTRUCTION_DURABLE_STORE_ID RECONSTRUCTION_RUN_ID)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[c7-all-modules] $name is required; refusing to run" >&2
    exit 2
  fi
done
if [[ "${C7_COVERAGE_SNAPSHOT:-}" != "1" ]]; then
  echo "[c7-all-modules] C7_COVERAGE_SNAPSHOT=1 is required" >&2
  exit 2
fi

organization_id="${1:-}"
if [[ ! "${organization_id}" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: scripts/c7-all-module-reconstruction-drill.sh <organization-id>" >&2
  exit 2
fi

evidence_dir="${C7_EVIDENCE_DIR:-${TMPDIR:-/tmp}/lumiere-c7-evidence}"
mkdir -p "$evidence_dir"
coverage_report="${C7_COVERAGE_REPORT:-$evidence_dir/coverage.json}"
resume_report="$evidence_dir/resume.json"
repeat_report="$evidence_dir/repeat.json"

cd "$root"
if [[ "${C7_REUSE_COVERAGE:-0}" == "1" ]]; then
  if [[ ! -f "$coverage_report" ]]; then
    echo "[c7-all-modules] reusable coverage report is missing: $coverage_report" >&2
    exit 2
  fi
else
  "${C7_COVERAGE_BIN}" "$organization_id" | tee "$coverage_report"
fi
jq -e '
  (.modules | length) == 22 and
  (.module_row_counts | length) == 22 and
  .source_rows > 0 and
  .relationship_values > 0 and
  .total_values > 0 and
  .audit_rows > 0 and
  .durable_idempotency_records > 0
' "$coverage_report" >/dev/null

if [[ "${C7_REUSE_RECONSTRUCTION:-0}" == "1" ]]; then
  if [[ ! -f "$resume_report" || ! -f "$repeat_report" ]]; then
    echo "[c7-all-modules] reusable reconstruction reports are missing" >&2
    exit 2
  fi
else
  C7_RESUME_REPORT="$resume_report" \
  C7_REPEAT_REPORT="$repeat_report" \
    bash scripts/c7-reconstruction-drill.sh "$organization_id"
fi

jq -e '.verified == true and .restored_tables == 458' \
  "$resume_report" "$repeat_report" >/dev/null

deleted_table="$(jq -r '.deleted_table' "$coverage_report")"
if [[ "$deleted_table" != "activity" && "$deleted_table" != "audit_rule" ]]; then
  echo "[c7-all-modules] unsafe delete-proof table in coverage report" >&2
  exit 1
fi
deleted_id="$(jq -r '.deleted_identity | to_entries[0].value' "$coverage_report")"
if [[ ! "$deleted_id" =~ ^[0-9]+$ ]]; then
  echo "[c7-all-modules] delete-proof identity must be numeric" >&2
  exit 1
fi

spacetime_cli=(spacetime)
if [[ -n "${C7_STDB_CLI_CONFIG:-}" ]]; then
  spacetime_cli+=(--config-path "$C7_STDB_CLI_CONFIG")
fi

deleted_rows="$("${spacetime_cli[@]}" sql --no-config --server local --format json \
  "$STDB_MODULE" \
  "SELECT id FROM \"$deleted_table\" WHERE organization_id = $organization_id AND id = $deleted_id")"
delete_history="$("${spacetime_cli[@]}" sql --no-config --server local --format json \
  "$STDB_MODULE" \
  "SELECT id FROM organization_row_change WHERE organization_id = $organization_id AND table_name = '$deleted_table' AND change_kind = 'delete'")"
receipts="$("${spacetime_cli[@]}" sql --no-config --server local --format json \
  "$STDB_MODULE" \
  "SELECT receipt_key FROM organization_reconstruction_batch_receipt WHERE organization_id = $organization_id")"
if [[ "$(jq '[.[].rows[]] | length' <<<"$deleted_rows")" != "0" ]] \
  || [[ "$(jq '[.[].rows[]] | length' <<<"$delete_history")" -lt 1 ]] \
  || [[ "$(jq '[.[].rows[]] | length' <<<"$receipts")" -lt 1 ]]; then
  echo "[c7-all-modules] target delete/idempotency verification failed" >&2
  exit 1
fi

echo "[c7-all-modules] passed; evidence=$evidence_dir"
