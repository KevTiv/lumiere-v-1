/**
 * Lightweight local outbox for intermittent remote warehouse sync.
 * Persists pending ops in localStorage; flush creates server intents + applies.
 */

import {
  getOrCreateLocalStorageDeviceId,
  readLocalStorageArray,
  writeLocalStorageArray,
} from './local-outbox'

export type WarehouseOutboxOpType = 'barcode_scan' | 'cycle_count_line'

export interface WarehouseOutboxItem {
  idempotencyKey: string
  opType: WarehouseOutboxOpType
  warehouseId: number
  deviceId: string
  payload: Record<string, unknown>
  createdAt: string
  syncState: 'queued' | 'synced' | 'error'
  lastError?: string
}

function storageKey(organizationId: string | number, deviceId: string): string {
  return `lumiere.warehouse-outbox.${organizationId}.${deviceId}`
}

export function getOrCreateDeviceId(): string {
  return getOrCreateLocalStorageDeviceId('lumiere.warehouse-device-id')
}

export function readWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
): WarehouseOutboxItem[] {
  return readLocalStorageArray<WarehouseOutboxItem>(storageKey(organizationId, deviceId))
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
  item: Omit<WarehouseOutboxItem, 'createdAt' | 'syncState'>,
): WarehouseOutboxItem {
  const deviceId = item.deviceId
  const items = readWarehouseOutbox(organizationId, deviceId)
  if (items.some((i) => i.idempotencyKey === item.idempotencyKey)) {
    return items.find((i) => i.idempotencyKey === item.idempotencyKey)!
  }
  const row: WarehouseOutboxItem = {
    ...item,
    createdAt: new Date().toISOString(),
    syncState: 'queued',
  }
  items.push(row)
  writeWarehouseOutbox(organizationId, deviceId, items)
  return row
}

export function markWarehouseOutboxSynced(
  organizationId: string | number,
  deviceId: string,
  idempotencyKey: string,
): void {
  const items = readWarehouseOutbox(organizationId, deviceId).map((i) =>
    i.idempotencyKey === idempotencyKey
      ? { ...i, syncState: 'synced' as const, lastError: undefined }
      : i,
  )
  writeWarehouseOutbox(organizationId, deviceId, items)
}

export function markWarehouseOutboxError(
  organizationId: string | number,
  deviceId: string,
  idempotencyKey: string,
  lastError: string,
): void {
  const items = readWarehouseOutbox(organizationId, deviceId).map((i) =>
    i.idempotencyKey === idempotencyKey
      ? { ...i, syncState: 'error' as const, lastError }
      : i,
  )
  writeWarehouseOutbox(organizationId, deviceId, items)
}

export function listQueuedWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
): WarehouseOutboxItem[] {
  return readWarehouseOutbox(organizationId, deviceId).filter(
    (i) => i.syncState === 'queued' || i.syncState === 'error',
  )
}
