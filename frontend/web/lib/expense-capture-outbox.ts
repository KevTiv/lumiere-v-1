/**
 * Online-first expense capture outbox.
 * Stores metadata and verified upload checkpoints, with stable request identities.
 * File bytes stay in the capture tab. Interrupted expense dispatches require exact readback.
 */

import {
  getOrCreateLocalStorageDeviceId,
  readLocalStorageArray,
  writeLocalStorageArray,
} from "./local-outbox"

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

export type ExpenseCaptureSyncState =
  | "queued"
  | "submitting"
  | "unknown"
  | "rejected"
  | "synced"
  | "error"
  | "conflict"

export interface ExpenseCaptureReceipt {
  state: "queued" | "uploading" | "attached" | "failed"
  clientRequestId: string
  fileName: string
  mimeType: string
  fileSize: number
  lastModified: number
  uploaded?: {
    objectKey: string
    checksum: string
    fileName: string
    mimetype: string
    fileSize: string
  }
  receiptId?: string
  lastError?: string
}

export interface ExpenseCaptureOutboxItem {
  clientRequestId: string
  deviceId: string
  payload: ExpenseCapturePayload
  /** Captured scope is immutable; a company switch must not retarget an offline item. */
  companyId?: string
  receipt?: ExpenseCaptureReceipt
  expenseId?: string
  createdAt: string
  syncState: ExpenseCaptureSyncState
  lastError?: string
}

function storageKey(organizationId: string | number, deviceId: string): string {
  return `lumiere.expense-capture-outbox.${organizationId}.${deviceId}`
}

export function getOrCreateExpenseCaptureDeviceId(): string {
  return getOrCreateLocalStorageDeviceId("lumiere.expense-capture-device-id")
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
  return readLocalStorageArray<ExpenseCaptureOutboxItem>(
    storageKey(organizationId, deviceId),
  )
}

function writeExpenseCaptureOutbox(
  organizationId: string | number,
  deviceId: string,
  items: ExpenseCaptureOutboxItem[],
): void {
  writeLocalStorageArray(storageKey(organizationId, deviceId), items)
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
  const items = readExpenseCaptureOutbox(organizationId, deviceId).map((i) =>
    i.clientRequestId === clientRequestId
      ? {
          ...i,
          syncState:
            i.syncState === "submitting" || i.syncState === "unknown"
              ? ("unknown" as const)
              : ("error" as const),
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
    i.clientRequestId === clientRequestId &&
    i.syncState !== "submitting" &&
    i.syncState !== "unknown"
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
      i.syncState === "rejected" ||
      i.syncState === "conflict" ||
      i.syncState === "submitting" ||
      i.syncState === "unknown",
  )
}

/** Save a checkpoint before the next network side effect. Storage failure aborts that side effect. */
export function saveExpenseCaptureCheckpoint(
  organizationId: string | number,
  deviceId: string,
  next: ExpenseCaptureOutboxItem,
): void {
  const items = readExpenseCaptureOutbox(organizationId, deviceId)
  const matches = items.filter(
    (item) => item.clientRequestId === next.clientRequestId,
  )
  if (matches.length !== 1 || next.deviceId !== deviceId)
    throw new Error("The queued capture identity is unavailable or ambiguous")
  writeExpenseCaptureOutbox(
    organizationId,
    deviceId,
    items.map((item) =>
      item.clientRequestId === next.clientRequestId ? next : item,
    ),
  )
}
