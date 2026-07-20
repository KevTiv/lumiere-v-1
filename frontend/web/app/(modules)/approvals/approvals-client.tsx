"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { DashboardHeader, MissingOrganization, Button } from "@lumiere/ui"
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
  useHumanTaskInbox,
  type HumanTaskRow,
} from "@lumiere/query-hooks/hooks/approvals"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { CheckCircle2, ExternalLink, Hand, Loader2, Sparkles, XCircle } from "lucide-react"

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
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const inboxQuery = useHumanTaskInbox(
    organizationId,
    operatingCompanyId,
    operatingCompanyId != null,
  )
  const claimTask = useClaimHumanTask(organizationId)
  const decideTask = useDecideHumanTask(organizationId)

  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState("")

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

  const busy = claimTask.isPending || decideTask.isPending

  const handleClaim = async (row: HumanTaskRow) => {
    await claimTask.mutateAsync({
      companyId: humanTaskCompanyId(row),
      taskId: humanTaskId(row),
      expectedRevision: humanTaskRevision(row),
    })
  }

  const handleDecide = async (
    row: HumanTaskRow,
    decision: "Approve" | "Reject" | "Complete",
    comment?: string,
  ) => {
    let expectedTaskRevision = humanTaskRevision(row)
    const status = taskStatusTag(row)
    if (status === "Open") {
      await claimTask.mutateAsync({
        companyId: humanTaskCompanyId(row),
        taskId: humanTaskId(row),
        expectedRevision: expectedTaskRevision,
      })
      expectedTaskRevision += 1
    }
    await decideTask.mutateAsync({
      companyId: humanTaskCompanyId(row),
      taskId: humanTaskId(row),
      expectedTaskRevision,
      expectedInstanceRevision: Number(row.instanceRevision ?? row.instance_revision ?? 0),
      decision: { tag: decision },
      comment: comment ?? null,
    })
  }

  const handleReject = async (row: HumanTaskRow) => {
    if (!rejectReason.trim()) return
    await handleDecide(row, "Reject", rejectReason.trim())
    setRejectingId(null)
    setRejectReason("")
  }

  return (
    <div className="space-y-6" data-testid="module-view-approvals">
      <DashboardHeader
        title="Approvals Inbox"
        description="Authorized human tasks for guarded ERP actions. Claim a task, then approve or reject with revision checks."
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
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
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Select an operating company to load your authorized task inbox.
        </div>
      ) : pendingTasks.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No open tasks for this company. Guarded actions create version-pinned human tasks when
          approval is required.
        </div>
      ) : (
        <div className="grid gap-4">
          {pendingTasks.map((row) => {
            const taskId = humanTaskId(row)
            const model = humanTaskSubjectModel(row) ?? ""
            const resId = humanTaskSubjectId(row) ?? 0
            const recordHref = approvalRecordHref(model, resId)
            const isAiDraft = isAiDraftApprovalRequest(row)
            const status = taskStatusTag(row)
            const requireComment =
              row.requireCommentOnReject ?? row.require_comment_on_reject ?? false

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
                  {status === "Open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`approval-claim-${taskId}`}
                      onClick={() => void handleClaim(row)}
                      disabled={busy}
                    >
                      <Hand className="mr-1.5 h-4 w-4" />
                      Claim
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    data-testid={`approval-approve-${taskId}`}
                    onClick={() => void handleDecide(row, "Approve")}
                    disabled={busy}
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
                      setRejectReason("")
                    }}
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Reject
                  </Button>
                </div>

                {rejectingId === taskId ? (
                  <div className="space-y-3 border-t pt-4">
                    <textarea
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
