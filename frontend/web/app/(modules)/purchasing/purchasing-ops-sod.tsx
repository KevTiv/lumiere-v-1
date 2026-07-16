'use client'

import { useMemo, useState } from 'react'
import { useErpSession } from '@lumiere/erp-session'
import { useTranslation } from '@lumiere/i18n'
import {
  useApprovalInbox,
  useApproveApprovalRequest,
  useRejectApprovalRequest,
} from '@lumiere/query-hooks/hooks/approvals'
import { useOperatingCompanyId } from '@lumiere/query-hooks/hooks/use-operating-company'
import { Button } from '@lumiere/ui'

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? '')
}

function poState(row: Record<string, unknown>): string {
  const raw = row.state
  if (raw && typeof raw === 'object' && 'tag' in (raw as object)) {
    return String((raw as { tag: string }).tag)
  }
  return String(raw ?? '')
}

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
  return String(v)
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase()
}

export interface PurchasingOpsSodProps {
  /** Server-bounded `purchase-orders-to-approve` when available; else client filter. */
  ordersToApprove?: Record<string, unknown>[]
  orders: Record<string, unknown>[]
  /** Wave C — RFQ / purchase returns (prompt-driven MVP). */
  onCreatePurchaseRfq?: () => Promise<void>
  onAddPurchaseRfqBid?: () => Promise<void>
  onAwardPurchaseRfqBid?: () => Promise<void>
  onCreatePurchaseReturn?: () => Promise<void>
  onConfirmPurchaseReturn?: () => Promise<void>
  onCreateVendorCreditFromReturn?: () => Promise<void>
  /** Wave D advanced — prompt-driven creates (no QueryResourceKey lists yet). */
  onCreateBlanketOrder?: () => Promise<void>
  onReleaseBlanketToPo?: () => Promise<void>
  onCreatePurchaseContract?: () => Promise<void>
  onUpsertVendorScorecard?: () => Promise<void>
  onSetVendorRiskFlag?: () => Promise<void>
  onCreateConsignmentAgreement?: () => Promise<void>
  onSetApprovalDelegate?: () => Promise<void>
  onSetCommodityPriceIndex?: () => Promise<void>
  onCreateIntegrationIntent?: () => Promise<void>
  onRecordIntegrationResult?: () => Promise<void>
}

