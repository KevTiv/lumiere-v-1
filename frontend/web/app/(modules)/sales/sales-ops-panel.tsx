'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from '@lumiere/i18n'
import { Button, FormModal } from '@lumiere/ui'
import type { FormConfig } from '@lumiere/ui'

export type SalesOpsQueueId =
  | 'to_approve'
  | 'sent_quotes'
  | 'credit_holds'
  | 'open_deliveries'
  | 'returns_receive'
  | 'commissions_to_accrue'
  | 'commissions_accrued'
  | 'commissions_settled'

const QUEUE_IDS: SalesOpsQueueId[] = [
  'to_approve',
  'sent_quotes',
  'credit_holds',
  'open_deliveries',
  'returns_receive',
  'commissions_to_accrue',
  'commissions_accrued',
  'commissions_settled',
]

const COMMISSION_ROW_QUEUES: SalesOpsQueueId[] = [
  'commissions_accrued',
  'commissions_settled',
]

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? '')
}

function saleOrderState(row: Record<string, unknown>): string {
  const raw = row.state
  if (raw && typeof raw === 'object' && 'tag' in (raw as object)) {
    return String((raw as { tag: string }).tag)
  }
  return String(raw ?? '')
}

export function parseCommissionRatePercent(
  row: Record<string, unknown>,
): number {
  const metaRaw = row.metadata
  if (typeof metaRaw !== 'string' || !metaRaw.trim()) return 0
  try {
    const parsed = JSON.parse(metaRaw) as Record<string, unknown>
    const rate = Number(parsed.commission_rate_percent)
    return Number.isFinite(rate) && rate > 0 ? rate : 0
  } catch {
    return 0
  }
}

