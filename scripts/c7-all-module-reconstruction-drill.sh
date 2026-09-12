#!/usr/bin/env bash
# Compose the seeded-source snapshot and real reconstruction drill, then prove
# all-module and deletion/idempotency coverage on the disposable target.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required=(C7_COVERAGE_BIN C7_RECONSTRUCTION_BIN C7_SOURCE_STDB_MODULE \
  C7_SOURCE_STDB_TOKEN C7_SOURCE_STDB_IDENTITY C7_DISPOSABLE_STDB \
  STDB_HOST STDB_MODULE STDB_RECONSTRUCTION_TOKEN STDB_RECONSTRUCTION_READ_TOKEN \
  STDB_RECONSTRUCTION_IDENTITY \
  LUMIERE_PLACEMENT_CONTROL_PATH RECONSTRUCTION_EXPECTED_PLACEMENT_GENERATION \
  RECONSTRUCTION_EXPECTED_CELL_ID RECONSTRUCTION_EXPECTED_DURABLE_STORE_ID \
  RECONSTRUCTION_RUN_ID)
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

pinned_root="$(bash "$root/scripts/resolve-pinned-contracts.sh" 2>/dev/null || true)"
pinned_manifest="${pinned_root:+$pinned_root/manifests/reconstruction-manifest.json}"
if [[ -z "$pinned_manifest" || ! -f "$pinned_manifest" ]]; then
  echo "[c7-all-modules] pinned reconstruction manifest is required; resolve the pinned contracts dependency first" >&2
  exit 2
fi
manifest_path="${C7_RECONSTRUCTION_MANIFEST:-$pinned_manifest}"
if [[ ! -f "$manifest_path" ]]; then
  echo "[c7-all-modules] reconstruction manifest is required: $manifest_path" >&2
  exit 2
fi
if ! cmp -s "$manifest_path" "$pinned_manifest"; then
  echo "[c7-all-modules] supplied reconstruction manifest differs from the pinned contracts manifest; refusing staging/binary drift" >&2
  exit 2
fi
staging_manifest="$root/.contracts-staging/manifests/reconstruction-manifest.json"
if [[ -f "$staging_manifest" ]] && ! cmp -s "$staging_manifest" "$pinned_manifest"; then
  echo "[c7-all-modules] .contracts-staging reconstruction manifest differs from the pinned contracts manifest; publish and pin before running" >&2
  exit 2
fi
expected_modules="$(jq -r '[.tables[].module] | unique | length' "$manifest_path")"
expected_restore_tables="$(jq -r '.tables | length' "$manifest_path")"
if [[ ! "$expected_modules" =~ ^[1-9][0-9]*$ || ! "$expected_restore_tables" =~ ^[1-9][0-9]*$ ]]; then
  echo "[c7-all-modules] reconstruction manifest has invalid module/table census" >&2
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
  .organization_id == ($organization_id | tonumber) and
  .watermark.sequence > 0 and
  (.watermark.commit_checksum | length) == 64 and
  .source_rows > 0 and
  .relationship_values > 0 and
  .total_values > 0 and
  .audit_rows > 0 and
  .durable_idempotency_records > 0
' --arg organization_id "$organization_id" "$coverage_report" >/dev/null
jq -e --argjson expected_modules "$expected_modules" '
  (.modules | length) == $expected_modules and
  (.module_row_counts | length) == $expected_modules
' "$coverage_report" >/dev/null || {
  echo "[c7-all-modules] coverage module census does not match reconstruction manifest" >&2
  exit 1
}

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

jq -e --argjson expected_restore_tables "$expected_restore_tables" \
  '.verified == true and .restored_tables == $expected_restore_tables' \
  "$resume_report" "$repeat_report" >/dev/null
jq -e --slurpfile coverage "$coverage_report" '
  .organization_id == $coverage[0].organization_id and
  .watermark == $coverage[0].watermark
' "$resume_report" "$repeat_report" >/dev/null

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
stdb_server="${C7_STDB_SERVER:-$STDB_HOST}"
if [[ ! "$stdb_server" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$ ]]; then
  echo "[c7-all-modules] C7_STDB_SERVER/STDB_HOST must target loopback" >&2
  exit 2
fi

deleted_rows="$("${spacetime_cli[@]}" sql --no-config --server "$stdb_server" --format json \
  "$STDB_MODULE" \
  "SELECT id FROM \"$deleted_table\" WHERE organization_id = $organization_id AND id = $deleted_id")"
delete_history="$("${spacetime_cli[@]}" sql --no-config --server "$stdb_server" --format json \
  "$STDB_MODULE" \
  "SELECT id FROM organization_row_change WHERE organization_id = $organization_id AND table_name = '$deleted_table' AND change_kind = 'delete'")"
receipts="$("${spacetime_cli[@]}" sql --no-config --server "$stdb_server" --format json \
  "$STDB_MODULE" \
  "SELECT receipt_key FROM organization_reconstruction_batch_receipt WHERE organization_id = $organization_id")"
if [[ "$(jq '[.[].rows[]] | length' <<<"$deleted_rows")" != "0" ]] \
  || [[ "$(jq '[.[].rows[]] | length' <<<"$delete_history")" -lt 1 ]] \
  || [[ "$(jq '[.[].rows[]] | length' <<<"$receipts")" -lt 1 ]]; then
  echo "[c7-all-modules] target delete/idempotency verification failed" >&2
  exit 1
fi

echo "[c7-all-modules] passed; evidence=$evidence_dir"
