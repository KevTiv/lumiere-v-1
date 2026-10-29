"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { DashboardHeader, MissingOrganization, Button } from "@lumiere/ui"
import { Textarea } from "@lumiere/ui/components/textarea"
import {
  approvalRecordHref,
  humanTaskCompanyId,
  humanTaskId,
  humanTaskRevision,
  humanTaskSubjectId,
  humanTaskSubjectModel,
  isAiDraftApprovalRequest,
  taskStatusTag,
  useClaimHumanTask,
  useDecideHumanTask,
  useCommentHumanTask,
  useHumanTaskInbox,
  type HumanTaskRow,
} from "@lumiere/query-hooks/hooks/approvals"
import {
  approvalActorOptions,
  approvalSelection,
  resolveApprovalActor,
} from "@lumiere/query-hooks/hooks/approval-controls"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { CheckCircle2, ExternalLink, Hand, Loader2, Sparkles, XCircle } from "lucide-react"
import { approvalInboxTarget, approvalTaskMatchesTarget, approvalSubjectKind } from "./approval-inbox-view"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"

function hasValidOrganizationId(value?: number): value is number {
  return value != null && value > 0
}

export function ApprovalsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <ApprovalsLoaded organizationId={organizationId} />
}

function ApprovalsLoaded({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const { identity } = useErpSession()
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const inboxQuery = useHumanTaskInbox(
    organizationId,
    operatingCompanyId,
    operatingCompanyId != null,
  )
  const claimTask = useClaimHumanTask(organizationId)
  const decideTask = useDecideHumanTask(organizationId)
  const commentTask = useCommentHumanTask(organizationId)

  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [commentingId, setCommentingId] = useState<number | null>(null)
  const [commentText, setCommentText] = useState("")
  const [actingForByTask, setActingForByTask] = useState<Record<number, string>>({})
  useEffect(() => {
    setActionError(null)
    setRejectingId(null)
    setRejectReason("")
    setCommentingId(null)
    setCommentText("")
    setActingForByTask({})
  }, [identity, organizationId, operatingCompanyId])

  const pendingTasks = useMemo(
    () =>
      (inboxQuery.data ?? []).filter((row) => {
        const status = taskStatusTag(row)
        return status === "Open" || status === "Claimed"
      }),
    [inboxQuery.data],
  )

  const aiDraftCount = useMemo(
    () => pendingTasks.filter(isAiDraftApprovalRequest).length,
    [pendingTasks],
  )

  const target = useMemo(
    () => approvalInboxTarget(searchParams.get("model"), searchParams.get("resId")),
    [searchParams],
  )
  const visibleTasks = useMemo(
    () => target ? pendingTasks.filter((row) => approvalTaskMatchesTarget(row, target)) : pendingTasks,
    [pendingTasks, target],
  )

  const busy = claimTask.isPending || decideTask.isPending || commentTask.isPending

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null)
    try { await action() }
    catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("approvals.errors.actionFailed", { defaultValue: "The request could not be completed. Your comment or reason is retained." }))
    }
  }

  const handleClaim = async (row: HumanTaskRow) => {
    if (operatingCompanyId == null) return
    const taskId = humanTaskId(row)
    const requested = Object.hasOwn(actingForByTask, taskId) ? actingForByTask[taskId] : undefined
    const selection = approvalSelection(row, operatingCompanyId, requested)
    await claimTask.mutateAsync({
      companyId: selection.companyId,
      taskId: selection.requestId,
      expectedRevision: selection.expectedTaskRevision,
      actingFor: selection.actingFor,
    })
  }

  const handleDecide = async (
    row: HumanTaskRow,
    decision: "Approve" | "Reject" | "Complete",
    comment?: string,
  ) => {
    if (operatingCompanyId == null) return
    const taskId = humanTaskId(row)
    const requested = Object.hasOwn(actingForByTask, taskId) ? actingForByTask[taskId] : undefined
    const selection = approvalSelection(row, operatingCompanyId, requested)
    await decideTask.mutateAsync({
      companyId: selection.companyId,
      taskId: selection.requestId,
      expectedTaskRevision: selection.expectedTaskRevision,
      expectedInstanceRevision: selection.expectedInstanceRevision,
      decision: { tag: decision },
      actingFor: selection.actingFor,
      comment: comment ?? null,
    })
  }

  const handleReject = async (row: HumanTaskRow) => {
    if (!rejectReason.trim()) return
    await handleDecide(row, "Reject", rejectReason.trim())
    setRejectingId(null)
    setRejectReason("")
  }

  const handleComment = async (row: HumanTaskRow) => {
    if (!commentText.trim()) return
    await commentTask.mutateAsync({
      companyId: humanTaskCompanyId(row),
      taskId: humanTaskId(row),
      expectedRevision: humanTaskRevision(row),
      comment: commentText.trim(),
    })
    setCommentingId(null)
    setCommentText("")
  }

  return (
    <div className="space-y-6" data-testid="module-view-approvals">
      <DashboardHeader
        title={t("approvals.review.title", { defaultValue: "Approval inbox" })}
        description={t("approvals.inboxDescription", { defaultValue: "Review requests for the selected company. Open a record before you approve or reject it." })}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span data-testid="approvals-inbox-count">
          {inboxQuery.isError ? t("approvals.errors.countUnavailable", { defaultValue: "Task count unavailable" }) : inboxQuery.isPending ? t("approvals.loading", { defaultValue: "Loading approval tasks…" }) : t("approvals.approvalsClient.openTaskCount", { count: pendingTasks.length })}
        </span>
        {!inboxQuery.isError && !inboxQuery.isPending && aiDraftCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            {t("approvals.approvalsClient.aiDraftCount", { count: aiDraftCount })}
          </span>
        ) : null}
        {inboxQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <Link href="/workflows" className="text-primary hover:underline">
          {t("approvals.approvalsClient.workflowDefinitions")}{" "}</Link>
      </div>

      {actionError ? <p role="alert" className="break-words text-sm text-destructive">{actionError}</p> : null}
      {operatingCompanyId == null ? (
        <div
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="approvals-inbox-no-company"
        >
          {t("approvals.approvalsClient.selectAnOperatingCompanyToLoadYourAuthorizedTaskInbox")}{" "}</div>
      ) : inboxQuery.isError ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border bg-card p-6 text-sm" data-testid="approvals-inbox-error">
          <p>{t("approvals.errors.loadFailed", { defaultValue: "Approval tasks could not be loaded. Retry before making a decision." })}</p>
          <Button variant="outline" className="self-start" disabled={inboxQuery.isFetching || busy} onClick={() => { void inboxQuery.refetch() }}>{t("common.retry", { defaultValue: "Retry" })}</Button>
        </div>
      ) : inboxQuery.isPending ? (
        <p role="status">{t("approvals.loading", { defaultValue: "Loading approval tasks…" })}</p>
      ) : visibleTasks.length === 0 ? (
        <div
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="approvals-inbox-empty"
        >
          {target
            ? t("approvals.approvalsClient.noOpenApprovalTaskMatches", { value1: target.model, value2: target.resId })
            : t("approvals.approvalsClient.noOpenTasksForThisCompanyGuardedActionsCreateVersionPinned")}
        </div>
      ) : (
        <div className="grid gap-4">
          {visibleTasks.map((row) => {
            const taskId = humanTaskId(row)
            const model = humanTaskSubjectModel(row) ?? ""
            const resId = humanTaskSubjectId(row) ?? 0
            const recordHref = approvalRecordHref(model, resId)
            const isAiDraft = isAiDraftApprovalRequest(row)
            const status = taskStatusTag(row)
            const requireComment =
              row.requireCommentOnReject ?? row.require_comment_on_reject ?? false
            const requestedActor = Object.hasOwn(actingForByTask, taskId)
              ? actingForByTask[taskId]
              : undefined
            const selectedActor = resolveApprovalActor(row, requestedActor)
            const actorOptions = approvalActorOptions(row)
            const needsActorSelection = selectedActor == null
            const showActorSelection = row.directlyEligible !== true || actorOptions.length > 0
            const kind = approvalSubjectKind(model)
            const kindLabels = {
              purchaseOrder: t("approvals.review.kinds.purchaseOrder", { defaultValue: "Purchase order" }),
              salesOrder: t("approvals.review.kinds.salesOrder", { defaultValue: "Sales order" }),
              accountingDocument: t("approvals.review.kinds.accountingDocument", { defaultValue: "Accounting document" }),
              payment: t("approvals.review.kinds.payment", { defaultValue: "Payment" }),
              expenseReport: t("approvals.review.kinds.expenseReport", { defaultValue: "Expense report" }),
              aiDraft: t("approvals.review.kinds.aiDraft", { defaultValue: "AI draft" }),
              record: t("approvals.review.kinds.record", { defaultValue: "Business record" }),
            }

            return (
              <div
                key={`${identity}:${operatingCompanyId}:${taskId}:${humanTaskRevision(row)}`}
                className="space-y-4 rounded-lg border bg-card p-5"
                data-testid={`approval-card-${taskId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="flex items-center gap-2 font-medium">
                      {kindLabels[kind]} {resId > 0 ? `#${resId}` : ""}
                      {isAiDraft ? (
                        <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-normal">
                          <Sparkles className="h-3 w-3" />
                          {t("approvals.review.kinds.aiDraft")}{" "}</span>
                      ) : null}
                    </h3>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="rounded border px-2 py-0.5 text-xs">{status}</span>
                      <span className="rounded border px-2 py-0.5 text-xs">
                        {t("approvals.approvalsClient.rev")}{" "}{humanTaskRevision(row)}
                      </span>
                    </p>
                  </div>
                  {recordHref ? (
                    <Link
                      href={recordHref}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      {t("messages.workspace.openRecord")}{" "}<ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </div>

                <details className="group rounded-lg border p-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary" data-testid={`approval-review-${taskId}`}>
                    {t("approvals.review.open", { defaultValue: "Review assignment" })}
                  </summary>
                  <div className="space-y-4 border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      {recordHref
                        ? t("approvals.review.sourceHint", { defaultValue: "Open the source record to check its current details before deciding. A decision may execute the business action requested by this workflow." })
                        : t("approvals.review.sourceUnavailable", { defaultValue: "A source record link is unavailable for this request. Review the request in its owning workspace before deciding." })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {status === "Open"
                        ? t("approvals.review.openHint", { defaultValue: "This assignment is open. Claim it before deciding if the workflow requires a claimant." })
                        : t("approvals.review.claimedHint", { defaultValue: "This assignment has been claimed. Check the source record and your selected acting principal before deciding." })}
                    </p>
                <div className="flex flex-wrap gap-2">
                  {showActorSelection ? (
                    <label className="flex items-center gap-2 text-sm">
                      {t("purchasing.ops.actingAs")}{" "}<Select
                        value={String(selectedActor ?? "") || "__none__"}
                        onValueChange={(selectValue) => {
                          const nextValue = selectValue === "__none__" ? "" : selectValue
                          setActingForByTask((current) => ({
                            ...current,
                            [taskId]: nextValue,
                          }))
                        }}
                        disabled={busy}
                      >
                        <SelectTrigger
                          className="rounded border bg-background px-2 py-1"
                          data-testid={`approval-acting-for-${taskId}`}
                          aria-label={t("workBoard.actingAs")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {row.directlyEligible === true ? <SelectItem value={"__none__"}>{t("purchasing.ops.myself")}</SelectItem> : null}
                          {row.directlyEligible !== true && needsActorSelection ? (
                            <SelectItem value={"__none__"}>{t("purchasing.ops.selectPrincipal")}</SelectItem>
                          ) : null}
                          {actorOptions.map((option) => (
                            <SelectItem key={option.identityHex} value={String(option.identityHex)}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : null}
                  {status === "Open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`approval-claim-${taskId}`}
                      onClick={() => void runAction(() => handleClaim(row))}
                      disabled={busy || needsActorSelection}
                    >
                      <Hand className="mr-1.5 h-4 w-4" />
                      {t("aiHarness.evidenceReviewer.claim")}{" "}</Button>
                  ) : null}
                  <Button
                    size="sm"
                    data-testid={`approval-approve-${taskId}`}
                    onClick={() => void runAction(() => handleDecide(row, "Approve"))}
                    disabled={busy || needsActorSelection}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    {t("purchasing.actions.approveSelected")}{" "}</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`approval-reject-${taskId}`}
                    onClick={() => {
                      setRejectingId(rejectingId === taskId ? null : taskId)
                      setCommentingId(null)
                      setRejectReason("")
                    }}
                    disabled={busy || needsActorSelection}
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    {t("purchasing.actions.rejectSelected")}{" "}</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`approval-comment-${taskId}`}
                    onClick={() => {
                      setCommentingId(commentingId === taskId ? null : taskId)
                      setRejectingId(null)
                      setCommentText("")
                    }}
                    disabled={busy}
                  >
                    {t("messages.messages.filters.messageType.options.comment")}{" "}</Button>
                </div>

                {needsActorSelection ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {t("approvals.approvalsClient.selectACurrentlyEligiblePrincipalBeforeClaimingOrDecidingThisTask")}{" "}</p>
                ) : null}

                {commentingId === taskId ? (
                  <div className="space-y-3 border-t pt-4">
                    <Textarea
                      placeholder={t("approvals.approvalsClient.addAnEvidenceComment")}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={3}
                      data-testid={`approval-comment-text-${taskId}`}
                    />
                    <Button
                      size="sm"
                      disabled={!commentText.trim() || busy}
                      data-testid={`approval-comment-confirm-${taskId}`}
                      onClick={() => void runAction(() => handleComment(row))}
                    >
                      {t("approvals.approvalsClient.saveComment")}{" "}</Button>
                  </div>
                ) : null}

                {rejectingId === taskId ? (
                  <div className="space-y-3 border-t pt-4">
                    <Textarea
                      placeholder={
                        requireComment
                          ? t("approvals.approvalsClient.reasonForRejectionRequired")
                          : t("approvals.approvalsClient.optionalComment")
                      }
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={3}
                      data-testid={`approval-reject-reason-${taskId}`}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={(requireComment && !rejectReason.trim()) || busy}
                      data-testid={`approval-reject-confirm-${taskId}`}
                      onClick={() => void runAction(() => handleReject(row))}
                    >
                      {t("approvals.approvalsClient.confirmRejection")}{" "}</Button>
                  </div>
                ) : null}
                  </div>
                </details>
              </div>
            )
          })}
        </div>
      )}

      <section className="space-y-2 rounded-lg border bg-card p-5">
        <h3 className="font-medium">{t("approvals.approvalsClient.workflowPolicy")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("approvals.approvalsClient.approvalRulesArePublishedWorkflowVersionsWithHumanTaskNodesCreate")}{" "}
          <Link href="/workflows" className="text-primary hover:underline">
            {t("nav.workflows")}{" "}</Link>{" "}
          {t("approvals.approvalsClient.module")}{" "}</p>
      </section>
    </div>
  )
}
