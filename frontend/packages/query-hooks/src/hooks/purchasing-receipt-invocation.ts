import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { WorkflowError, recordRef, type ObservedTransition, type RowValueMap } from "@lumiere/erp-workflows"
import type { ReceiptSnapshot } from "./purchasing-receipt-effect"

export interface ReceiptStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface InvocationScope { organizationId: bigint; companyId: bigint; actorHex: string }
export interface PendingReceipt {
  version: 1; organizationId: string; companyId: string; actorHex: string; lineId: string; orderId: string
  operationKey: string; quantity: number; lotId: string | null; expectedReceived: number
  expectedMoveId: string | null; expectedPickingId: string | null
}
const positiveId = (value: unknown) => { const id = parseStrictU64(value); return id && id > 0n ? id.toString() : undefined }
const nullableId = (value: unknown): string | null | undefined => value === null ? null : positiveId(value)
const keyValid = (key: unknown): key is string => typeof key === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(key)
export function receiptStorageKey(scope: InvocationScope, lineId: string) {
  if (!/^[a-f0-9]{64}$/.test(scope.actorHex) || scope.organizationId <= 0n || scope.companyId <= 0n || !positiveId(lineId)) {
    throw new WorkflowError("validation", "Current receipt actor and scope are required")
  }
  return `lumiere:purchasing:receipt:v1:${scope.organizationId}:${scope.companyId}:${scope.actorHex}:${lineId}`
}
function stored(raw: string, scope: InvocationScope, lineId: string): PendingReceipt {
  let data: PendingReceipt
  try { data = JSON.parse(raw) } catch { throw new WorkflowError("conflict", "Pending receipt data is invalid; no receipt was dispatched") }
  if (!data || data.version !== 1 || data.organizationId !== scope.organizationId.toString() || data.companyId !== scope.companyId.toString()
      || data.actorHex !== scope.actorHex || data.lineId !== lineId || !positiveId(data.orderId) || !keyValid(data.operationKey)
      || !Number.isFinite(data.quantity) || data.quantity <= 0 || !Number.isFinite(data.expectedReceived) || data.expectedReceived < 0
      || nullableId(data.lotId) === undefined || nullableId(data.expectedMoveId) === undefined || nullableId(data.expectedPickingId) === undefined
      || (data.expectedMoveId === null) !== (data.expectedPickingId === null)) {
    throw new WorkflowError("conflict", "Pending receipt identity is inconsistent; no receipt was dispatched")
  }
  return data
}
export function readPendingReceipt(scope: InvocationScope, lineId: string, storage: ReceiptStorage): PendingReceipt | undefined {
  const raw = storage.getItem(receiptStorageKey(scope, lineId))
  return raw == null ? undefined : stored(raw, scope, lineId)
}

/** Persist before dispatch. Never replace unresolved identity or refresh its reviewed stock target. */
export async function beginReceiptInvocation(scope: InvocationScope, lineId: string, quantity: number, lotId: unknown,
    storage: ReceiptStorage, capture: () => Promise<ReceiptSnapshot>, makeKey: () => string): Promise<PendingReceipt> {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new WorkflowError("validation", "Receipt quantity must be finite and positive")
  const lot = lotId == null || lotId === "" ? null : positiveId(lotId)
  if (lot === undefined) throw new WorkflowError("validation", "Receipt lot is invalid")
  const storageKey = receiptStorageKey(scope, lineId)
  let previous: string | null
  try { previous = storage.getItem(storageKey) } catch { throw new WorkflowError("validation", "Pending receipt storage is unavailable; no receipt was dispatched") }
  if (previous != null) {
    const pending = stored(previous, scope, lineId)
    if (pending.quantity !== quantity || pending.lotId !== lot) throw new WorkflowError("conflict", `Resolve the pending receipt of ${pending.quantity} before starting a different receipt`)
    return pending
  }
  const snapshot = await capture()
  if (snapshot.organizationId !== scope.organizationId || snapshot.companyId !== scope.companyId || snapshot.lineId !== lineId
      || snapshot.qty !== quantity || !Number.isFinite(snapshot.qtyReceived) || snapshot.qtyReceived < 0
      || (!snapshot.service && !snapshot.target) || (snapshot.service && snapshot.target)) {
    throw new WorkflowError("validation", "Receipt snapshot does not agree with the invocation")
  }
  const pending: PendingReceipt = { version: 1, organizationId: scope.organizationId.toString(), companyId: scope.companyId.toString(), actorHex: scope.actorHex,
    lineId, orderId: snapshot.orderId.toString(), operationKey: makeKey(), quantity, lotId: lot, expectedReceived: snapshot.qtyReceived,
    expectedMoveId: snapshot.target?.moveId ?? null, expectedPickingId: snapshot.target?.pickingId ?? null }
  const raw = JSON.stringify(pending)
  stored(raw, scope, lineId)
  try { storage.setItem(storageKey, raw) } catch { throw new WorkflowError("validation", "Cannot preserve receipt identity; no receipt was dispatched") }
  return pending
}
export function clearReceiptInvocation(scope: InvocationScope, pending: PendingReceipt, storage: ReceiptStorage) {
  const key = receiptStorageKey(scope, pending.lineId)
  const raw = storage.getItem(key)
  if (raw != null && stored(raw, scope, pending.lineId).operationKey === pending.operationKey) storage.removeItem(key)
}
const field = (row: RowValueMap, camel: string, snake: string) => Object.hasOwn(row, camel) ? row[camel] : row[snake]
/** Immutable operation evidence proves the original event even after a subsequent receipt. */
export function observeReceiptInvocation(pending: PendingReceipt | undefined, rows: readonly RowValueMap[]): ObservedTransition {
  if (!pending) return {}
  const id = `${pending.organizationId}:${pending.companyId}:${pending.operationKey}`
  const exact = rows.filter(row => row.id === id)
  if (exact.length > 1) throw new WorkflowError("conflict", "Multiple canonical receipt operations for one key")
  const row = exact[0]
  if (!row) return {}
  const before = field(row, "receivedBefore", "received_before")
  const after = field(row, "receivedAfter", "received_after")
  if (positiveId(field(row, "organizationId", "organization_id")) !== pending.organizationId
      || positiveId(field(row, "companyId", "company_id")) !== pending.companyId
      || positiveId(field(row, "lineId", "line_id")) !== pending.lineId
      || positiveId(field(row, "orderId", "order_id")) !== pending.orderId
      || field(row, "operationKey", "operation_key") !== pending.operationKey
      || field(row, "quantity", "quantity") !== pending.quantity || before !== pending.expectedReceived
      || typeof after !== "number" || !Number.isFinite(after) || Math.abs(after - pending.expectedReceived - pending.quantity) > 1e-8
      || nullableId(field(row, "lotId", "lot_id")) !== pending.lotId
      || nullableId(field(row, "moveId", "move_id")) !== pending.expectedMoveId
      || nullableId(field(row, "pickingId", "picking_id")) !== pending.expectedPickingId) return {}
  const line = recordRef("purchase_order_line", pending.lineId, "purchasing")
  const picking = pending.expectedPickingId ? recordRef("stock_picking", pending.expectedPickingId, "inventory") : undefined
  return { outcome: "applied", next: picking ?? line, createdRecords: picking ? [picking] : [line] }
}