export function mergeCommissionRateIntoMetadata(
  existing: unknown,
  ratePercent: number | null,
): string | undefined {
  let obj: Record<string, unknown> = {}
  if (typeof existing === 'string' && existing.trim()) {
    try {
      const parsed = JSON.parse(existing) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      obj = {}
    }
  }
  if (ratePercent == null || !Number.isFinite(ratePercent) || ratePercent <= 0) {
    delete obj.commission_rate_percent
  } else {
    obj.commission_rate_percent = ratePercent
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : undefined
}

export interface SalesOpsPanelProps {
  activeQueue: SalesOpsQueueId
  onQueueChange: (queue: SalesOpsQueueId) => void
  orders: Record<string, unknown>[]
  orderLines: Record<string, unknown>[]
  partnerCreditControls: Record<string, unknown>[]
  stockPickings: Record<string, unknown>[]
  returnOrders: Record<string, unknown>[]
  commissions: Record<string, unknown>[]
  accountMoves: Record<string, unknown>[]
  accountJournals: Record<string, unknown>[]
  accountAccounts: Record<string, unknown>[]
  settlePending?: boolean
  cancelPending?: boolean
  reversePending?: boolean
  accruePending?: boolean
  onSettleCommissions: (input: {
    commissionIds: string[]
    journalId: string
    expenseAccountId: string
    payableAccountId: string
  }) => Promise<void>
  onCancelCommissions: (commissionIds: string[]) => Promise<void>
  onReverseCommissions: (commissionIds: string[]) => Promise<void>
  onAccrueCommissions: (
    items: Array<{ orderId: string; ratePercent: number }>,
  ) => Promise<void>
  onOpenOrdersTab?: (state?: string) => void
  onOpenFulfillment?: () => void
  onOpenReturns?: () => void
}

export function SalesOpsPanel({
  activeQueue,
  onQueueChange,
  orders,
  orderLines,
  partnerCreditControls,
  stockPickings,
  returnOrders,
  commissions,
  accountMoves,
  accountJournals,
  accountAccounts,
  settlePending,
  cancelPending,
  reversePending,
  accruePending,
  onSettleCommissions,
  onCancelCommissions,
  onReverseCommissions,
  onAccrueCommissions,
  onOpenOrdersTab,
  onOpenFulfillment,
  onOpenReturns,
}: SalesOpsPanelProps) {
  const { t } = useTranslation()
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<string[]>([])
  const [selectedAccrueOrderIds, setSelectedAccrueOrderIds] = useState<string[]>(
    [],
  )
  const [settleOpen, setSettleOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const orderIdsWithActiveCommission = useMemo(() => {
    const ids = new Set<string>()
    for (const c of commissions) {
      const st = String(c.state ?? '').toLowerCase()
      if (st === 'cancelled') continue
      ids.add(String(c.saleOrderId ?? c.sale_order_id ?? ''))
    }
    return ids
  }, [commissions])

  const queueRows = useMemo(() => {
    switch (activeQueue) {
      case 'to_approve':
        return orders.filter((o) => saleOrderState(o) === 'ToApprove')
      case 'sent_quotes':
        return orders.filter((o) => saleOrderState(o) === 'Sent')
      case 'credit_holds':
        return partnerCreditControls.filter((c) =>
          Boolean(c.paymentHold ?? c.payment_hold),
        )
      case 'open_deliveries':
        return stockPickings.filter((p) => {
          if (Boolean(p.isReturn ?? p.is_return)) return false
          const st = String(p.state ?? '').toLowerCase()
          return st !== 'done' && st !== 'cancel' && st !== 'cancelled'
        })
      case 'returns_receive':
        return returnOrders.filter((r) => {
          const st = String(r.state ?? '').toLowerCase()
          return st === 'confirmed' || st === 'draft'
        })
      case 'commissions_to_accrue':
        return orders.filter((o) => {
          const st = saleOrderState(o)
          if (st !== 'Sale' && st !== 'Done') return false
          const rate = parseCommissionRatePercent(o)
          if (rate <= 0) return false
          return !orderIdsWithActiveCommission.has(rowId(o))
        })
      case 'commissions_accrued':
        return commissions.filter(
          (c) => String(c.state ?? '').toLowerCase() === 'accrued',
        )
      case 'commissions_settled':
        return commissions.filter(
          (c) => String(c.state ?? '').toLowerCase() === 'settled',
        )
      default:
        return []
    }
  }, [
    activeQueue,
    orders,
    partnerCreditControls,
    stockPickings,
    returnOrders,
    commissions,
    orderIdsWithActiveCommission,
  ])

  const selectedOrder = useMemo(
    () => orders.find((o) => rowId(o) === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  )

  const drillLines = useMemo(() => {
    if (!selectedOrderId) return []
    return orderLines.filter(
      (l) => String(l.orderId ?? l.order_id ?? '') === selectedOrderId,
    )
  }, [orderLines, selectedOrderId])

  const drillPickings = useMemo(() => {
    if (!selectedOrderId) return []
    return stockPickings.filter(
      (p) => String(p.saleId ?? p.sale_id ?? '') === selectedOrderId,
    )
  }, [stockPickings, selectedOrderId])

  const drillMoves = useMemo(() => {
    if (!selectedOrderId) return []
    return accountMoves.filter(
      (m) =>
        String(m.saleOrderId ?? m.sale_order_id ?? '') === selectedOrderId,
    )
  }, [accountMoves, selectedOrderId])

  const drillCommissions = useMemo(() => {
    if (!selectedOrderId) return []
    return commissions.filter(
      (c) =>
        String(c.saleOrderId ?? c.sale_order_id ?? '') === selectedOrderId,
    )
  }, [commissions, selectedOrderId])

  const poIds = useMemo(() => {
    if (!selectedOrder) return [] as string[]
    const raw =
      selectedOrder.purchaseOrderIds ?? selectedOrder.purchase_order_ids
    if (Array.isArray(raw)) return raw.map(String)
    return []
  }, [selectedOrder])

  const settleForm = useMemo((): FormConfig => {
    const journalOptions = accountJournals.map((j) => ({
      value: rowId(j),
      label: String(j.name ?? j.code ?? j.id),
    }))
    const accountOptions = accountAccounts.map((a) => ({
      value: rowId(a),
      label: `${String(a.code ?? '')} ${String(a.name ?? '')}`.trim(),
    }))
    return {
      id: 'settle-sale-commissions',
      title: t('sales.ops.settleTitle', { defaultValue: 'Settle commissions' }),
      submitLabel: t('sales.ops.settleSubmit', {
        defaultValue: 'Post settlement',
      }),
      cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
      sections: [
        {
          id: 'accounts',
          fields: [
            {
              id: 'journalId',
              name: 'journalId',
              label: t('sales.ops.journal', { defaultValue: 'Journal' }),
              type: 'select',
              required: true,
              options: journalOptions,
            },
            {
              id: 'expenseAccountId',
              name: 'expenseAccountId',
              label: t('sales.ops.expenseAccount', {
                defaultValue: 'Expense account',
              }),
              type: 'select',
              required: true,
              options: accountOptions,
            },
            {
              id: 'payableAccountId',
              name: 'payableAccountId',
              label: t('sales.ops.payableAccount', {
                defaultValue: 'Payable account',
              }),
              type: 'select',
              required: true,
              options: accountOptions,
            },
          ],
        },
      ],
    }
  }, [accountJournals, accountAccounts, t])

  const queueLabel = (id: SalesOpsQueueId) =>
    t(`sales.ops.queues.${id}`, {
      defaultValue: id.replace(/_/g, ' '),
    })

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="sales-ops-panel">
      <div className="flex flex-wrap gap-2">
        {QUEUE_IDS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={activeQueue === id ? 'default' : 'outline'}
            onClick={() => {
              setSelectedCommissionIds([])
              setSelectedAccrueOrderIds([])
              setActionError(null)
              onQueueChange(id)
            }}
            data-testid={`sales-ops-queue-${id}`}
          >
            {queueLabel(id)}
          </Button>
        ))}
      </div>

      {actionError && (
        <p className="text-sm text-destructive" data-testid="sales-ops-action-error">
          {actionError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-[240px] space-y-2">
          <h3 className="text-sm font-medium">
            {queueLabel(activeQueue)} ({queueRows.length})
          </h3>
          <ul className="divide-y rounded-md border">
            {queueRows.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">
                {t('sales.ops.emptyQueue', {
                  defaultValue: 'No items in this queue',
                })}
              </li>
            )}
            {queueRows.map((row) => {
              const id = rowId(row)
              const isCommissionRow = COMMISSION_ROW_QUEUES.includes(activeQueue)
              const isAccrueQueue = activeQueue === 'commissions_to_accrue'
              const soId = isCommissionRow
                ? String(row.saleOrderId ?? row.sale_order_id ?? id)
                : id
              const selected = isCommissionRow
                ? selectedCommissionIds.includes(id)
                : isAccrueQueue
                  ? selectedAccrueOrderIds.includes(id)
                  : selectedOrderId === id
              const rate = isAccrueQueue ? parseCommissionRatePercent(row) : 0
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      selected ? 'bg-muted' : ''
                    }`}
                    onClick={() => {
                      if (isCommissionRow) {
                        setSelectedCommissionIds((prev) =>
                          prev.includes(id)
                            ? prev.filter((x) => x !== id)
                            : [...prev, id],
                        )
                        setSelectedOrderId(soId)
                      } else if (isAccrueQueue) {
                        setSelectedAccrueOrderIds((prev) =>
                          prev.includes(id)
                            ? prev.filter((x) => x !== id)
                            : [...prev, id],
                        )
                        setSelectedOrderId(id)
                      } else if (
                        activeQueue === 'to_approve' ||
                        activeQueue === 'sent_quotes'
                      ) {
                        setSelectedOrderId(id)
                      } else if (activeQueue === 'open_deliveries') {
                        const sale = String(row.saleId ?? row.sale_id ?? '')
                        if (sale) setSelectedOrderId(sale)
                        onOpenFulfillment?.()
                      } else if (activeQueue === 'returns_receive') {
                        const sale = String(
                          row.saleOrderId ?? row.sale_order_id ?? '',
                        )
                        if (sale) setSelectedOrderId(sale)
                        onOpenReturns?.()
                      } else if (activeQueue === 'credit_holds') {
                        onOpenOrdersTab?.()
                      }
                    }}
                  >
                    <span className="truncate">
                      {isCommissionRow
                        ? `#${id} · SO ${soId} · ${String(row.amount ?? '')}`
                        : isAccrueQueue
                          ? `${String(row.reference ?? row.name ?? id)} · ${rate}%`
                          : String(
                              row.name ??
                                row.reference ??
                                row.displayName ??
                                row.display_name ??
                                id,
                            )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {String(row.state ?? '')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {activeQueue === 'commissions_to_accrue' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  selectedAccrueOrderIds.length === 0 || accruePending
                }
                data-testid="sales-ops-accrue-commissions"
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(null)
                      const items = selectedAccrueOrderIds
                        .map((orderId) => {
                          const order = orders.find((o) => rowId(o) === orderId)
                          if (!order) return null
                          const ratePercent = parseCommissionRatePercent(order)
                          if (ratePercent <= 0) return null
                          return { orderId, ratePercent }
                        })
                        .filter(
                          (x): x is { orderId: string; ratePercent: number } =>
                            x != null,
                        )
                      if (items.length === 0) {
                        setActionError(
                          t('sales.ops.accrueMissingRate', {
                            defaultValue:
                              'Selected orders need commission_rate_percent in metadata.',
                          }),
                        )
                        return
                      }
                      await onAccrueCommissions(items)
                      setSelectedAccrueOrderIds([])
                    } catch (e) {
                      setActionError(
                        e instanceof Error ? e.message : String(e),
                      )
                    }
                  })()
                }}
              >
                {t('sales.ops.accrueSelected', {
                  defaultValue: 'Accrue selected',
                })}{' '}
                ({selectedAccrueOrderIds.length})
              </Button>
            </div>
          )}
          {activeQueue === 'commissions_accrued' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  selectedCommissionIds.length === 0 ||
                  settlePending ||
                  cancelPending
                }
                onClick={() => {
                  setActionError(null)
                  setSettleOpen(true)
                }}
              >
                {t('sales.ops.settleSelected', {
                  defaultValue: 'Settle selected',
                })}{' '}
                ({selectedCommissionIds.length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  selectedCommissionIds.length === 0 ||
                  settlePending ||
                  cancelPending
                }
                data-testid="sales-ops-cancel-commissions"
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(null)
                      await onCancelCommissions(selectedCommissionIds)
                      setSelectedCommissionIds([])
                    } catch (e) {
                      setActionError(
                        e instanceof Error ? e.message : String(e),
                      )
                    }
                  })()
                }}
              >
                {t('sales.ops.cancelSelected', {
                  defaultValue: 'Cancel selected',
                })}{' '}
                ({selectedCommissionIds.length})
              </Button>
            </div>
          )}
          {activeQueue === 'commissions_settled' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  selectedCommissionIds.length === 0 || reversePending
                }
                data-testid="sales-ops-reverse-commissions"
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(null)
                      await onReverseCommissions(selectedCommissionIds)
                      setSelectedCommissionIds([])
                    } catch (e) {
                      setActionError(
                        e instanceof Error ? e.message : String(e),
                      )
                    }
                  })()
                }}
              >
                {t('sales.ops.reverseSelected', {
                  defaultValue: 'Reverse settlement',
                })}{' '}
                ({selectedCommissionIds.length})
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <h3 className="text-sm font-medium">
            {t('sales.ops.drillTitle', { defaultValue: 'Order drill-down' })}
          </h3>
          {!selectedOrder ? (
            <p className="text-sm text-muted-foreground">
              {t('sales.ops.selectOrder', {
                defaultValue: 'Select a sale order from a queue to inspect.',
              })}
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-medium">
                  {String(
                    selectedOrder.reference ??
                      selectedOrder.name ??
                      selectedOrderId,
                  )}
                </span>{' '}
                · {saleOrderState(selectedOrder)} · total{' '}
                {String(
                  selectedOrder.amountTotal ?? selectedOrder.amount_total ?? '',
                )}
              </p>
              {poIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Dropship POs: {poIds.join(', ')}
                </p>
              )}
              <DrillSection
                title={t('sales.ops.lines', { defaultValue: 'Lines' })}
                count={drillLines.length}
                items={drillLines.map(
                  (l) =>
                    `${String(l.name ?? l.productId ?? l.product_id)} × ${String(l.productUomQty ?? l.product_uom_qty ?? '')}`,
                )}
              />
              <DrillSection
                title={t('sales.ops.pickings', { defaultValue: 'Pickings' })}
                count={drillPickings.length}
                items={drillPickings.map(
                  (p) =>
                    `#${rowId(p)} ${String(p.name ?? '')} (${String(p.state ?? '')})`,
                )}
              />
              <DrillSection
                title={t('sales.ops.moves', { defaultValue: 'AR moves' })}
                count={drillMoves.length}
                items={drillMoves.map(
                  (m) =>
                    `#${rowId(m)} ${String(m.name ?? '')} (${String(m.state ?? '')})`,
                )}
              />
              <DrillSection
                title={t('sales.ops.commissions', {
                  defaultValue: 'Commissions',
                })}
                count={drillCommissions.length}
                items={drillCommissions.map(
                  (c) =>
                    `#${rowId(c)} ${String(c.amount ?? '')} (${String(c.state ?? '')})`,
                )}
              />
            </>
          )}
        </div>
      </div>

      {settleOpen && (
        <FormModal
          config={settleForm}
          open={settleOpen}
          onOpenChange={setSettleOpen}
          closeOnSubmit={false}
          submitError={actionError}
          isPending={settlePending}
          onSubmit={async (data) => {
            try {
              setActionError(null)
              await onSettleCommissions({
                commissionIds: selectedCommissionIds,
                journalId: String(data.journalId ?? ''),
                expenseAccountId: String(data.expenseAccountId ?? ''),
                payableAccountId: String(data.payableAccountId ?? ''),
              })
              setSettleOpen(false)
              setSelectedCommissionIds([])
            } catch (e) {
              setActionError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}
    </div>
  )
}

function DrillSection({
  title,
  count,
  items,
}: {
  title: string
  count: number
  items: string[]
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">
        {title} ({count})
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs">
          {items.slice(0, 12).map((item) => (
            <li key={item} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function parseOpsQueueFilter(
  filters: Record<string, string>,
): SalesOpsQueueId {
  const q = filters.queue as SalesOpsQueueId | undefined
  if (q && QUEUE_IDS.includes(q)) return q
  return 'to_approve'
}
