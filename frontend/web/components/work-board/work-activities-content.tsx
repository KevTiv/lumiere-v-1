"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { groupActivityDeadlines } from "./activity-deadline-groups"

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
  const submitting = useRef(false)
  const mounted = useRef(true)
  const pendingReview = useRef<WorkActivityRow | null>(null)
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
  const deadlineGroups = useMemo(() => groupActivityDeadlines(rows, now), [rows, now])
  const groupLabels = {
    overdue: t("workspace.dailyWork.overdue", { defaultValue: "Overdue" }),
    today: t("workspace.dailyWork.today", { defaultValue: "Today" }),
    upcoming: t("workspace.dailyWork.upcoming", { defaultValue: "Upcoming" }),
    undated: t("workspace.dailyWork.undated", { defaultValue: "No due date" }),
    unavailable: t("workspace.dailyWork.deadlineUnavailable", { defaultValue: "Due date unavailable" }),
    completed: t("workspace.dailyWork.completed", { defaultValue: "Completed" }),
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
    complete.isPending
  const canComplete = (row: WorkActivityRow) =>
    row.state === "open" && row.workActions.includes("complete")
  const title = (row: WorkActivityRow) =>
    row.summary || row.workSourceTitle || t("workBoard.followUp")
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
      await complete.mutateAsync({ activity: review })
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
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-3">{t("workBoard.followUp")}</th>
                    <th className="p-3">{t("workBoard.scope")}</th>
                    <th className="p-3">{t("workspace.dailyWork.due", { defaultValue: "Due" })}</th>
                    <th className="p-3">{t("workBoard.statusLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {deadlineGroups.map((group) => <Fragment key={group.id}>
                    <tr className="border-b bg-muted/20">
                      <th scope="rowgroup" colSpan={4} className="px-3 py-2 text-xs font-semibold">{groupLabels[group.id]} <span className="font-normal text-muted-foreground">({group.rows.length})</span></th>
                    </tr>
                    {group.rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3">
                        <button
                          type="button"
                          className="min-h-11 text-left font-medium underline-offset-4 hover:underline"
                          onClick={() => openReview(row)}
                        >
                          {title(row)}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {row.workSourceTitle}
                        </p>
                      </td>
                      <td className="p-3">
                        {t(`workBoard.module.${row.workModule}`)}
                      </td>
                      <td className="p-3 whitespace-nowrap">{row.dateDeadline || (row.dateDeadline === undefined ? groupLabels.unavailable : groupLabels.undated)}</td>
                      <td className="p-3">
                        {row.isDone
                          ? t("workBoard.status.Completed")
                          : t("workBoard.status.Open")}
                      </td>
                    </tr>
                  ))}</Fragment>)}
                </tbody>
              </table>
            </div>
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
      <Sheet
        open={review != null && current != null && !query.isError}
        onOpenChange={(open) => {
          if (!open && !complete.isPending) setReview(null)
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {current ? title(current) : t("workBoard.followUp")}
            </SheetTitle>
            <SheetDescription>{t("workBoard.followUpReview")}</SheetDescription>
          </SheetHeader>
          {review && current && (
            <div className="space-y-4 p-4">
              <Badge variant="secondary">
                {current.isDone
                  ? t("workBoard.status.Completed")
                  : t("workBoard.status.Open")}
              </Badge>
              {href && (
                <p>
                  <Link className="text-sm font-medium underline" href={href}>
                    {t("workBoard.openRecord")}
                  </Link>
                </p>
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
