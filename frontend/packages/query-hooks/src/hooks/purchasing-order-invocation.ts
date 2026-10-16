import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { WorkflowError, type RowValueMap } from "@lumiere/erp-workflows"

import type { InvocationScope, ReceiptStorage } from "./purchasing-receipt-invocation"

export type PurchaseOrderOncePayload = Readonly<Record<string, unknown>>

export function keyedOperationU64(value: ScalarId): number {
  const encoded = stdbParamsToJson({ value: scalarToU64(value) }) as { value: number }
  return encoded.value
}

export function toCreatePurchaseOrderOnceParams(params: {
  partnerId: ScalarId; currencyId: ScalarId; origin?: unknown; partnerRef?: unknown; notes?: unknown
  datePlanned?: unknown; paymentTermId?: ScalarId | null; fiscalPositionId?: ScalarId | null; incotermId?: ScalarId | null
  incotermLocation?: unknown; isQuantityCopy?: unknown; metadata?: unknown
}): PurchaseOrderOncePayload {
  const option = (value: unknown) => value == null ? { none: [] } : { some: value }
  const optionalId = (value: ScalarId | null | undefined) => option(value == null ? null : keyedOperationU64(value))
  const timestamp = (value: unknown) => {
    if (value == null) return { none: [] }
    const encoded = stdbParamsToJson({ value }) as Record<string, unknown>
    return { some: encoded.value }
  }
  return {
    partner_id: keyedOperationU64(params.partnerId),
    currency_id: keyedOperationU64(params.currencyId),
    origin: option(params.origin),
    partner_ref: option(params.partnerRef),
    notes: option(params.notes),
    date_planned: timestamp(params.datePlanned),
    payment_term_id: optionalId(params.paymentTermId),
    fiscal_position_id: optionalId(params.fiscalPositionId),
    incoterm_id: optionalId(params.incotermId),
    incoterm_location: option(params.incotermLocation),
    is_quantity_copy: option(params.isQuantityCopy),
    metadata: option(params.metadata),
  }
}

export interface PendingPurchaseOrder {
  version: 1
  organizationId: string
  companyId: string
  actorHex: string
  operationKey: string
  payload: PurchaseOrderOncePayload
}

export interface PurchaseOrderCreationResult {
  pending: PendingPurchaseOrder
  purchaseOrderId: string
}

const keyValid = (key: unknown): key is string =>
  typeof key === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(key)

function scopeValid(scope: InvocationScope) {
  return /^[a-f0-9]{64}$/.test(scope.actorHex) && scope.organizationId > 0n && scope.companyId > 0n
}

export function purchaseOrderStorageKey(scope: InvocationScope) {
  if (!scopeValid(scope)) throw new WorkflowError("validation", "Current purchase order actor and scope are required")
  return `lumiere:purchasing:po-create:v1:${scope.organizationId}:${scope.companyId}:${scope.actorHex}`
}

function stablePayload(payload: PurchaseOrderOncePayload): string {
  try {
    return JSON.stringify(payload)
  } catch {
    throw new WorkflowError("validation", "Purchase order input cannot be preserved; no order was dispatched")
  }
}

function stored(raw: string, scope: InvocationScope): PendingPurchaseOrder {
  let data: PendingPurchaseOrder
  try {
    data = JSON.parse(raw)
  } catch {
    throw new WorkflowError("conflict", "Pending purchase order data is invalid; no order was dispatched")
  }
  if (!data || data.version !== 1 || data.organizationId !== scope.organizationId.toString() ||
      data.companyId !== scope.companyId.toString() || data.actorHex !== scope.actorHex ||
      !keyValid(data.operationKey) || !data.payload || typeof data.payload !== "object" || Array.isArray(data.payload)) {
    throw new WorkflowError("conflict", "Pending purchase order identity is inconsistent; no order was dispatched")
  }
  return data
}

export function readPendingPurchaseOrder(scope: InvocationScope, storage: ReceiptStorage) {
  const raw = storage.getItem(purchaseOrderStorageKey(scope))
  return raw == null ? undefined : stored(raw, scope)
}

