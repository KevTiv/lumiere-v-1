/** Shared audit log formatting helpers (settings panel + record sheet tab). */

export function auditTimestampToIso(raw: unknown): string {
  if (raw == null || raw === "") return new Date(0).toISOString()
  if (typeof raw === "object" && raw !== null) {
    const micros =
      (raw as { microsSinceUnixEpoch?: unknown }).microsSinceUnixEpoch ??
      (raw as { micros_since_unix_epoch?: unknown }).micros_since_unix_epoch
    if (micros != null) {
      const numeric = Number(micros)
      if (Number.isFinite(numeric)) {
        const date = new Date(numeric / 1000)
        if (!Number.isNaN(date.getTime())) return date.toISOString()
      }
    }
  }
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return new Date(0).toISOString()
  const ms = numeric > 10_000_000_000 ? numeric / 1000 : numeric
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

export function formatAuditEntryDetails(row: Record<string, unknown>): string {
  const changed = row.changedFields ?? row.changed_fields
  const newValues = row.newValues ?? row.new_values
  if (Array.isArray(changed) && changed.length > 0) {
    return changed.map((field) => String(field)).join(", ")
  }
  if (typeof newValues === "string" && newValues.trim()) {
    return newValues.length > 120 ? `${newValues.slice(0, 117)}…` : newValues
  }
  return ""
}

export function auditRecordIdFromRow(row: Record<string, unknown>): string {
  const id = row.recordId ?? row.record_id
  return id != null ? String(id) : ""
}

export function auditTableNameFromRow(row: Record<string, unknown>): string {
  return String(row.tableName ?? row.table_name ?? "")
}

export function auditActionFromRow(row: Record<string, unknown>): string {
  return String(row.action ?? "")
}
