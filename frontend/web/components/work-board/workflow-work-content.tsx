"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { KanbanBoard } from "@lumiere/ui/kanban/kanban-board"
import { KanbanCardContent } from "@lumiere/ui/kanban/kanban-card"
import { Badge } from "@lumiere/ui/components/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@lumiere/ui/components/sheet"
import { Textarea } from "@lumiere/ui/components/textarea"
import { useWorkBoard } from "@lumiere/query-hooks/hooks/work-board"
import {
  WORK_STATUSES,
  canMoveWorkTask,
  workActionForColumn,
  workActionsForActor,
  workStatus,
  workTeamKey,
  type WorkAction,
  type WorkBoardScope,
  type WorkTaskRow,
} from "@lumiere/query-hooks/hooks/work-board-model"
import {
  approvalActorOptions,
  approvalSelection,
  requireUnchangedApproval,
  resolveApprovalActor,
} from "@lumiere/query-hooks/hooks/approval-controls"
import {
  approvalRecordHref,
  useClaimHumanTask,
  useDecideHumanTask,
} from "@lumiere/query-hooks/hooks/approvals"

const selectClass =
  "h-9 max-w-full rounded-md border bg-background px-2 text-sm"

function taskTitle(row: WorkTaskRow): string {
  return (
    row.workSourceTitle ||
    `${row.subjectModel ?? row.subject_model ?? ""} #${row.subjectId ?? row.subject_id ?? row.id}`
  )
}

