"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { approvalRecordHref } from "@lumiere/query-hooks/hooks/approvals"
import {
  workTeamKey,
  type WorkBoardScope,
} from "@lumiere/query-hooks/hooks/work-board-model"
import {
  useCompleteWorkActivity,
  useWorkActivities,
  type WorkActivityRow,
} from "@lumiere/query-hooks/hooks/work-activities"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@lumiere/ui/components/select"
import { groupActivityDeadlines } from "./activity-deadline-groups"
import {
  WorkActivityBatchReview,
  type ActivityBatchEntry,
} from "./work-activity-batch-review"
import { recordFollowupHref } from "./workflow-work-queue"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"

const MAX_BATCH_SIZE = 20
const canComplete = (row: WorkActivityRow) =>
  row.state === "open" && row.workActions.includes("complete")

export function WorkActivitiesContent({
  scope,
  online,
  layout,
  navigationPending = false,
  authorityRefreshing = false,
  onTeamChange,
}: {
  scope: WorkBoardScope
  online: boolean
  layout: "board" | "list"
  navigationPending?: boolean
  authorityRefreshing?: boolean
  onTeamChange: (team: string | null) => void
}) {
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const ownership = (row: WorkActivityRow) => row.workAssignedToMe
    ? t("workBoard.mineBadge")
    : row.workIsAssigned ? t("workBoard.assigned", { defaultValue: "Assigned" }) : t("tasks.assignee.unassigned")
  const query = useWorkActivities(scope, online)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const complete = useCompleteWorkActivity(scope)
  const [review, setReview] = useState<WorkActivityRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [batch, setBatch] = useState<ActivityBatchEntry[] | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const [runningId, setRunningId] = useState<number | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const pendingReview = useRef<WorkActivityRow | null>(null)
  const liveAccess = useRef({ available: false, layout })
  liveAccess.current = {
    available:
      online && !navigationPending && !authorityRefreshing && !query.isError,
    layout,
  }
  const canDispatch = () =>
    mounted.current && liveAccess.current.available && navigator.onLine
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pendingReview.current = null
    }
  }, [])
  const rows = useMemo(
    () =>
      query.isError
        ? []
        : Array.from(
            new Map(
              (query.data?.pages.flatMap((page) => page.data) ?? []).map(
                (row) => [row.id, row],
              ),
            ).values(),
          ),
    [query.data, query.isError],
  )
  const deadlineGroups = useMemo(() => groupActivityDeadlines(rows, now), [rows, now],
  )
  const groupLabels = {
    overdue: t("workspace.dailyWork.overdue", { defaultValue: "Overdue" }),
    today: t("workspace.dailyWork.today", { defaultValue: "Today" }),
    upcoming: t("workspace.dailyWork.upcoming", { defaultValue: "Upcoming" }),
    undated: t("workspace.dailyWork.undated", { defaultValue: "No due date" }),
    unavailable: t("workspace.dailyWork.deadlineUnavailable", { defaultValue: "Due date unavailable",
    }),
    completed: t("workspace.dailyWork.completed", { defaultValue: "Completed",
    }),
  }
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
  const current = review ? rows.find((row) => row.id === review.id) : undefined
  useEffect(() => {
    if (review && (query.isError || (!query.isPending && !current))) {
      setReview(null)
      setError(null)
      setNotice(null)
      pendingReview.current = null
    }
  }, [current, query.isError, query.isPending, review])
  const stale =
    !!review &&
    (!current ||
      current.updatedAt !== review.updatedAt ||
      current.state !== review.state ||
      current.resId !== review.resId ||
      current.resModel !== review.resModel)
  const disabled =
    navigationPending ||
    authorityRefreshing ||
    !online ||
    query.isError ||
    query.isFetching ||
    complete.isPending ||
    batchRunning
  const title = (row: WorkActivityRow) =>
    row.summary || row.workSourceTitle || t("workBoard.followUp")
  const deadline = (row: WorkActivityRow) =>
    row.dateDeadline ||
    (row.dateDeadline === undefined
      ? groupLabels.unavailable
      : groupLabels.undated)
  const selectedRows = deadlineGroups.flatMap(({ rows }) =>
    rows.filter((row) => selected.includes(row.id) && canComplete(row)),
  )
  useEffect(() => {
    if (!query.isSuccess) return
    const eligibleIds = new Set(rows.filter(canComplete).map((row) => row.id))
    setSelected((previous) => {
      const available = previous.filter((id) => eligibleIds.has(id))
      return available.length === previous.length ? previous : available
    })
  }, [query.isSuccess, rows])
  useEffect(() => {
    if (layout !== "list") {
      setBatch(null)
      setSelected([])
    }
  }, [layout])
  const runBatch = async (entries: readonly ActivityBatchEntry[]) => {
    if (disabled || submitting.current || !canDispatch()
    )
      return
    submitting.current = true
    setBatchRunning(true)
    const canDispatchBatch = () =>
      canDispatch() && liveAccess.current.layout === "list"
    try {
      for (const { activity } of entries) {
        if (!mounted.current) return
        setRunningId(activity.id)
        let result: ActivityBatchEntry
        try {
          if (!canDispatchBatch())
            throw new Error(t("workBoard.batch.interrupted"))
          await complete.mutateAsync({ activity,
            canDispatch: canDispatchBatch,
          })
          result = { activity, status: "completed" }
        } catch (cause) {
          result = {
            activity,
            status: "failed",
            error:
              cause instanceof Error ? cause.message : t("workBoard.updateFailed"),
          }
        }
        if (!mounted.current) return
        setBatch(
          (previous) =>
            previous?.map((entry) =>
              entry.activity.id === activity.id ? result : entry,
            ) ?? null,
        )
        if (result.status === "completed") {
          setSelected((previous) => previous.filter((id) => id !== activity.id))
        }
      }
    } finally {
      submitting.current = false
      if (mounted.current) {
        setRunningId(null)
        setBatchRunning(false)
      }
    }
  }
  const openReview = (row: WorkActivityRow) => {
    setReview(row)
    setError(null)
    setNotice(null)
  }
  const submit = async () => {
    if (
      !review ||
      !current ||
      stale ||
      disabled ||
      submitting.current ||
      !canComplete(current)
    )
      return
    submitting.current = true
    pendingReview.current = review
    setError(null)
    try {
      await complete.mutateAsync({ activity: review, canDispatch })
      if (!mounted.current || pendingReview.current !== review) return
      setReview(null)
      setNotice(t("workBoard.followUpCompleted"))
    } catch (cause) {
      if (!mounted.current || pendingReview.current !== review) return
      setError(
        cause instanceof Error ? cause.message : t("workBoard.updateFailed"),
      )
    } finally {
      pendingReview.current = null
      if (mounted.current) await query.refetch()
      submitting.current = false
    }
  }
  const href = current
    ? approvalRecordHref(current.resModel, current.resId)
    : undefined
  const followupHref =
    current && checkPermission("activity", "create").allowed
      ? recordFollowupHref(current.resModel, current.resId)
    : undefined
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t("workBoard.followUpsDescription")}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-xs font-medium">
          {t("workBoard.team")}
          <Select
            value={String(scope.team ?? "") || "__none__"}
            onValueChange={(selectValue) => {
              const nextValue = selectValue === "__none__" ? "" : selectValue
              onTeamChange(nextValue || null)
            }}
            disabled={navigationPending}
          >
            <SelectTrigger
              className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
              aria-label={t("workBoard.team")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={"__none__"}>{t("workBoard.allTeams")}</SelectItem>
              {scope.team && !teams.some((team) => workTeamKey(team) === scope.team) && (
                <SelectItem value={String(scope.team)}>{scope.team}</SelectItem>
              )}
              {teams.map((team) => (
                <SelectItem key={workTeamKey(team)} value={String(workTeamKey(team))}>
                  {team.label || t("workBoard.teamKind.department", { id: team.id })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center gap-3">
          <p role="status" className="text-xs text-muted-foreground">
            {t("workBoard.loaded", { count: rows.length })}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
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
          <Button
            variant="outline"
            disabled={!online || query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("workBoard.refresh")}
          </Button>
        </div>
      ) : query.isPending ? (
        <p role="status">{t("workBoard.loading")}</p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {query.hasNextPage
                ? t("workBoard.moreToSearch")
                : t("workBoard.emptyFollowUps")}
            </p>
          )}
          {layout === "board" ? (
            <KanbanBoard<WorkActivityRow>
              columns={[
                { id: "open", title: t("workBoard.status.Open") },
                { id: "done", title: t("workBoard.status.Completed") },
              ]}
              items={rows}
              getItemId={(row) => String(row.id)}
              getColumnId={(row) => row.state}
              isItemDraggable={(row) => !disabled && canComplete(row)}
              canMove={(row, column) =>
                !disabled && column === "done" && canComplete(row)
              }
              isItemPending={(row) =>
                complete.isPending && review?.id === row.id
              }
              moveDisabledReason={(row) =>
                !online
                  ? t("workBoard.offline")
                  : disabled
                    ? t("workBoard.refreshing")
                    : !canComplete(row)
                      ? t("workBoard.reviewActions")
                      : undefined
              }
              onMove={({ item }) => openReview(item)}
              onItemClick={openReview}
              renderCard={(row) => (
                <KanbanCardContent
                  title={title(row)}
                  subtitle={row.workSourceTitle}
                  priority={{
                    label: t(`workBoard.module.${row.workModule}`),
                    tone: "neutral",
                  }}
                  dueLabel={row.dateDeadline ?? undefined}
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
            <>
              {rows.some(canComplete) && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || selectedRows.length === 0}
                    onClick={() =>
                      setBatch(
                        selectedRows.map((activity) => ({
                          activity,
                          status: "ready",
                        })),
                      )
                    }
                  >
                    {t("workBoard.batch.review", {
                      total: selectedRows.length,
                    })}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("workBoard.batch.limit", { limit: MAX_BATCH_SIZE })}
                  </span>
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th scope="col" className="w-10 ps-3">
                        <span className="sr-only">
                          {t("workBoard.batch.selectColumn")}
                        </span>
                      </th>
                    <th className="p-3">{t("workBoard.followUp")}</th>
                    <th className="p-3">{t("workBoard.scope")}</th>
                      <th className="p-3">
                        {t("workspace.dailyWork.due", { defaultValue: "Due" })}</th>
                    <th scope="col" className="p-3">{t("workBoard.statusLabel")}</th>
                  </tr>
                </thead>
                  {deadlineGroups.map((group) => (
                    <tbody key={group.id}>
                    <tr className="border-b bg-muted/20">
                      <th scope="rowgroup" colSpan={5} className="px-3 py-2 text-xs font-semibold">{groupLabels[group.id]}{" "}
                          <span className="font-normal text-muted-foreground">({group.rows.length})</span></th>
                    </tr>
                    {group.rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                          <td className="ps-3">
                            {canComplete(row) && (
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                aria-label={t("workBoard.batch.selectItem", {
                                  title: title(row),
                                })}
                                checked={selected.includes(row.id)}
                                disabled={
                                  disabled ||
                                  (!selected.includes(row.id) &&
                                    selectedRows.length >= MAX_BATCH_SIZE)
                                }
                                onChange={(event) => {
                                  const checked = event.target.checked
                                  setSelected((previous) => {
                                    if (!checked)
                                      return previous.filter(
                                        (id) => id !== row.id,
                                      )
                                    if (
                                      previous.length >= MAX_BATCH_SIZE ||
                                      previous.includes(row.id)
                                    )
                                      return previous
                                    return [...previous, row.id]
                                  })
                                }}
                              />
                            )}
                          </td>
                      <td className="p-3">
                        <button
                          type="button"
                          className="min-h-11 text-left font-medium underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                          onClick={() => openReview(row)}
                        >
                          {title(row)}
                        </button>
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.workSourceTitle}</p>
                        <p className="text-xs text-muted-foreground">{ownership(row)}</p>
                      </td>
                      <td className="p-3">
                        {t(`workBoard.module.${row.workModule}`)}
                      </td>
                      <td className="p-3 whitespace-nowrap">{deadline(row)}</td>
                      <td className="p-3">
                        {row.isDone
                          ? t("workBoard.status.Completed")
                          : t("workBoard.status.Open")}
                            {!row.isDone && (
                              <p className="text-xs text-muted-foreground">
                                {t(
                                  canComplete(row)
                                    ? "workBoard.nextStep.reviewCompletion"
                                    : "workBoard.nextStep.inspect",
                                )}
                              </p>
                            )}
                          </td>
                    </tr>
                  ))}</tbody>
                  ))}
                </table>
            </div>
            </>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? t("workBoard.loading")
                : t("workBoard.loadMore")}
            </Button>
          )}
        </>
      )}
      <WorkActivityBatchReview
        entries={query.isError || authorityRefreshing ? null : batch}
        runningId={runningId}
        busy={batchRunning}
        disabled={disabled}
        title={title}
        details={(row) =>
          [
            row.workSourceTitle,
            t(`workBoard.module.${row.workModule}`),
            ownership(row),
            deadline(row),
          ]
            .filter(Boolean)
            .join(" · ")
        }
        currentActivity={(id) => rows.find((row) => row.id === id)}
        onClose={() => setBatch(null)}
        onSubmit={(entries) => void runBatch(entries)}
      />
      <Sheet
        open={review != null && current != null && !query.isError}
        onOpenChange={(open) => {
          if (!open && !complete.isPending) setReview(null)
        }}
      >
        <SheetContent size="record">
          <SheetHeader>
            <SheetTitle>
              {current ? title(current) : t("workBoard.followUp")}
            </SheetTitle>
            <SheetDescription>{t("workBoard.followUpReview")}</SheetDescription>
          </SheetHeader>
          {review && current && (
            <div className="space-y-4 p-4 [overflow-wrap:anywhere]">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{ownership(current)}</span>
                <span aria-hidden="true">·</span>
                <span>{deadline(current)}</span>
              </div>
              <Badge variant="secondary">
                {current.isDone
                  ? t("workBoard.status.Completed")
                  : t("workBoard.status.Open")}
              </Badge>
              {href && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <Link className="text-sm font-medium underline" href={href}>
                    {t("workBoard.openRecord")}
                  </Link>
                  {followupHref && (
                    <Link
                      className="text-sm font-medium underline"
                      href={followupHref}
                    >
                      {t("workBoard.scheduleOnRecord")}
                    </Link>
                  )}
                </div>
              )}
              {stale ? (
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
              ) : current && canComplete(current) ? (
                <Button disabled={disabled} onClick={() => void submit()}>
                  {complete.isPending
                    ? t("workBoard.saving")
                    : t("workBoard.action.complete")}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("workBoard.noActions")}
                </p>
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
