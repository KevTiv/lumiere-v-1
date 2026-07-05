"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { DashboardHeader, MissingOrganization, Button } from "@lumiere/ui"
import {
  approvalRecordHref,
  isAiDraftApprovalRequest,
  useApprovalInbox,
  useApprovalRules,
  useApproveApprovalRequest,
  useCreateApprovalRule,
  useRejectApprovalRequest,
} from "@lumiere/query-hooks/hooks/approvals"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { CheckCircle2, ExternalLink, Loader2, Plus, Sparkles, XCircle } from "lucide-react"

function hasValidOrganizationId(value?: number): value is number {
  return value != null && value > 0
}

export function ApprovalsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <ApprovalsLoaded organizationId={organizationId} />
}

function ApprovalsLoaded({ organizationId }: { organizationId: number }) {
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const inboxQuery = useApprovalInbox(organizationId, operatingCompanyId != null)
  const rulesQuery = useApprovalRules(organizationId, operatingCompanyId != null)
  const approveRequest = useApproveApprovalRequest(organizationId, operatingCompanyId ?? 0)
  const rejectRequest = useRejectApprovalRequest(organizationId, operatingCompanyId ?? 0)
  const createRule = useCreateApprovalRule(organizationId, operatingCompanyId ?? undefined)

  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleName, setRuleName] = useState("")
  const [ruleModel, setRuleModel] = useState("purchase_order")
  const [ruleAction, setRuleAction] = useState("confirm_purchase_order")
  const [ruleType, setRuleType] = useState("amount_threshold")
  const [ruleThreshold, setRuleThreshold] = useState("5000")

  const pendingRequests = useMemo(
    () =>
      (inboxQuery.data ?? []).filter((row) => (row.status ?? "pending") === "pending"),
    [inboxQuery.data],
  )

  const aiDraftCount = useMemo(
    () => pendingRequests.filter(isAiDraftApprovalRequest).length,
    [pendingRequests],
  )

  const handleApprove = async (requestId: number) => {
    if (operatingCompanyId == null || operatingCompanyId <= 0) return
    await approveRequest.mutateAsync(requestId)
  }

  const handleReject = async (requestId: number) => {
    if (operatingCompanyId == null || operatingCompanyId <= 0) return
    if (!rejectReason.trim()) return
    await rejectRequest.mutateAsync({ requestId, reason: rejectReason.trim() })
    setRejectingId(null)
    setRejectReason("")
  }

  const handleCreateRule = async () => {
    if (!ruleName.trim()) return
    const threshold = Number(ruleThreshold)
    if (!Number.isFinite(threshold) || threshold <= 0) return
    await createRule.mutateAsync({
      name: ruleName.trim(),
      model: ruleModel,
      action: ruleAction,
      ruleType,
      threshold,
    })
    setRuleName("")
    setShowRuleForm(false)
  }

  return (
    <div className="space-y-6" data-testid="module-view-approvals">
      <DashboardHeader
        title="Approvals Inbox"
        description="Unified queue for threshold-gated ERP actions and AI action drafts awaiting review."
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {pendingRequests.length} pending request{pendingRequests.length === 1 ? "" : "s"}
        </span>
        {aiDraftCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            {aiDraftCount} AI draft{aiDraftCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {inboxQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <Link href="/workflows" className="text-primary hover:underline">
          Workflow definitions
        </Link>
      </div>

      {pendingRequests.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No pending approvals. Threshold rules on purchase orders, sales discounts, bills, and payments appear here when blocked.
        </div>
      ) : (
        <div className="grid gap-4">
          {pendingRequests.map((row) => {
            const requestId = Number(row.id)
            const model = row.model ?? ""
            const resId = Number(row.resId ?? row.res_id ?? 0)
            const recordHref = approvalRecordHref(model, resId)
            const isAiDraft = isAiDraftApprovalRequest(row)
            const contextRaw = row.contextJson ?? row.context_json
            let amountLabel: string | undefined
            if (contextRaw) {
              try {
                const ctx = JSON.parse(contextRaw) as {
                  amount_total?: number
                  max_discount_percent?: number
                }
                if (typeof ctx.amount_total === "number") {
                  amountLabel = ctx.amount_total.toFixed(2)
                } else if (typeof ctx.max_discount_percent === "number") {
                  amountLabel = `${ctx.max_discount_percent.toFixed(1)}% max discount`
                }
              } catch {
                /* ignore */
              }
            }

            return (
              <div key={requestId} className="rounded-lg border bg-card p-5 space-y-4" data-testid={`approval-card-${requestId}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="font-medium flex items-center gap-2">
                      {row.summary ?? "Approval request"}
                      {isAiDraft ? (
                        <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-normal">
                          <Sparkles className="h-3 w-3" />
                          AI draft
                        </span>
                      ) : null}
                    </h3>
                    <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                      <span className="rounded border px-2 py-0.5 text-xs">{model || "record"}</span>
                      <span>{row.action}</span>
                      {amountLabel ? <span>{amountLabel}</span> : null}
                    </p>
                  </div>
                  {recordHref ? (
                    <Link
                      href={recordHref}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      Open record
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    data-testid={`approval-approve-${requestId}`}
                    onClick={() => void handleApprove(requestId)}
                    disabled={approveRequest.isPending || operatingCompanyId == null}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`approval-reject-${requestId}`}
                    onClick={() => {
                      setRejectingId(rejectingId === requestId ? null : requestId)
                      setRejectReason("")
                    }}
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Reject
                  </Button>
                </div>

                {rejectingId === requestId ? (
                  <div className="border-t pt-4 space-y-3">
                    <textarea
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Reason for rejection (required)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={3}
                      data-testid={`approval-reject-reason-${requestId}`}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!rejectReason.trim() || rejectRequest.isPending}
                      data-testid={`approval-reject-confirm-${requestId}`}
                      onClick={() => void handleReject(requestId)}
                    >
                      Confirm rejection
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Approval rules</h3>
            <p className="text-sm text-muted-foreground">
              Active threshold rules for this organization.
            </p>
          </div>
          <Button size="sm" variant="outline" data-testid="approval-rule-create" onClick={() => setShowRuleForm((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add rule
          </Button>
        </div>

        {(rulesQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No approval rules configured yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(rulesQuery.data ?? []).map((rule) => (
              <li key={String(rule.id)} className="flex flex-wrap items-center gap-2 rounded border px-3 py-2">
                <span className="font-medium">{rule.name}</span>
                <span className="text-muted-foreground">{rule.model}</span>
                <span className="text-muted-foreground">{rule.action}</span>
                <span className="rounded border px-2 py-0.5 text-xs">
                  {rule.ruleType ?? rule.rule_type} ≥ {rule.threshold}
                </span>
                {(rule.isActive ?? rule.is_active) === false ? (
                  <span className="text-xs text-muted-foreground">inactive</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {showRuleForm ? (
          <div className="border-t pt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Name</span>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="PO confirm over 5k"
                data-testid="approval-rule-name"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Model</span>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1"
                value={ruleModel}
                onChange={(e) => {
                  const model = e.target.value
                  setRuleModel(model)
                  if (model === "purchase_order") setRuleAction("confirm_purchase_order")
                  else if (model === "sale_order") setRuleAction("confirm_sales_order")
                  else if (model === "account_move") setRuleAction("post_account_move")
                  else if (model === "account_payment") setRuleAction("post_payment")
                }}
              >
                <option value="purchase_order">purchase_order</option>
                <option value="sale_order">sale_order</option>
                <option value="account_move">account_move</option>
                <option value="account_payment">account_payment</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Action</span>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1"
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Rule type</span>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value)}
              >
                <option value="amount_threshold">amount_threshold</option>
                <option value="discount_percent">discount_percent</option>
              </select>
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Threshold</span>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1"
                value={ruleThreshold}
                onChange={(e) => setRuleThreshold(e.target.value)}
                inputMode="decimal"
                data-testid="approval-rule-threshold"
              />
            </label>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={createRule.isPending || !ruleName.trim()}
                data-testid="approval-rule-submit"
                onClick={() => void handleCreateRule()}
              >
                Save rule
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
