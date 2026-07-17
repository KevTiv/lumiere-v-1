'use client'

import { useMemo, useState } from 'react'
import { useErpSession } from '@lumiere/erp-session'
import { useOperatingCompanyId } from '@lumiere/query-hooks/hooks/use-operating-company'
import {
  useInventoryExceptionsExpiredLots,
  useInventoryExceptionsOpenQc,
  useInventoryExceptionsShortAtp,
  useRefreshInventoryExceptions,
  useResolveInventoryException,
} from '@lumiere/query-hooks/hooks/inventory'
import { Button } from '@lumiere/ui'

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
  const [actionError, setActionError] = useState<string | null>(null)

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

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="inventory-ops-panel">
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
  )
}
