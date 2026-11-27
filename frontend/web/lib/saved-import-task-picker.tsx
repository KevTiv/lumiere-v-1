"use client"

import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { TablePager, usePagedRows } from "@lumiere/ui/components/table-pager"
import { FileIdentity } from "@lumiere/ui/components/file-identity"
import { Badge } from "@lumiere/ui/components/badge"
import { Button } from "@lumiere/ui/components/button"
import { apiFetch } from "./api-fetch"
import { listSavedImportTasks } from "./chat-import-task"
import { savedImportGoal, savedImportOperatorState, savedImportQueueLabel, savedImportQueues, type SavedImportQueue } from "./saved-import-operator"
import { useVisibleSavedImportRuns } from "./use-saved-import-runs"
import type { SavedImportScope } from "./use-saved-import-task"

export function useSavedImportTaskList(scope: SavedImportScope) {
  const result = useInfiniteQuery({
    queryKey: [
      "saved-import-tasks",
      scope.organizationId,
      scope.companyId,
      scope.identity,
    ],
    queryFn: ({ pageParam }) =>
      listSavedImportTasks(apiFetch, scope.companyId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: "always",
  })
  return { ...result, scope }
}

export function SavedImportTaskPicker({
  query,
  onSelect,
}: {
  query: ReturnType<typeof useSavedImportTaskList>
  onSelect: (id: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [queue, setQueue] = useState<SavedImportQueue | "all">("all")
  const checking =
    query.isPending || (query.isFetching && !query.isFetchingNextPage)
  const tasks =
    query.isError || checking
      ? []
      : (query.data?.pages.flatMap((page) => page.tasks) ?? [])
  const checkedTasks = tasks.filter(task => task.status === "needs_review").slice(0, 5)
  const runs = useVisibleSavedImportRuns(query.scope, checkedTasks)
  const reads = new Map(checkedTasks.map((task, index) => [task.requestId, runs[index]] as const))
  const rows = tasks.map(task => {
    const run = reads.get(task.requestId)
    const operator = savedImportOperatorState({ task, progress: run?.isSuccess ? run.data ?? undefined : undefined })
    return { task, operator, checkingRun: run?.isPending === true }
  })
  const visible = queue === "all" ? rows : rows.filter(row => !row.checkingRun && row.operator.queue === queue)
  const pager = usePagedRows(visible, queue, 5)
  return (
    <section
      id="continue-import"
      tabIndex={-1}
      className="min-w-0 scroll-mt-6 space-y-3 rounded-lg border p-4"
      aria-label={t("settings.importTask.savedTasks", {
        defaultValue: "Saved import tasks",
      })}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            {t("settings.importTask.savedTasks", {
              defaultValue: "Saved import tasks",
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.importTask.savedTasksHint", {
              defaultValue:
                "Continue files and decisions saved for this company, including imports started in another conversation.",
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("common.refresh", { defaultValue: "Refresh" })}
        </Button>
      </div>
      {tasks.length > 0 && (
        <label className="flex w-fit max-w-full flex-wrap items-center gap-2 text-sm">
          {t("settings.importOperator.filter")}
          <select
            className="min-h-9 rounded-md border bg-background px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring"
            value={queue}
            onChange={event => setQueue(event.currentTarget.value as SavedImportQueue | "all")}
          >
            <option value="all">{t("settings.importOperator.all")}</option>
            {savedImportQueues.map(value => <option key={value} value={value}>{savedImportQueueLabel(t, value)}</option>)}
          </select>
        </label>
      )}
      {checking ? (
        <p role="status" className="text-sm">
          {t("settings.importTask.loading", {
            defaultValue: "Checking saved imports for this company…",
          })}
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {!checking && !query.error && !tasks.length ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.importTask.noSavedTasks", {
            defaultValue:
              "No saved file tasks yet. Choose source files above or attach them in the assistant to start.",
          })}
        </p>
      ) : null}
      {tasks.length > 0 && visible.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {rows.some(row => row.checkingRun) ? t("settings.importOperator.checkingResult") : t("settings.importOperator.noInQueue")}
        </p>
      )}
      {visible.length ? (
        <ul className="divide-y">
          {pager.pageRows.map(({ task, operator, checkingRun }) => {
            const savedAt = new Date(task.createdAt)
            return (
              <li
                key={task.requestId}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="break-words text-sm font-medium">{savedImportGoal(t, task)}</h3>
                  <FileIdentity fileName={task.files[0]?.fileName} />
                  {checkingRun ? (
                    <span className="text-sm text-muted-foreground">{t("settings.importOperator.checkingResult")}</span>
                  ) : (
                    <Badge variant="outline" data-import-queue={operator.queue}>{savedImportQueueLabel(t, operator.queue)}</Badge>
                  )}
                  {task.handoff?.canManage === false ? (
                    <p className="text-sm text-muted-foreground">
                      {t("settings.importHandoff.received")}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {t("settings.importTask.taskPending", {
                      defaultValue:
                        "{{files}} files · {{pending}} source rows need review",
                      files: task.files.length,
                      pending: task.reviews.reduce(
                        (count, review) => count + review.pending,
                        0,
                      ),
                    })}
                    {Number.isFinite(savedAt.getTime()) ? (
                      <>
                        {" "}
                        ·{" "}
                        <time dateTime={savedAt.toISOString()}>
                          {new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: "medium",
                          }).format(savedAt)}
                        </time>
                      </>
                    ) : null}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSelect(task.requestId)}
                >
                  {t("settings.importTask.openTask", {
                    defaultValue: "Open saved task",
                  })}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <TablePager {...pager} />
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t("settings.importTask.loadMore", {
            defaultValue: "Load earlier imports",
          })}
        </Button>
      ) : null}
    </section>
  )
}
