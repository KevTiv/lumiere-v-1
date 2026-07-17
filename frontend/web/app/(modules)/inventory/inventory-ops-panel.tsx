'use client'

import { useMemo, useState } from 'react'
import { useErpSession } from '@lumiere/erp-session'
import { useOperatingCompanyId } from '@lumiere/query-hooks/hooks/use-operating-company'
import {
  useApplyWarehouseSyncIntent,
  useCreateWarehouseSyncIntent,
  useInventoryExceptionsExpiredLots,
  useInventoryExceptionsOpenQc,
  useInventoryExceptionsShortAtp,
  useRefreshInventoryExceptions,
  useResolveInventoryException,
  useWarehouseSyncIntentsPending,
} from '@lumiere/query-hooks/hooks/inventory'
import { Button } from '@lumiere/ui'
import {
  getOrCreateDeviceId,
  listQueuedWarehouseOutbox,
  markWarehouseOutboxError,
  markWarehouseOutboxSynced,
} from '../../../lib/warehouse-sync-outbox'

export type InventoryOpsQueueId = 'short_atp' | 'expired_lots' | 'open_qc'

const QUEUE_IDS: InventoryOpsQueueId[] = ['short_atp', 'expired_lots', 'open_qc']

const QUEUE_LABELS: Record<InventoryOpsQueueId, string> = {
  short_atp: 'Short ATP',
  expired_lots: 'Expired lots',
  open_qc: 'Open QC fails',
}

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? '')
}

export interface InventoryOpsPanelProps {
  activeQueue?: InventoryOpsQueueId
  onQueueChange?: (queue: InventoryOpsQueueId) => void
}

