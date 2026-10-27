"use client"

import { useMemo, useState } from "react"
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
import { approvalInboxTarget, approvalTaskMatchesTarget } from "./approval-inbox-view"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"

function hasValidOrganizationId(value?: number): value is number {
  return value != null && value > 0
}

function taskTitle(row: HumanTaskRow): string {
  const model = humanTaskSubjectModel(row) ?? "record"
  const subjectId = humanTaskSubjectId(row)
  const node = row.nodeKey ?? row.node_key
  if (subjectId != null) {
    return node ? `${model} #${subjectId} · ${node}` : `${model} #${subjectId}`
  }
  return node ? String(node) : `Task #${humanTaskId(row)}`
}

export function ApprovalsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <ApprovalsLoaded organizationId={organizationId} />
}

function ApprovalsLoaded({ organizationId }: { organizationId: number }) {
  const searchParams = useSearchParams()
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const inboxQuery = useHumanTaskInbox(
    organizationId,
    operatingCompanyId,
    operatingCompanyId != null,
  )
  const claimTask = useClaimHumanTask(organizationId)
  const decideTask = useDecideHumanTask(organizationId)
  const commentTask = useCommentHumanTask(organizationId)

  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [commentingId, setCommentingId] = useState<number | null>(null)
  const [commentText, setCommentText] = useState("")
  const [actingForByTask, setActingForByTask] = useState<Record<number, string>>({})

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
        title="Task inbox"
        description="Company-scoped human tasks for guarded actions. Claim, comment, then approve or reject with revision checks."
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span data-testid="approvals-inbox-count">
          {pendingTasks.length} open task{pendingTasks.length === 1 ? "" : "s"}
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

      {operatingCompanyId == null ? (
        <div
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="approvals-inbox-no-company"
        >
          Select an operating company to load your authorized task inbox.
        </div>
      ) : visibleTasks.length === 0 ? (
        <div
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="approvals-inbox-empty"
        >
          {target
            ? `No open approval task matches ${target.model} #${target.resId}.`
            : "No open tasks for this company. Guarded actions create version-pinned human tasks when approval is required."}
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

            return (
              <div
                key={taskId}
                className="space-y-4 rounded-lg border bg-card p-5"
                data-testid={`approval-card-${taskId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="flex items-center gap-2 font-medium">
                      {taskTitle(row)}
                      {isAiDraft ? (
                        <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-normal">
                          <Sparkles className="h-3 w-3" />
                          AI draft
                        </span>
                      ) : null}
                    </h3>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="rounded border px-2 py-0.5 text-xs">{status}</span>
                      <span className="rounded border px-2 py-0.5 text-xs">
                        rev {humanTaskRevision(row)}
                      </span>
                      {model ? (
                        <span className="rounded border px-2 py-0.5 text-xs">{model}</span>
                      ) : null}
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
                  {showActorSelection ? (
                    <label className="flex items-center gap-2 text-sm">
                      Acting as
                      <Select
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
                          aria-label={"Acting as"}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {row.directlyEligible === true ? <SelectItem value={"__none__"}>Myself</SelectItem> : null}
                          {row.directlyEligible !== true && needsActorSelection ? (
                            <SelectItem value={"__none__"}>Select an eligible principal</SelectItem>
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
                      onClick={() => void handleClaim(row)}
                      disabled={busy || needsActorSelection}
                    >
                      <Hand className="mr-1.5 h-4 w-4" />
                      Claim
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    data-testid={`approval-approve-${taskId}`}
                    onClick={() => void handleDecide(row, "Approve")}
                    disabled={busy || needsActorSelection}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Approve
                  </Button>
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
                    Reject
                  </Button>
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
                    Comment
                  </Button>
                </div>

                {needsActorSelection ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    Select a currently eligible principal before claiming or deciding this task.
                  </p>
                ) : null}

                {commentingId === taskId ? (
                  <div className="space-y-3 border-t pt-4">
                    <Textarea
                      placeholder="Add an evidence comment"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={3}
                      data-testid={`approval-comment-text-${taskId}`}
                    />
                    <Button
                      size="sm"
                      disabled={!commentText.trim() || busy}
                      data-testid={`approval-comment-confirm-${taskId}`}
                      onClick={() => void handleComment(row)}
                    >
                      Save comment
                    </Button>
                  </div>
                ) : null}

                {rejectingId === taskId ? (
                  <div className="space-y-3 border-t pt-4">
                    <Textarea
                      placeholder={
                        requireComment
                          ? "Reason for rejection (required)"
                          : "Optional comment"
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
                      onClick={() => void handleReject(row)}
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

      <section className="space-y-2 rounded-lg border bg-card p-5">
        <h3 className="font-medium">Workflow policy</h3>
        <p className="text-sm text-muted-foreground">
          Approval rules are published workflow versions with human-task nodes. Create and publish
          definitions in the{" "}
          <Link href="/workflows" className="text-primary hover:underline">
            Workflows
          </Link>{" "}
          module.
        </p>
      </section>
    </div>
  )
}
