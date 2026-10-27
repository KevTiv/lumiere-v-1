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
  productId?: string
  taxIds?: string[]
  accountId?: string
  analyticAccountId?: string
  policyExceptionReason?: string
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
  /** Generic form provenance is local recovery context, never server authority. */
  formOrigin?: { actorIdentity: string; organizationId: string; pricelistId: string }
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
  strict = false,
): ExpenseCaptureOutboxItem[] {
  if (strict) {
    if (typeof window === "undefined") throw new Error("Expense recovery storage is unavailable")
    const raw = window.localStorage.getItem(storageKey(organizationId, deviceId))
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((item: unknown) => !item || typeof item !== "object" || !("clientRequestId" in item) || !("deviceId" in item) || item.deviceId !== deviceId || !("syncState" in item) || !["queued", "submitting", "unknown", "rejected", "synced", "error", "conflict"].includes(String(item.syncState)) || !("payload" in item) || !item.payload || typeof item.payload !== "object" || !("employeeId" in item.payload) || !("currencyId" in item.payload) || !("lineKind" in item.payload))) {
      throw new Error("Expense recovery storage is invalid; no new request was sent")
    }
    return parsed as ExpenseCaptureOutboxItem[]
  }
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
  const items = readExpenseCaptureOutbox(organizationId, item.deviceId, Boolean(item.formOrigin))
  const existing = items.find((i) => i.clientRequestId === item.clientRequestId)
  if (existing) {
    if (item.formOrigin && (JSON.stringify(existing.payload) !== JSON.stringify(item.payload)
      || existing.companyId !== item.companyId || JSON.stringify(existing.formOrigin) !== JSON.stringify(item.formOrigin))) {
      throw new Error("The existing expense request does not match this draft")
    }
    return existing
  }
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
  const existing = readExpenseCaptureOutbox(organizationId, deviceId, true)
  if (existing.some((item) => item.clientRequestId === clientRequestId && item.formOrigin && item.syncState !== "synced")) throw new Error("Retained expense requests must be resolved before removal")
  const items = existing.filter((i) => i.clientRequestId !== clientRequestId)
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
  const items = readExpenseCaptureOutbox(organizationId, deviceId, Boolean(next.formOrigin))
  const matches = items.filter(
    (item) => item.clientRequestId === next.clientRequestId,
  )
  if (matches.length !== 1 || next.deviceId !== deviceId)
    throw new Error("The queued capture identity is unavailable or ambiguous")
  const previous = matches[0]!
  if (previous.formOrigin && JSON.stringify(previous.receipt && [previous.receipt.clientRequestId, previous.receipt.fileName, previous.receipt.fileSize, previous.receipt.mimeType, previous.receipt.lastModified]) !== JSON.stringify(next.receipt && [next.receipt.clientRequestId, next.receipt.fileName, next.receipt.fileSize, next.receipt.mimeType, next.receipt.lastModified])) throw new Error("The saved expense receipt identity is immutable")
  if (previous.formOrigin && (JSON.stringify(previous.payload) !== JSON.stringify(next.payload)
    || previous.companyId !== next.companyId || JSON.stringify(previous.formOrigin) !== JSON.stringify(next.formOrigin))) {
    throw new Error("The saved expense request is immutable")
  }
  writeExpenseCaptureOutbox(
    organizationId,
    deviceId,
    items.map((item) =>
      item.clientRequestId === next.clientRequestId ? next : item,
    ),
  )
}
