/** Shared audit log formatting helpers (settings panel + record sheet tab). */

import { firstNonNullKey } from "@lumiere/erp-shared/row-values"
import { timestampToIso } from "@lumiere/erp-shared/timestamp-values"

export function auditTimestampToIso(raw: unknown): string {
  return timestampToIso(raw)
}

export function formatAuditEntryDetails(row: Record<string, unknown>): string {
  const changed = firstNonNullKey(row, "changedFields", "changed_fields")
  const newValues = firstNonNullKey(row, "newValues", "new_values")
  if (Array.isArray(changed) && changed.length > 0) {
    return changed.map((field) => String(field)).join(", ")
  }
  if (typeof newValues === "string" && newValues.trim()) {
    return newValues.length > 120 ? `${newValues.slice(0, 117)}…` : newValues
  }
  return ""
}

export function auditRecordIdFromRow(row: Record<string, unknown>): string {
  const id = firstNonNullKey(row, "recordId", "record_id")
  return id != null ? String(id) : ""
}

export function auditTableNameFromRow(row: Record<string, unknown>): string {
  return String(firstNonNullKey(row, "tableName", "table_name") ?? "")
}

export function auditActionFromRow(row: Record<string, unknown>): string {
  return String(firstNonNullKey(row, "action") ?? "")
}