/** Slim SoD Approve/Reject for ToApprove purchase orders (mirrors Sales Ops). */
export function PurchasingOpsSod({
  ordersToApprove,
  orders,
  onCreatePurchaseRfq,
  onAddPurchaseRfqBid,
  onAwardPurchaseRfqBid,
  onCreatePurchaseReturn,
  onConfirmPurchaseReturn,
  onCreateVendorCreditFromReturn,
  onCreateBlanketOrder,
  onReleaseBlanketToPo,
  onCreatePurchaseContract,
  onUpsertVendorScorecard,
  onSetVendorRiskFlag,
  onCreateConsignmentAgreement,
  onSetApprovalDelegate,
  onSetCommodityPriceIndex,
  onCreateIntegrationIntent,
  onRecordIntegrationResult,
}: PurchasingOpsSodProps) {
  const { t } = useTranslation()
  const { organizationId, identity } = useErpSession()
  const orgId =
    organizationId != null && organizationId > 0 ? organizationId : 0
  const operatingCompanyId = useOperatingCompanyId(orgId)
  const inboxQuery = useApprovalInbox(orgId, orgId > 0)
  const approveRequest = useApproveApprovalRequest(
    orgId,
    operatingCompanyId ?? 0,
  )
  const rejectRequest = useRejectApprovalRequest(
    orgId,
    operatingCompanyId ?? 0,
  )
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [advancedPending, setAdvancedPending] = useState(false)

  const queueRows = useMemo(
    () =>
      ordersToApprove ??
      orders.filter((o) => poState(o) === 'ToApprove'),
    [ordersToApprove, orders],
  )

  const pendingApprovalForSelected = useMemo(() => {
    if (!selectedOrderId) return null
    const poId = Number(selectedOrderId)
    if (!Number.isFinite(poId) || poId <= 0) return null
    return (
      (inboxQuery.data ?? []).find((row) => {
        const status = row.status ?? 'pending'
        if (status !== 'pending') return false
        if ((row.model ?? '') !== 'purchase_order') return false
        const resId = Number(row.resId ?? row.res_id ?? 0)
        return resId === poId
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

  const runAdvanced = async (fn?: () => Promise<void>) => {
    if (!fn) return
    try {
      setActionError(null)
      setAdvancedPending(true)
      await fn()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdvancedPending(false)
    }
  }

  const hasAdvanced =
    onCreatePurchaseRfq ||
    onAddPurchaseRfqBid ||
    onAwardPurchaseRfqBid ||
    onCreatePurchaseReturn ||
    onConfirmPurchaseReturn ||
    onCreateVendorCreditFromReturn ||
    onCreateBlanketOrder ||
    onReleaseBlanketToPo ||
    onCreatePurchaseContract ||
    onUpsertVendorScorecard ||
    onSetVendorRiskFlag ||
    onCreateConsignmentAgreement ||
    onSetApprovalDelegate ||
    onSetCommodityPriceIndex ||
    onCreateIntegrationIntent ||
    onRecordIntegrationResult

  if (queueRows.length === 0 && !hasAdvanced) {
    return null
  }

  return (
    <div className="mb-4 space-y-4" data-testid="purchasing-ops-sod">
      {queueRows.length > 0 ? (
        <div className="space-y-3 rounded-md border p-3">
          <div>
            <h3 className="text-sm font-medium">
              {t('purchasing.ops.toApproveTitle', {
                defaultValue: 'Purchase orders awaiting approval',
              })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('purchasing.ops.toApproveHelp', {
                defaultValue:
                  'Approve or reject workflow requests for ToApprove POs (SoD).',
              })}
            </p>
          </div>
          {actionError ? (
            <p className="text-xs text-destructive" role="alert">
              {actionError}
            </p>
          ) : null}
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {queueRows.map((row) => {
              const id = rowId(row)
              const selected = id === selectedOrderId
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left hover:bg-muted ${
                      selected ? 'bg-muted' : ''
                    }`}
                    data-testid={`purchasing-ops-po-${id}`}
                    onClick={() => {
                      setSelectedOrderId(id)
                      setActionError(null)
                    }}
                  >
                    {String(row.name ?? `PO-${id}`)} ·{' '}
                    {Number(
                      row.amountTotal ?? row.amount_total ?? 0,
                    ).toLocaleString()}
                  </button>
                </li>
              )
            })}
          </ul>
          {selectedOrderId ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid="purchasing-ops-approve-request"
                disabled={
                  !pendingApprovalForSelected ||
                  isApprovalRequester ||
                  approveRequest.isPending ||
                  rejectRequest.isPending ||
                  operatingCompanyId == null
                }
                title={
                  isApprovalRequester
                    ? t('purchasing.ops.cannotSelfApprove', {
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
                          t('purchasing.ops.noPendingApproval', {
                            defaultValue:
                              'No pending approval request for this order.',
                          }),
                        )
                        return
                      }
                      await approveRequest.mutateAsync(
                        Number(pendingApprovalForSelected.id),
                      )
                    } catch (e) {
                      setActionError(
                        e instanceof Error ? e.message : String(e),
                      )
                    }
                  })()
                }}
              >
                {t('purchasing.ops.approve', { defaultValue: 'Approve' })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="purchasing-ops-reject-request"
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
                          t('purchasing.ops.noPendingApproval', {
                            defaultValue:
                              'No pending approval request for this order.',
                          }),
                        )
                        return
                      }
                      const reason =
                        typeof window !== 'undefined'
                          ? window.prompt(
                              t('purchasing.ops.rejectReasonPrompt', {
                                defaultValue: 'Rejection reason',
                              }),
                              'Rejected',
                            )
                          : 'Rejected'
                      if (reason == null || !reason.trim()) return
                      await rejectRequest.mutateAsync({
                        requestId: Number(pendingApprovalForSelected.id),
                        reason: reason.trim(),
                      })
                    } catch (e) {
                      setActionError(
                        e instanceof Error ? e.message : String(e),
                      )
                    }
                  })()
                }}
              >
                {t('purchasing.ops.reject', { defaultValue: 'Reject' })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="purchasing-ops-open-approvals"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = `/workflow?tab=approvals&model=purchase_order&resId=${encodeURIComponent(selectedOrderId)}`
                  }
                }}
              >
                {t('purchasing.ops.openInWorkflow', {
                  defaultValue: 'Open in Workflow',
                })}
              </Button>
              {isApprovalRequester ? (
                <p className="w-full text-xs text-muted-foreground">
                  {t('purchasing.ops.cannotSelfApprove', {
                    defaultValue:
                      'Requester cannot approve their own request (SoD)',
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasAdvanced ? (
        <div
          className="space-y-2 rounded-md border p-3"
          data-testid="purchasing-ops-advanced"
        >
          <h3 className="text-sm font-medium">
            {t('purchasing.ops.advancedTitle', {
              defaultValue: 'Advanced procurement',
            })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('purchasing.ops.advancedHelp', {
              defaultValue:
                'Blanket orders, contracts, scorecards, consignment, and customs/e-invoice intents (no list subscriptions yet).',
            })}
          </p>
          {actionError && queueRows.length === 0 ? (
            <p className="text-xs text-destructive" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreatePurchaseRfq}
              data-testid="purchasing-ops-create-rfq"
              onClick={() => void runAdvanced(onCreatePurchaseRfq)}
            >
              {t('purchasing.ops.createRfq', {
                defaultValue: 'Create RFQ',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onAddPurchaseRfqBid}
              data-testid="purchasing-ops-add-rfq-bid"
              onClick={() => void runAdvanced(onAddPurchaseRfqBid)}
            >
              {t('purchasing.ops.addRfqBid', {
                defaultValue: 'Add RFQ bid',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onAwardPurchaseRfqBid}
              data-testid="purchasing-ops-award-rfq-bid"
              onClick={() => void runAdvanced(onAwardPurchaseRfqBid)}
            >
              {t('purchasing.ops.awardRfqBid', {
                defaultValue: 'Award RFQ bid',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreatePurchaseReturn}
              data-testid="purchasing-ops-create-return"
              onClick={() => void runAdvanced(onCreatePurchaseReturn)}
            >
              {t('purchasing.ops.createPurchaseReturn', {
                defaultValue: 'Create purchase return',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onConfirmPurchaseReturn}
              data-testid="purchasing-ops-confirm-return"
              onClick={() => void runAdvanced(onConfirmPurchaseReturn)}
            >
              {t('purchasing.ops.confirmPurchaseReturn', {
                defaultValue: 'Confirm purchase return',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreateVendorCreditFromReturn}
              data-testid="purchasing-ops-vendor-credit"
              onClick={() => void runAdvanced(onCreateVendorCreditFromReturn)}
            >
              {t('purchasing.ops.vendorCreditFromReturn', {
                defaultValue: 'Vendor credit from return',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreateBlanketOrder}
              data-testid="purchasing-ops-create-blanket"
              onClick={() => void runAdvanced(onCreateBlanketOrder)}
            >
              {t('purchasing.ops.createBlanket', {
                defaultValue: 'Create blanket order',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onReleaseBlanketToPo}
              data-testid="purchasing-ops-release-blanket"
              onClick={() => void runAdvanced(onReleaseBlanketToPo)}
            >
              {t('purchasing.ops.releaseBlanket', {
                defaultValue: 'Release blanket → PO',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreatePurchaseContract}
              data-testid="purchasing-ops-create-contract"
              onClick={() => void runAdvanced(onCreatePurchaseContract)}
            >
              {t('purchasing.ops.createContract', {
                defaultValue: 'Create contract',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onUpsertVendorScorecard}
              data-testid="purchasing-ops-upsert-scorecard"
              onClick={() => void runAdvanced(onUpsertVendorScorecard)}
            >
              {t('purchasing.ops.upsertScorecard', {
                defaultValue: 'Upsert vendor scorecard',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onSetVendorRiskFlag}
              data-testid="purchasing-ops-set-risk"
              onClick={() => void runAdvanced(onSetVendorRiskFlag)}
            >
              {t('purchasing.ops.setRiskFlag', {
                defaultValue: 'Set vendor risk flag',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreateConsignmentAgreement}
              data-testid="purchasing-ops-create-consignment"
              onClick={() => void runAdvanced(onCreateConsignmentAgreement)}
            >
              {t('purchasing.ops.createConsignment', {
                defaultValue: 'Create consignment',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onSetApprovalDelegate}
              data-testid="purchasing-ops-set-delegate"
              onClick={() => void runAdvanced(onSetApprovalDelegate)}
            >
              {t('purchasing.ops.setDelegate', {
                defaultValue: 'Set approval delegate',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onSetCommodityPriceIndex}
              data-testid="purchasing-ops-set-commodity"
              onClick={() => void runAdvanced(onSetCommodityPriceIndex)}
            >
              {t('purchasing.ops.setCommodity', {
                defaultValue: 'Set commodity index',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onCreateIntegrationIntent}
              data-testid="purchasing-ops-create-intent"
              onClick={() => void runAdvanced(onCreateIntegrationIntent)}
            >
              {t('purchasing.ops.createIntent', {
                defaultValue: 'Create customs/e-invoice intent',
              })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advancedPending || !onRecordIntegrationResult}
              data-testid="purchasing-ops-record-intent"
              onClick={() => void runAdvanced(onRecordIntegrationResult)}
            >
              {t('purchasing.ops.recordIntentResult', {
                defaultValue: 'Record integration result',
              })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
