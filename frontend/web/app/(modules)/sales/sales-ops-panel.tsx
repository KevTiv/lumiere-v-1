'use client'

import { useMemo, useState } from 'react'
import { useErpSession } from '@lumiere/erp-session'
import { useTranslation } from '@lumiere/i18n'
import {
  humanTaskSubjectId,
  humanTaskSubjectModel,
  taskStatusTag,
  useApprovalInbox,
  useApproveApprovalRequest,
  useRejectApprovalRequest,
} from '@lumiere/query-hooks/hooks/approvals'
import { useRefreshSaleOrderPromiseDates } from '@lumiere/query-hooks/hooks/sales'
import {
  useOperatingCompanyBigInt,
  useOperatingCompanyId,
} from '@lumiere/query-hooks/hooks/use-operating-company'
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

/** Normalize identity hex for SoD requester vs current user comparison. */
function normalizeIdentityHex(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string') {
    return v.trim().replace(/^0x/i, '').toLowerCase()
  }
  if (typeof v === 'object' && v !== null && '__identity__' in (v as object)) {
    return String((v as { __identity__: string }).__identity__)
      .trim()
      .replace(/^0x/i, '')
      .toLowerCase()
  }
  if (typeof v === 'object' && v !== null && 'toHex' in v) {
    const th = (v as { toHex: () => { toString: () => string } }).toHex
    if (typeof th === 'function') {
      return th.call(v).toString().replace(/^0x/i, '').toLowerCase()
    }
  }
  return String(v)
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase()
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
  /** Server-bounded `sale-orders-to-approve` when subscribed; falls back to client filter. */
  ordersToApprove?: Record<string, unknown>[]
  /** Server-bounded `partner-credit-holds` when subscribed; falls back to client filter. */
  creditHolds?: Record<string, unknown>[]
  /** Server-bounded `sale-commissions-pending` (accrued) when subscribed; falls back to client filter. */
  commissionsPending?: Record<string, unknown>[]
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
  /** Wave D OMS advanced — prompt-driven creates (no QueryResourceKey lists yet). */
  onCreateCommissionPlan?: () => Promise<void>
  onCreateCommissionPlanSplit?: () => Promise<void>
  onCreateSaleContract?: () => Promise<void>
  onCreateCpqConstraint?: () => Promise<void>
  onCreateIntegrationIntent?: () => Promise<void>
  onRecordIntegrationResult?: () => Promise<void>
  onScheduleSlaEscalation?: () => Promise<void>
  advancedPending?: boolean
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
  ordersToApprove,
  creditHolds,
  commissionsPending,
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
  onCreateCommissionPlan,
  onCreateCommissionPlanSplit,
  onCreateSaleContract,
  onCreateCpqConstraint,
  onCreateIntegrationIntent,
  onRecordIntegrationResult,
  onScheduleSlaEscalation,
  advancedPending,
  onOpenOrdersTab,
  onOpenFulfillment,
  onOpenReturns,
}: SalesOpsPanelProps) {
  const { t } = useTranslation()
  const { organizationId, identity } = useErpSession()
  const orgId =
    organizationId != null && organizationId > 0 ? organizationId : 0
  const orgIdBig = BigInt(orgId)
  const operatingCompanyId = useOperatingCompanyId(orgId)
  const operatingCompanyBig = useOperatingCompanyBigInt(orgId) ?? 0n
  const inboxEnabled = activeQueue === 'to_approve' && orgId > 0
  const inboxQuery = useApprovalInbox(orgId, inboxEnabled)
  const approveRequest = useApproveApprovalRequest(
    orgId,
    operatingCompanyId ?? 0,
  )
  const rejectRequest = useRejectApprovalRequest(
    orgId,
    operatingCompanyId ?? 0,
  )
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<string[]>([])
  const [selectedAccrueOrderIds, setSelectedAccrueOrderIds] = useState<string[]>(
    [],
  )
  const [settleOpen, setSettleOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const refreshPromise = useRefreshSaleOrderPromiseDates(
    orgIdBig,
    operatingCompanyBig,
  )

  const runAdvanced = async (fn?: () => Promise<void>) => {
    if (!fn) return
    try {
      setActionError(null)
      await fn()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

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
        return (
          ordersToApprove ??
          orders.filter((o) => saleOrderState(o) === 'ToApprove')
        )
      case 'sent_quotes':
        return orders.filter((o) => saleOrderState(o) === 'Sent')
      case 'credit_holds':
        return (
          creditHolds ??
          partnerCreditControls.filter((c) =>
            Boolean(c.paymentHold ?? c.payment_hold),
          )
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
        return (
          commissionsPending ??
          commissions.filter(
            (c) => String(c.state ?? '').toLowerCase() === 'accrued',
          )
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
    ordersToApprove,
    partnerCreditControls,
    creditHolds,
    stockPickings,
    returnOrders,
    commissions,
    commissionsPending,
    orderIdsWithActiveCommission,
  ])

  const selectedOrder = useMemo(
    () => orders.find((o) => rowId(o) === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  )

  const pendingApprovalForSelected = useMemo(() => {
    if (!selectedOrderId) return null
    const soId = Number(selectedOrderId)
    if (!Number.isFinite(soId) || soId <= 0) return null
    return (
      (inboxQuery.data ?? []).find((row) => {
        const status = taskStatusTag(row)
        if (status !== 'Open' && status !== 'Claimed') return false
        if ((humanTaskSubjectModel(row) ?? row.model ?? '') !== 'sale_order') return false
        const resId = humanTaskSubjectId(row) ?? Number(row.resId ?? row.res_id ?? 0)
        return resId === soId
      }) ?? null
    )
  }, [inboxQuery.data, selectedOrderId])

  const isApprovalRequester = useMemo(() => {
    if (!pendingApprovalForSelected || !identity) return false
    const requester = normalizeIdentityHex(
      pendingApprovalForSelected.requestedBy ??
        pendingApprovalForSelected.requested_by,
    )
    const me = normalizeIdentityHex(identity)
    return requester !== '' && me !== '' && requester === me
  }, [pendingApprovalForSelected, identity])

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

      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
        data-testid="sales-ops-promise-atp"
      >
        <div>
          <h3 className="text-sm font-medium">Multi-WH promise ATP</h3>
          <p className="text-xs text-muted-foreground">
            Refresh commitment / line schedule from warehouse network + lead days.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!operatingCompanyId || refreshPromise.isPending}
          data-testid="sales-ops-refresh-promise"
          onClick={async () => {
            const raw = window.prompt('Sale order id to refresh promise dates')
            if (!raw?.trim()) return
            try {
              setActionError(null)
              await refreshPromise.mutateAsync(raw.trim())
            } catch (e) {
              setActionError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          {refreshPromise.isPending ? 'Refreshing…' : 'Refresh promise dates'}
        </Button>
      </div>

      <div
        className="space-y-2 rounded-md border p-3"
        data-testid="sales-ops-advanced-oms"
      >
        <h3 className="text-sm font-medium">
          {t('sales.ops.advancedTitle', {
            defaultValue: 'Advanced OMS',
          })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('sales.ops.advancedHelp', {
            defaultValue:
              'Create commission plans, contracts, and fiscal/carrier intents (no list subscriptions yet).',
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onCreateCommissionPlan}
            data-testid="sales-ops-create-commission-plan"
            onClick={() => void runAdvanced(onCreateCommissionPlan)}
          >
            {t('sales.ops.createCommissionPlan', {
              defaultValue: 'Create commission plan',
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onCreateCommissionPlanSplit}
            data-testid="sales-ops-create-commission-split"
            onClick={() => void runAdvanced(onCreateCommissionPlanSplit)}
          >
            {t('sales.ops.createCommissionSplit', {
              defaultValue: 'Add plan split',
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onCreateSaleContract}
            data-testid="sales-ops-create-contract"
            onClick={() => void runAdvanced(onCreateSaleContract)}
          >
            {t('sales.ops.createContract', {
              defaultValue: 'Create contract',
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onCreateCpqConstraint}
            data-testid="sales-ops-create-cpq-constraint"
            onClick={() => void runAdvanced(onCreateCpqConstraint)}
          >
            {t('sales.ops.createCpqConstraint', {
              defaultValue: 'Create CPQ constraint',
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onCreateIntegrationIntent}
            data-testid="sales-ops-create-integration-intent"
            onClick={() => void runAdvanced(onCreateIntegrationIntent)}
          >
            {t('sales.ops.createIntegrationIntent', {
              defaultValue: 'Create fiscal/carrier intent',
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onRecordIntegrationResult}
            data-testid="sales-ops-record-integration-result"
            onClick={() => void runAdvanced(onRecordIntegrationResult)}
          >
            {t('sales.ops.recordIntegrationResult', {
              defaultValue: 'Record integration result',
            })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={advancedPending || !onScheduleSlaEscalation}
            data-testid="sales-ops-schedule-sla"
            onClick={() => void runAdvanced(onScheduleSlaEscalation)}
          >
            {t('sales.ops.scheduleSla', {
              defaultValue: 'Schedule SLA escalation',
            })}
          </Button>
        </div>
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
          {activeQueue === 'to_approve' && selectedOrderId && (
            <div className="flex flex-wrap gap-2 border-t px-3 py-2">
              <Button
                size="sm"
                data-testid="sales-ops-approve-request"
                disabled={
                  !pendingApprovalForSelected ||
                  isApprovalRequester ||
                  approveRequest.isPending ||
                  rejectRequest.isPending ||
                  operatingCompanyId == null
                }
                title={
                  isApprovalRequester
                    ? t('sales.ops.cannotSelfApprove', {
                        defaultValue:
                          'Requester cannot approve their own request (SoD)',
                      })
                    : undefined
                }
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(null)
                      if (!pendingApprovalForSelected) {
                        setActionError(
                          t('sales.ops.noPendingApproval', {
                            defaultValue:
                              'No pending approval request for this order.',
                          }),
                        )
                        return
                      }
                      if (operatingCompanyId == null) {
                        setActionError(
                          t('sales.ops.missingCompany', {
                            defaultValue:
                              'Select an operating company first.',
                          }),
                        )
                        return
                      }
                      await approveRequest.mutateAsync(
                        Number(pendingApprovalForSelected.id),
                      )
                    } catch (e) {
                      const msg =
                        e instanceof Error ? e.message : String(e)
                      setActionError(msg)
                      if (typeof window !== 'undefined') {
                        window.alert(msg)
                      }
                    }
                  })()
                }}
              >
                {t('sales.ops.approve', { defaultValue: 'Approve' })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="sales-ops-reject-request"
                disabled={
                  !pendingApprovalForSelected ||
                  approveRequest.isPending ||
                  rejectRequest.isPending ||
                  operatingCompanyId == null
                }
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(null)
                      if (!pendingApprovalForSelected) {
                        setActionError(
                          t('sales.ops.noPendingApproval', {
                            defaultValue:
                              'No pending approval request for this order.',
                          }),
                        )
                        return
                      }
                      if (operatingCompanyId == null) {
                        setActionError(
                          t('sales.ops.missingCompany', {
                            defaultValue:
                              'Select an operating company first.',
                          }),
                        )
                        return
                      }
                      const reason =
                        typeof window !== 'undefined'
                          ? (window
                              .prompt(
                                t('sales.ops.rejectReasonPrompt', {
                                  defaultValue: 'Reason for rejection',
                                }),
                              )
                              ?.trim() ?? '')
                          : ''
                      if (!reason) return
                      await rejectRequest.mutateAsync({
                        requestId: Number(pendingApprovalForSelected.id),
                        reason,
                      })
                    } catch (e) {
                      const msg =
                        e instanceof Error ? e.message : String(e)
                      setActionError(msg)
                      if (typeof window !== 'undefined') {
                        window.alert(msg)
                      }
                    }
                  })()
                }}
              >
                {t('sales.ops.reject', { defaultValue: 'Reject' })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="sales-ops-open-approvals"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = `/workflow?tab=approvals&model=sale_order&resId=${encodeURIComponent(selectedOrderId)}`
                  }
                }}
              >
                {t('sales.ops.approveInWorkflow', {
                  defaultValue: 'Open in Workflow',
                })}
              </Button>
              {isApprovalRequester && (
                <p
                  className="w-full text-xs text-muted-foreground"
                  data-testid="sales-ops-sod-hint"
                >
                  {t('sales.ops.cannotSelfApprove', {
                    defaultValue:
                      'Requester cannot approve their own request (SoD)',
                  })}
                </p>
              )}
            </div>
          )}
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
