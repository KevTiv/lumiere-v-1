import { recordPageHref } from '@/lib/record-page-href'

type Row = Record<string, unknown>

/** Lowercase hex of an identity cell (hex string, `{ __identity__ }`, or an object with toHexString/toHex). */
export function identityKey(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const v = value as { __identity__?: unknown; toHexString?: () => string; toHex?: () => unknown; some?: unknown }
    if ('some' in v) return identityKey(v.some)
    if (v.__identity__ !== undefined) return identityKey(v.__identity__)
    if (typeof v.toHexString === 'function') return v.toHexString().toLowerCase()
    if (typeof v.toHex === 'function') return String(v.toHex()).toLowerCase()
    return ''
  }
  return String(value).trim().toLowerCase().replace(/^0x/, '')
}

/** Milliseconds since epoch of a deadline cell (micros number/bigint, `{ microsSinceUnixEpoch }`, ISO string); null when unset. */
export function deadlineMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'object') {
    if ('some' in value) return deadlineMs((value as { some: unknown }).some)
    if ('microsSinceUnixEpoch' in value) return deadlineMs((value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch)
    return null
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isNaN(Number(value))) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  const micros = Number(value)
  return Number.isFinite(micros) && micros > 0 ? micros / 1000 : null
}

function isDone(row: Row): boolean {
  return row.isDone === true || String(row.state ?? '').toLowerCase() === 'done'
}

/**
 * The signed-in user's open activities: assigned to them, or unassigned and created by them
 * (the backend sets `userId` to the creator and `assignedTo` to the assignee). Done and deleted
 * rows are left out; sorted by deadline, undated last.
 */
export function myOpenActivities(rows: ReadonlyArray<Row>, identity: string | null | undefined): Row[] {
  const me = identityKey(identity)
  if (!me) return []
  return rows
    .filter((row) => {
      if (isDone(row) || deadlineIsDeleted(row)) return false
      const assignee = identityKey(row.assignedTo ?? row.assigned_to)
      return assignee ? assignee === me : identityKey(row.userId ?? row.user_id) === me
    })
    .sort((a, b) => {
      const da = deadlineMs(a.dateDeadline ?? a.date_deadline)
      const db = deadlineMs(b.dateDeadline ?? b.date_deadline)
      if (da == null && db == null) return Number(a.id ?? 0) - Number(b.id ?? 0)
      if (da == null) return 1
      if (db == null) return -1
      return da - db || Number(a.id ?? 0) - Number(b.id ?? 0)
    })
}

function deadlineIsDeleted(row: Row): boolean {
  return deadlineMs(row.deletedAt ?? row.deleted_at) != null
}

/** True when the activity has a deadline earlier than `nowMs`. */
export function isOverdue(row: Row, nowMs: number): boolean {
  const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
  return due != null && due < nowMs
}

/** Page of the record the activity is filed on, when that model has one. */
export function activityTargetHref(row: Row): string | undefined {
  return recordPageHref(row.resModel ?? row.res_model, row.resId ?? row.res_id)
}