function beginPurchaseOrder(
  scope: InvocationScope,
  payload: PurchaseOrderOncePayload,
  storage: ReceiptStorage,
  makeKey: () => string,
): PendingPurchaseOrder {
  const storageKey = purchaseOrderStorageKey(scope)
  let raw: string | null
  try {
    raw = storage.getItem(storageKey)
  } catch {
    throw new WorkflowError("validation", "Pending purchase order storage is unavailable; no order was dispatched")
  }
  if (raw != null) {
    const pending = stored(raw, scope)
    if (stablePayload(pending.payload) !== stablePayload(payload)) {
      throw new WorkflowError("conflict", "Resolve the pending purchase order before creating a different order")
    }
    return pending
  }
  const operationKey = makeKey()
  if (!keyValid(operationKey)) throw new WorkflowError("validation", "Purchase order operation key is invalid")
  const pending: PendingPurchaseOrder = {
    version: 1,
    organizationId: scope.organizationId.toString(),
    companyId: scope.companyId.toString(),
    actorHex: scope.actorHex,
    operationKey,
    payload,
  }
  const encoded = JSON.stringify(pending)
  stored(encoded, scope)
  try {
    storage.setItem(storageKey, encoded)
  } catch {
    throw new WorkflowError("validation", "Cannot preserve purchase order identity; no order was dispatched")
  }
  return pending
}

function creationResult(pending: PendingPurchaseOrder, rows: readonly RowValueMap[]): PurchaseOrderCreationResult | undefined {
  const id = `${pending.organizationId}:${pending.companyId}:${pending.operationKey}`
  const exact = rows.filter((row) => row.id === id)
  if (exact.length > 1) throw new WorkflowError("conflict", "Multiple canonical purchase order creations for one key")
  const row = exact[0]
  if (!row) return undefined
  const field = (camel: string, snake: string) => Object.hasOwn(row, camel) ? row[camel] : row[snake]
  const orderId = parseStrictU64(field("purchaseOrderId", "purchase_order_id"))
  const payloadHash = field("payloadHash", "payload_hash")
  if (parseStrictU64(field("organizationId", "organization_id"))?.toString() !== pending.organizationId ||
      parseStrictU64(field("companyId", "company_id"))?.toString() !== pending.companyId ||
      field("operationKey", "operation_key") !== pending.operationKey || !orderId ||
      typeof payloadHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(payloadHash)) {
    throw new WorkflowError("conflict", "Saved purchase order does not agree with canonical evidence")
  }
  return { pending, purchaseOrderId: orderId.toString() }
}

function clearPurchaseOrder(scope: InvocationScope, pending: PendingPurchaseOrder, storage: ReceiptStorage) {
  const key = purchaseOrderStorageKey(scope)
  const raw = storage.getItem(key)
  if (raw != null && stored(raw, scope).operationKey === pending.operationKey) storage.removeItem(key)
}

/** Persist identity before dispatch and prove the exact scoped result before clearing it. */
export async function executePurchaseOrderCreation(
  scope: InvocationScope,
  payload: PurchaseOrderOncePayload,
  storage: ReceiptStorage,
  ports: {
    makeKey(): string
    read(operationKey: string): Promise<RowValueMap[]>
    dispatch(pending: PendingPurchaseOrder): Promise<void>
  },
): Promise<PurchaseOrderCreationResult> {
  const previous = readPendingPurchaseOrder(scope, storage)
  const rows = await ports.read(previous?.operationKey ?? "capability_probe")
  const recovered = previous ? creationResult(previous, rows) : undefined
  if (previous && recovered) {
    clearPurchaseOrder(scope, previous, storage)
    return recovered
  }
  // A successful owner read with no row proves the prior key never committed.
  // Only then may corrected form input replace the saved intent.
  if (previous && stablePayload(previous.payload) !== stablePayload(payload)) {
    clearPurchaseOrder(scope, previous, storage)
  }
  const pending = beginPurchaseOrder(scope, payload, storage, ports.makeKey)
  await ports.dispatch(pending)
  const proved = creationResult(pending, await ports.read(pending.operationKey))
  if (!proved) throw new WorkflowError("server_failure", "Purchase order creation did not read back; retry with the saved identity")
  clearPurchaseOrder(scope, pending, storage)
  return proved
}
