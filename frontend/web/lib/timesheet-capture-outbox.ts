/**
 * Online-first timesheet capture outbox (Wave E).
 * Queues log/timer payloads with `client_request_id` when the create call fails
 * (brief offline / flaky net); flush retries `log_timesheet` idempotently.
 * Mirrors `expense-capture-outbox.ts`.
 */

export type TimesheetCapturePayload = {
  projectId: string
  taskId: string
  employeeId: string
  date: string
  unitAmount: number
  name?: string
  description?: string
  timesheetInvoiceType?: string
  currencyId?: string
}

export type TimesheetCaptureSyncState = "queued" | "synced" | "error" | "conflict"

export interface TimesheetCaptureOutboxItem {
  clientRequestId: string
  deviceId: string
  payload: TimesheetCapturePayload
  createdAt: string
  syncState: TimesheetCaptureSyncState
  lastError?: string
}

function storageKey(organizationId: string | number, deviceId: string): string {
  return `lumiere.timesheet-capture-outbox.${organizationId}.${deviceId}`
}

export function getOrCreateTimesheetCaptureDeviceId(): string {
  if (typeof window === "undefined") return "server"
  const key = "lumiere.timesheet-capture-device-id"
  let id = window.localStorage.getItem(key)
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}`
    window.localStorage.setItem(key, id)
  }
  return id
}

export function newTimesheetClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ts-cap-${crypto.randomUUID()}`
  }
  return `ts-cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function readTimesheetCaptureOutbox(
  organizationId: string | number,
  deviceId: string,
): TimesheetCaptureOutboxItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId, deviceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as TimesheetCaptureOutboxItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeTimesheetCaptureOutbox(
  organizationId: string | number,
  deviceId: string,
  items: TimesheetCaptureOutboxItem[],
): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(storageKey(organizationId, deviceId), JSON.stringify(items))
}

export function enqueueTimesheetCapture(
  organizationId: string | number,
  item: Omit<TimesheetCaptureOutboxItem, "createdAt" | "syncState">,
): TimesheetCaptureOutboxItem {
  const items = readTimesheetCaptureOutbox(organizationId, item.deviceId)
  const existing = items.find((i) => i.clientRequestId === item.clientRequestId)
  if (existing) return existing
  const row: TimesheetCaptureOutboxItem = {
    ...item,
    createdAt: new Date().toISOString(),
    syncState: "queued",
  }
  items.push(row)
  writeTimesheetCaptureOutbox(organizationId, item.deviceId, items)
  return row
}

export function markTimesheetCaptureSynced(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
): void {
  const items = readTimesheetCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? { ...i, syncState: "synced" as const, lastError: undefined }
      : i,
  )
  writeTimesheetCaptureOutbox(organizationId, deviceId, items)
}

export function markTimesheetCaptureError(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
  lastError: string,
): void {
  const conflict =
    /already exists|idempotenc|conflict|duplicate client_request/i.test(lastError)
  const items = readTimesheetCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? {
          ...i,
          syncState: (conflict ? "conflict" : "error") as TimesheetCaptureSyncState,
          lastError,
        }
      : i,
  )
  writeTimesheetCaptureOutbox(organizationId, deviceId, items)
}

export function requeueTimesheetCapture(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
): void {
  const items = readTimesheetCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? { ...i, syncState: "queued" as const, lastError: undefined }
      : i,
  )
  writeTimesheetCaptureOutbox(organizationId, deviceId, items)
}

export function discardTimesheetCapture(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
): void {
  const items = readTimesheetCaptureOutbox(organizationId, deviceId).filter(
    (i) => i.clientRequestId !== clientRequestId,
  )
  writeTimesheetCaptureOutbox(organizationId, deviceId, items)
}

export function listQueuedTimesheetCaptures(
  organizationId: string | number,
  deviceId: string,
): TimesheetCaptureOutboxItem[] {
  return readTimesheetCaptureOutbox(organizationId, deviceId).filter(
    (i) =>
      i.syncState === "queued" ||
      i.syncState === "error" ||
      i.syncState === "conflict",
  )
}
