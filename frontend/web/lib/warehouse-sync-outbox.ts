/**
 * Lightweight local outbox for intermittent remote warehouse sync.
 * Persists pending ops in localStorage; flush creates server intents + applies.
 */

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
  if (typeof window === 'undefined') return 'server'
  const key = 'lumiere.warehouse-device-id'
  let id = window.localStorage.getItem(key)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}`
    window.localStorage.setItem(key, id)
  }
  return id
}

export function readWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
): WarehouseOutboxItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId, deviceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as WarehouseOutboxItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeWarehouseOutbox(
  organizationId: string | number,
  deviceId: string,
  items: WarehouseOutboxItem[],
): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    storageKey(organizationId, deviceId),
    JSON.stringify(items),
  )
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
