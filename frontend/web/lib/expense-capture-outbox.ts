/**
 * Online-first expense capture outbox.
 * Queues captures with `client_request_id` when the create call fails (brief offline / flaky net);
 * flush retries `create_expense` idempotently.
 */

export type ExpenseCapturePayload = {
  employeeId: string
  name: string
  date: string
  unitAmount: number
  quantity: number
  currencyId: string
  description?: string
  hasReceipt: boolean
  lineKind: "Standard" | "Mileage" | "PerDiem"
  mileageDistance?: number
  mileageRateId?: string
  perDiemDays?: number
  perDiemRateId?: string
  projectId?: string
  paymentMode?: "OutOfPocket" | "CorporateCard"
  merchantKey?: string
}

export type ExpenseCaptureSyncState = "queued" | "synced" | "error" | "conflict"

export interface ExpenseCaptureOutboxItem {
  clientRequestId: string
  deviceId: string
  payload: ExpenseCapturePayload
  createdAt: string
  syncState: ExpenseCaptureSyncState
  lastError?: string
}

function storageKey(organizationId: string | number, deviceId: string): string {
  return `lumiere.expense-capture-outbox.${organizationId}.${deviceId}`
}

export function getOrCreateExpenseCaptureDeviceId(): string {
  if (typeof window === "undefined") return "server"
  const key = "lumiere.expense-capture-device-id"
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

export function newExpenseClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `exp-cap-${crypto.randomUUID()}`
  }
  return `exp-cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function readExpenseCaptureOutbox(
  organizationId: string | number,
  deviceId: string,
): ExpenseCaptureOutboxItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId, deviceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as ExpenseCaptureOutboxItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeExpenseCaptureOutbox(
  organizationId: string | number,
  deviceId: string,
  items: ExpenseCaptureOutboxItem[],
): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(storageKey(organizationId, deviceId), JSON.stringify(items))
}

export function enqueueExpenseCapture(
  organizationId: string | number,
  item: Omit<ExpenseCaptureOutboxItem, "createdAt" | "syncState">,
): ExpenseCaptureOutboxItem {
  const items = readExpenseCaptureOutbox(organizationId, item.deviceId)
  const existing = items.find((i) => i.clientRequestId === item.clientRequestId)
  if (existing) return existing
  const row: ExpenseCaptureOutboxItem = {
    ...item,
    createdAt: new Date().toISOString(),
    syncState: "queued",
  }
  items.push(row)
  writeExpenseCaptureOutbox(organizationId, item.deviceId, items)
  return row
}

export function markExpenseCaptureSynced(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
): void {
  const items = readExpenseCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? { ...i, syncState: "synced" as const, lastError: undefined }
      : i,
  )
  writeExpenseCaptureOutbox(organizationId, deviceId, items)
}

export function markExpenseCaptureError(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
  lastError: string,
): void {
  const conflict =
    /already exists|idempotenc|conflict|duplicate client_request/i.test(lastError)
  const items = readExpenseCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? {
          ...i,
          syncState: (conflict ? "conflict" : "error") as ExpenseCaptureSyncState,
          lastError,
        }
      : i,
  )
  writeExpenseCaptureOutbox(organizationId, deviceId, items)
}

export function requeueExpenseCapture(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
): void {
  const items = readExpenseCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? { ...i, syncState: "queued" as const, lastError: undefined }
      : i,
  )
  writeExpenseCaptureOutbox(organizationId, deviceId, items)
}

export function discardExpenseCapture(
  organizationId: string | number,
  deviceId: string,
  clientRequestId: string,
): void {
  const items = readExpenseCaptureOutbox(organizationId, deviceId).filter(
    (i) => i.clientRequestId !== clientRequestId,
  )
  writeExpenseCaptureOutbox(organizationId, deviceId, items)
}

export function listQueuedExpenseCaptures(
  organizationId: string | number,
  deviceId: string,
): ExpenseCaptureOutboxItem[] {
  return readExpenseCaptureOutbox(organizationId, deviceId).filter(
    (i) =>
      i.syncState === "queued" ||
      i.syncState === "error" ||
      i.syncState === "conflict",
  )
}
