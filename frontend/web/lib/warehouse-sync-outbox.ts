/**
 * Lightweight local outbox for intermittent remote warehouse sync.
 * Persists pending ops in localStorage; flush creates server intents + applies.
 */

import { isCaptureOwnedBy, type CaptureOwner } from "./capture-sync-state"
import {
  getOrCreateLocalStorageDeviceId,
  readLocalStorageArray,
  writeLocalStorageArray,
} from "./local-outbox"

export type WarehouseOutboxOpType = "barcode_scan" | "cycle_count_line"

export interface WarehouseOutboxItem extends Partial<CaptureOwner> {
  idempotencyKey: string
  opType: WarehouseOutboxOpType
  warehouseId: number
  deviceId: string
  payload: Record<string, unknown>
  createdAt: string
  syncState: "queued" | "synced" | "error" | "conflict" | "rejected"
  lastError?: string
}

function storageKey(organizationId: string | number, deviceId: string): string {
  return `lumiere.warehouse-outbox.${organizationId}.${deviceId}`
}

export function getOrCreateDeviceId(): string {
  return getOrCreateLocalStorageDeviceId("lumiere.warehouse-device-id")
}

export function readWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
): WarehouseOutboxItem[] {
  return readLocalStorageArray<WarehouseOutboxItem>(
    storageKey(organizationId, deviceId),
  )
}

function writeWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
  items: WarehouseOutboxItem[],
): void {
  writeLocalStorageArray(storageKey(organizationId, deviceId), items)
}

export function enqueueWarehouseOutboxItem(
  organizationId: string | number,
  item: Omit<WarehouseOutboxItem, "createdAt" | "syncState"> & CaptureOwner,
): WarehouseOutboxItem {
  const deviceId = item.deviceId
  const items = readWarehouseOutbox(organizationId, deviceId)
  const existing = items.find((i) => i.idempotencyKey === item.idempotencyKey)
  if (existing) {
    if (
      !isCaptureOwnedBy(existing, item) ||
      existing.opType !== item.opType ||
      existing.warehouseId !== item.warehouseId ||
      JSON.stringify(existing.payload) !== JSON.stringify(item.payload)
    ) {
      throw new Error(
        "The warehouse sync request already belongs to another capture",
      )
    }
    return existing
  }
  const row: WarehouseOutboxItem = {
    ...item,
    createdAt: new Date().toISOString(),
    syncState: "queued",
  }
  items.push(row)
  writeWarehouseOutbox(organizationId, deviceId, items)
  return row
}

export function markWarehouseOutboxSynced(
  organizationId: string | number,
  deviceId: string,
  idempotencyKey: string,
  owner: CaptureOwner,
): void {
  const items = readWarehouseOutbox(organizationId, deviceId).map((i) =>
    isCaptureOwnedBy(i, owner) && i.idempotencyKey === idempotencyKey
      ? { ...i, syncState: "synced" as const, lastError: undefined }
      : i,
  )
  writeWarehouseOutbox(organizationId, deviceId, items)
}

export function markWarehouseOutboxError(
  organizationId: string | number,
  deviceId: string,
  idempotencyKey: string,
  owner: CaptureOwner,
  lastError: string,
  syncState: "error" | "conflict" | "rejected" = "error",
): void {
  const items = readWarehouseOutbox(organizationId, deviceId).map((i) =>
    isCaptureOwnedBy(i, owner) && i.idempotencyKey === idempotencyKey
      ? { ...i, syncState, lastError }
      : i,
  )
  writeWarehouseOutbox(organizationId, deviceId, items)
}

export function listQueuedWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
  owner: CaptureOwner,
): WarehouseOutboxItem[] {
  return readWarehouseOutbox(organizationId, deviceId).filter(
    (i) => isCaptureOwnedBy(i, owner) && i.syncState !== "synced",
  )
}
