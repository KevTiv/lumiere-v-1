#!/usr/bin/env bash
# Export SpacetimeDB module metadata for backup/DR drills.
# Usage: ./scripts/backup-stdb.sh [module-name] [server]
#
# Optional tenant JSON export (superuser session required):
#   BACKUP_ORG_ID=1 BACKUP_SESSION_TOKEN=<stdb JWT> ./scripts/backup-stdb.sh
#
# See docs/PILOT_RUNBOOK.md §3 and docs/ENVIRONMENT.md § Backup and export.
set -euo pipefail

MODULE="${1:-${STDB_MODULE:-lumiere-v1-j1uo0}}"
SERVER="${2:-local}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BACKUP_DIR:-./.tmp/stdb-backups}"
E2E_STDB_DATA_DIR="${E2E_STDB_DATA_DIR:-${HOME}/.local/share/spacetime/data}"
API_URL="${LUMIERE_API_SERVER_URL:-http://127.0.0.1:8082}"
ORG_ID="${BACKUP_ORG_ID:-}"
SESSION_TOKEN="${BACKUP_SESSION_TOKEN:-}"

mkdir -p "$OUT_DIR"
PREFIX="${OUT_DIR}/${MODULE}-${STAMP}"
EXPORT_FILE=""
FS_BACKUP=""

echo "[backup] module=$MODULE server=$SERVER → $OUT_DIR"

spacetime logs "$MODULE" --server "$SERVER" > "${PREFIX}.logs.txt" 2>&1 || true

if [[ "$SERVER" == "local" && -d "$E2E_STDB_DATA_DIR" ]]; then
  FS_BACKUP="${PREFIX}.stdb-data.tar.gz"
  echo "[backup] archiving local data dir $E2E_STDB_DATA_DIR (stop spacetime first for a consistent copy)"
  tar -czf "$FS_BACKUP" -C "$(dirname "$E2E_STDB_DATA_DIR")" "$(basename "$E2E_STDB_DATA_DIR")" 2>/dev/null || {
    echo "[backup] warn: filesystem archive failed — is spacetime holding locks? Try: spacetime stop"
    FS_BACKUP=""
  }
fi

if [[ -n "$ORG_ID" && -n "$SESSION_TOKEN" ]]; then
  EXPORT_FILE="${PREFIX}.org-${ORG_ID}-export.json"
  echo "[backup] requesting tenant export org_id=$ORG_ID from $API_URL"
  HTTP_CODE="$(curl -sS -o "$EXPORT_FILE" -w '%{http_code}' \
    -X POST "${API_URL}/v1/admin/organizations/${ORG_ID}/export" \
    -H "Authorization: Bearer ${SESSION_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{}' || true)"
  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "[backup] warn: tenant export failed (HTTP ${HTTP_CODE:-unknown}) — check superuser token and api-server"
    rm -f "$EXPORT_FILE"
    EXPORT_FILE=""
  fi
elif [[ -n "$ORG_ID" || -n "$SESSION_TOKEN" ]]; then
  echo "[backup] skip tenant export: set both BACKUP_ORG_ID and BACKUP_SESSION_TOKEN"
fi

FS_BACKUP_JSON="null"
EXPORT_FILE_JSON="null"
[[ -n "$FS_BACKUP" ]] && FS_BACKUP_JSON="\"$FS_BACKUP\""
[[ -n "$EXPORT_FILE" ]] && EXPORT_FILE_JSON="\"$EXPORT_FILE\""

cat > "${PREFIX}.manifest.json" <<EOF
{
  "module": "$MODULE",
  "server": "$SERVER",
  "createdAt": "$STAMP",
  "artifacts": {
    "logs": "${PREFIX}.logs.txt",
    "filesystemArchive": $FS_BACKUP_JSON,
    "tenantExport": $EXPORT_FILE_JSON
  },
  "exportTables": [
    "company", "user_organization", "contact", "lead", "sale_order", "purchase_order",
    "account_account", "account_journal", "account_move", "account_payment",
    "product", "stock_picking", "stock_move"
  ],
  "notes": "SpacetimeDB has no native pg_dump-style backup. Maincloud: use dashboard + publish history; partial tenant JSON via POST /v1/admin/organizations/{id}/export (superuser). Local dev: copy E2E_STDB_DATA_DIR after spacetime stop. See docs/PILOT_RUNBOOK.md §3.4 and docs/ENVIRONMENT.md § Backup and export."
}
EOF

echo "[backup] wrote ${PREFIX}.manifest.json"
echo ""
echo "Next steps:"
echo "  1. Review manifest: ${PREFIX}.manifest.json"
echo "  2. Pilot DR: docs/PILOT_RUNBOOK.md §3.4 (export table list + limitations)"
echo "  3. Maincloud: https://spacetimedb.com/@<username>/${MODULE} — confirm hosted backup/RPO with SpacetimeDB"
if [[ "$SERVER" == "local" ]]; then
  echo "  4. Local full copy: spacetime stop && tar -czf backup.tgz -C $(dirname "$E2E_STDB_DATA_DIR") $(basename "$E2E_STDB_DATA_DIR")"
fi
if [[ -z "$EXPORT_FILE" ]]; then
  echo "  5. Tenant JSON export: BACKUP_ORG_ID=<id> BACKUP_SESSION_TOKEN=<superuser JWT> $0 $MODULE $SERVER"
fi