export function InventoryOpsPanel({
  activeQueue: controlledQueue,
  onQueueChange,
}: InventoryOpsPanelProps) {
  const { organizationId } = useErpSession()
  const orgId =
    organizationId != null && organizationId > 0 ? organizationId : 0
  const operatingCompanyId = useOperatingCompanyId(orgId)
  const [localQueue, setLocalQueue] = useState<InventoryOpsQueueId>('short_atp')
  const activeQueue = controlledQueue ?? localQueue
  const setQueue = (q: InventoryOpsQueueId) => {
    onQueueChange?.(q)
    if (controlledQueue == null) setLocalQueue(q)
  }

  const shortAtp = useInventoryExceptionsShortAtp(orgId)
  const expiredLots = useInventoryExceptionsExpiredLots(orgId)
  const openQc = useInventoryExceptionsOpenQc(orgId)
  const refresh = useRefreshInventoryExceptions(orgId, operatingCompanyId ?? 0)
  const resolve = useResolveInventoryException(orgId, operatingCompanyId ?? 0)
  const pendingSync = useWarehouseSyncIntentsPending(orgId)
  const createSync = useCreateWarehouseSyncIntent(orgId, operatingCompanyId ?? 0)
  const applySync = useApplyWarehouseSyncIntent(orgId, operatingCompanyId ?? 0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const deviceId = useMemo(() => getOrCreateDeviceId(), [])
  const localQueued = useMemo(
    () => listQueuedWarehouseOutbox(String(orgId), deviceId),
    // re-read after flush via busy flag
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, deviceId, syncBusy, pendingSync.dataUpdatedAt],
  )

  const rows = useMemo(() => {
    switch (activeQueue) {
      case 'short_atp':
        return shortAtp.data ?? []
      case 'expired_lots':
        return expiredLots.data ?? []
      case 'open_qc':
        return openQc.data ?? []
    }
  }, [activeQueue, shortAtp.data, expiredLots.data, openQc.data])

  const counts = {
    short_atp: shortAtp.data?.length ?? 0,
    expired_lots: expiredLots.data?.length ?? 0,
    open_qc: openQc.data?.length ?? 0,
  }

  const flushLocalOutbox = async () => {
    if (!operatingCompanyId) return
    setSyncBusy(true)
    setActionError(null)
    try {
      const queued = listQueuedWarehouseOutbox(String(orgId), deviceId)
      for (const item of queued) {
        try {
          await createSync.mutateAsync({
            warehouseId: item.warehouseId,
            opType: item.opType,
            idempotencyKey: item.idempotencyKey,
            deviceId: item.deviceId,
            payload: JSON.stringify(item.payload),
          })
          const pending = pendingSync.data ?? []
          let intent = pending.find(
            (r) =>
              String(r.idempotencyKey ?? r.idempotency_key) ===
              item.idempotencyKey,
          )
          if (!intent) {
            await pendingSync.refetch()
            intent = (pendingSync.data ?? []).find(
              (r) =>
                String(r.idempotencyKey ?? r.idempotency_key) ===
                item.idempotencyKey,
            )
          }
          // Apply all currently pending intents for this device after create.
          const afterCreate = await pendingSync.refetch()
          const toApply = (afterCreate.data ?? []).filter(
            (r) =>
              String(r.deviceId ?? r.device_id ?? '') === deviceId ||
              String(r.idempotencyKey ?? r.idempotency_key) ===
                item.idempotencyKey,
          )
          for (const r of toApply) {
            await applySync.mutateAsync(rowId(r))
          }
          markWarehouseOutboxSynced(String(orgId), deviceId, item.idempotencyKey)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          markWarehouseOutboxError(String(orgId), deviceId, item.idempotencyKey, msg)
          throw e
        }
      }
      // Also apply any server-pending intents
      const serverPending = await pendingSync.refetch()
      for (const r of serverPending.data ?? []) {
        await applySync.mutateAsync(rowId(r))
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4" data-testid="inventory-ops-panel">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {QUEUE_IDS.map((id) => (
              <Button
                key={id}
                type="button"
                variant={activeQueue === id ? 'default' : 'outline'}
                size="sm"
                data-testid={`inventory-ops-queue-${id}`}
                onClick={() => setQueue(id)}
              >
                {QUEUE_LABELS[id]} ({counts[id]})
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!operatingCompanyId || refresh.isPending}
            onClick={async () => {
              try {
                setActionError(null)
                await refresh.mutateAsync({ upsertOnly: false })
              } catch (e) {
                setActionError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {refresh.isPending ? 'Refreshing…' : 'Refresh queues'}
          </Button>
        </div>

        {actionError ? (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    No open exceptions in this queue.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const id = rowId(row)
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {String(row.summary ?? '—')}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.productId ?? row.product_id ?? '—')}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.exceptionType ?? row.exception_type ?? '—')}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!operatingCompanyId || resolve.isPending}
                          onClick={async () => {
                            try {
                              setActionError(null)
                              await resolve.mutateAsync(id)
                            } catch (e) {
                              setActionError(
                                e instanceof Error ? e.message : String(e),
                              )
                            }
                          }}
                        >
                          Resolve
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="flex flex-col gap-3"
        data-testid="inventory-ops-warehouse-sync"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Remote warehouse sync</h3>
            <p className="text-xs text-muted-foreground">
              Local outbox ({localQueued.length}) · server pending (
              {pendingSync.data?.length ?? 0}) · device {deviceId.slice(0, 8)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!operatingCompanyId || syncBusy}
            onClick={() => void flushLocalOutbox()}
          >
            {syncBusy ? 'Flushing…' : 'Flush outbox + apply'}
          </Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Op</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {(pendingSync.data ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    No pending server sync intents.
                  </td>
                </tr>
              ) : (
                (pendingSync.data ?? []).map((row) => {
                  const id = rowId(row)
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">
                        {String(row.idempotencyKey ?? row.idempotency_key ?? '—')}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.opType ?? row.op_type ?? '—')}
                      </td>
                      <td className="px-3 py-2">
                        {String(row.status ?? '—')}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!operatingCompanyId || applySync.isPending}
                          onClick={async () => {
                            try {
                              setActionError(null)
                              await applySync.mutateAsync(id)
                            } catch (e) {
                              setActionError(
                                e instanceof Error ? e.message : String(e),
                              )
                            }
                          }}
                        >
                          Apply
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