export function WorkflowWorkContent({
  scope,
  online,
  layout,
  navigationPending = false,
  onTeamChange,
}: {
  scope: WorkBoardScope
  online: boolean
  layout: "board" | "list"
  navigationPending?: boolean
  onTeamChange: (team: string | null) => void
}) {
  const { t } = useTranslation()
  const query = useWorkBoard(scope, online)
  const claim = useClaimHumanTask(scope.organizationId)
  const decide = useDecideHumanTask(scope.organizationId)
  const [review, setReview] = useState<{
    row: WorkTaskRow
    action?: WorkAction
  } | null>(null)
  const [actor, setActor] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const submitting = useRef(false)
  // Failed refreshes hide retained cache data, including counts and the review sheet.
  const rows = useMemo(
    () =>
      query.isError
        ? []
        : Array.from(
            new Map(
              (query.data?.pages.flatMap((page) => page.data) ?? []).map(
                (row) => [String(row.id), row],
              ),
            ).values(),
          ),
    [query.data, query.isError],
  )
  const teams = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .flatMap((row) => row.workTeamRefs)
            .map((team) => [workTeamKey(team), team]),
        ).values(),
      ),
    [rows],
  )
  const busy = claim.isPending || decide.isPending
  const disabled =
    navigationPending || !online || query.isFetching || query.isError || busy
  const columns = WORK_STATUSES.map((status) => ({
    id: status,
    title: t(`workBoard.status.${status}`),
  }))
  const current = review
    ? rows.find((row) => String(row.id) === String(review.row.id))
    : undefined
  let stale = false
  if (
    review &&
    current &&
    actor != null &&
    (workStatus(review.row) === "Open" || workStatus(review.row) === "Claimed")
  ) {
    try {
      requireUnchangedApproval(
        approvalSelection(review.row, scope.companyId, actor),
        current,
      )
    } catch {
      stale = true
    }
  }
  const actions = current && !stale ? workActionsForActor(current, actor) : []
  const openReview = (row: WorkTaskRow, action?: WorkAction) => {
    setReview({ row, action })
    setActor(resolveApprovalActor(row))
    setComment("")
    setError(null)
    setNotice(null)
  }
  const submit = async (action: WorkAction) => {
    if (!review || !current || disabled || submitting.current) return
    submitting.current = true
    setError(null)
    try {
      const selection = approvalSelection(review.row, scope.companyId, actor)
      requireUnchangedApproval(selection, current)
      if (!workActionsForActor(current, actor).includes(action))
        throw new Error(t("workBoard.actionDenied"))
      if (
        action === "reject" &&
        (current.requireCommentOnReject ?? current.require_comment_on_reject) &&
        !comment.trim()
      )
        throw new Error(t("workBoard.commentRequired"))
      if (action === "claim") {
        await claim.mutateAsync({
          companyId: selection.companyId,
          taskId: selection.requestId,
          expectedRevision: selection.expectedTaskRevision,
          actingFor: selection.actingFor,
        })
      } else {
        await decide.mutateAsync({
          companyId: selection.companyId,
          taskId: selection.requestId,
          expectedTaskRevision: selection.expectedTaskRevision,
          expectedInstanceRevision: selection.expectedInstanceRevision,
          actingFor: selection.actingFor,
          decision: {
            tag:
              action === "approve"
                ? "Approve"
                : action === "reject"
                  ? "Reject"
                  : "Complete",
          },
          comment: comment.trim() || null,
        })
      }
      setReview(null)
      setNotice(t("workBoard.updated"))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("workBoard.updateFailed"),
      )
    } finally {
      // Response loss can follow a committed command. Reconcile instead of moving optimistically.
      await query.refetch()
      submitting.current = false
    }
  }
  const reason = (row: WorkTaskRow) =>
    !online
      ? t("workBoard.offline")
      : disabled
        ? t("workBoard.refreshing")
        : workActionsForActor(row).length === 0
          ? t("workBoard.reviewActions")
          : undefined
  const href = review
    ? approvalRecordHref(
        review.row.subjectModel ?? review.row.subject_model,
        review.row.subjectId ?? review.row.subject_id,
      )
    : undefined
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-xs font-medium">
          {t("workBoard.team")}
          <select
            className={selectClass}
            value={scope.team ?? ""}
            disabled={navigationPending}
            onChange={(event) => onTeamChange(event.target.value || null)}
          >
            <option value="">{t("workBoard.allTeams")}</option>
            {scope.team &&
              !teams.some((team) => workTeamKey(team) === scope.team) && (
                <option value={scope.team}>{scope.team}</option>
              )}
            {teams.map((team) => (
              <option key={workTeamKey(team)} value={workTeamKey(team)}>
                {team.label ||
                  t(`workBoard.teamKind.${team.kind}`, { id: team.id })}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground" role="status">
            {t("workBoard.loaded", { count: rows.length })}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!online || query.isFetching || busy}
            onClick={() => void query.refetch()}
          >
            {t("workBoard.refresh")}
          </Button>
        </div>
      </div>
      {!online && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("workBoard.offline")}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {query.isError ? (
        <div role="alert" className="rounded-lg border border-destructive p-4">
          <p>{t("workBoard.readFailed")}</p>
          <p className="text-sm">{query.error.message}</p>
        </div>
      ) : query.isPending ? (
        <p role="status">{t("workBoard.loading")}</p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {query.hasNextPage
                ? t("workBoard.moreToSearch")
                : t("workBoard.empty")}
            </p>
          )}
          {layout === "board" ? (
            <KanbanBoard<WorkTaskRow>
              columns={columns}
              items={rows}
              getItemId={(row) => String(row.id)}
              getColumnId={(row) => workStatus(row) ?? ""}
              isItemDraggable={(row) =>
                !disabled && workActionsForActor(row).length > 0
              }
              canMove={(row, column) =>
                !disabled && canMoveWorkTask(row, column)
              }
              isItemPending={(row) =>
                busy && String(review?.row.id) === String(row.id)
              }
              moveDisabledReason={reason}
              onMove={({ item, toColumnId }) => {
                const action = workActionForColumn(toColumnId)
                if (action) openReview(item, action)
              }}
              onMoveError={(cause) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : t("workBoard.updateFailed"),
                )
              }
              onItemClick={(row) => openReview(row)}
              renderCard={(row) => (
                <KanbanCardContent
                  title={taskTitle(row)}
                  subtitle={row.nodeKey ?? row.node_key}
                  priority={{
                    label: t(`workBoard.module.${row.workModule}`),
                    tone: "neutral",
                  }}
                  topRight={
                    row.workAssignedToMe ? (
                      <Badge variant="secondary">
                        {t("workBoard.mineBadge")}
                      </Badge>
                    ) : undefined
                  }
                />
              )}
              labels={{
                emptyColumn: t("workBoard.emptyColumn"),
                moveFailed: t("workBoard.updateFailed"),
                pendingMove: t("workBoard.saving"),
              }}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-3">{t("workBoard.assignment")}</th>
                    <th className="p-3">{t("workBoard.scope")}</th>
                    <th className="p-3">{t("workBoard.statusLabel")}</th>
                    <th className="p-3">{t("workBoard.ownership")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.id)} className="border-b last:border-0">
                      <td className="p-3">
                        <button
                          className="text-left font-medium underline-offset-4 hover:underline"
                          onClick={() => openReview(row)}
                        >
                          {taskTitle(row)}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {row.nodeKey ?? row.node_key}
                        </p>
                      </td>
                      <td className="p-3">
                        {t(`workBoard.module.${row.workModule}`)}
                      </td>
                      <td className="p-3">
                        {t(`workBoard.status.${workStatus(row) ?? "Open"}`)}
                      </td>
                      <td className="p-3">
                        {row.workAssignedToMe
                          ? t("workBoard.mineBadge")
                          : t("workBoard.teamWork")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={!online || query.isFetching || busy}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? t("workBoard.loading")
                : t("workBoard.loadMore")}
            </Button>
          )}
        </>
      )}
      {error && !review && <p role="alert">{error}</p>}
      <Sheet
        open={review != null && !query.isError}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null)
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {review ? taskTitle(review.row) : t("workBoard.assignment")}
            </SheetTitle>
            <SheetDescription>
              {t("workBoard.reviewDescription")}
            </SheetDescription>
          </SheetHeader>
          {review && (
            <div className="space-y-4 p-4">
              <p className="text-sm">
                {review.row.nodeKey ?? review.row.node_key}
              </p>
              <Badge variant="secondary">
                {t(`workBoard.status.${workStatus(review.row) ?? "Open"}`)}
              </Badge>
              {href && (
                <p>
                  <Link className="text-sm font-medium underline" href={href}>
                    {t("workBoard.openRecord")}
                  </Link>
                </p>
              )}
              {approvalActorOptions(review.row).length > 0 && (
                <label className="grid gap-1 text-sm">
                  {t("workBoard.actingAs")}
                  <select
                    className={selectClass}
                    value={actor ?? "select"}
                    disabled={busy}
                    onChange={(event) => {
                      setActor(
                        event.target.value === "select"
                          ? null
                          : event.target.value,
                      )
                      setError(null)
                    }}
                  >
                    <option value="select" disabled>
                      {t("workBoard.selectActor")}
                    </option>
                    {review.row.directlyEligible && (
                      <option value="">{t("workBoard.myself")}</option>
                    )}
                    {approvalActorOptions(review.row).map((option) => (
                      <option
                        key={option.identityHex}
                        value={option.identityHex}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {stale || !current ? (
                <div role="alert" className="space-y-2">
                  <p>{t("workBoard.stale")}</p>
                  {current && (
                    <Button
                      variant="outline"
                      onClick={() => openReview(current)}
                    >
                      {t("workBoard.reviewLatest")}
                    </Button>
                  )}
                </div>
              ) : actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("workBoard.noActions")}
                </p>
              ) : (
                <>
                  {actions.some((action) => action !== "claim") && (
                    <label className="grid gap-2 text-sm">
                      {t("workBoard.comment")}
                      <Textarea
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        disabled={busy}
                        rows={4}
                      />
                    </label>
                  )}
                  {review.action && actions.includes(review.action) && (
                    <p className="text-sm font-medium">
                      {t("workBoard.confirmAction", {
                        action: t(`workBoard.action.${review.action}`),
                      })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <Button
                        key={action}
                        variant={action === "reject" ? "outline" : "default"}
                        disabled={
                          disabled ||
                          (action === "reject" &&
                            !!(
                              current.requireCommentOnReject ??
                              current.require_comment_on_reject
                            ) &&
                            !comment.trim())
                        }
                        onClick={() => void submit(action)}
                      >
                        {busy
                          ? t("workBoard.saving")
                          : t(`workBoard.action.${action}`)}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {!online && <p role="alert">{t("workBoard.offline")}</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
