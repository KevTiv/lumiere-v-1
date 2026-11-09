"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { TablePager, usePagedRows } from "@lumiere/ui/components/table-pager"
import { FileIdentity } from "@lumiere/ui/components/file-identity"
import { Button } from "@lumiere/ui/components/button"
import { apiFetch } from "./api-fetch"
import { listSavedImportTasks } from "./chat-import-task"
import type { SavedImportScope } from "./use-saved-import-task"

export function useSavedImportTaskList(scope: SavedImportScope) {
  return useInfiniteQuery({
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
}

export function SavedImportTaskPicker({
  query,
  onSelect,
}: {
  query: ReturnType<typeof useSavedImportTaskList>
  onSelect: (id: string) => void
}) {
  const { t, i18n } = useTranslation()
  const statusLabels = {
    awaiting_decision: t("settings.importTask.cardAwaiting", {
      defaultValue: "Files saved · choose how to use them",
    }),
    saved: t("settings.importTask.cardSaved", {
      defaultValue: "Files saved · preparation can resume",
    }),
    needs_review: t("settings.importTask.cardReview", {
      defaultValue: "Source review prepared",
    }),
    inspection_ready: t("settings.importTask.cardInspection", {
      defaultValue: "Inspection ready",
    }),
    failed: t("settings.importTask.cardFailed", {
      defaultValue: "Preparation needs attention",
    }),
  }
  const checking =
    query.isPending || (query.isFetching && !query.isFetchingNextPage)
  const tasks =
    query.isError || checking
      ? []
      : (query.data?.pages.flatMap((page) => page.tasks) ?? [])
  const pager = usePagedRows(tasks, undefined, 5)
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
      {tasks.length ? (
        <ul className="divide-y">
          {pager.pageRows.map((task) => {
            const savedAt = new Date(task.createdAt)
            return (
              <li
                key={task.requestId}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <FileIdentity fileName={task.files[0]?.fileName} />
                  <p className="mt-1 text-sm font-medium">
                    {statusLabels[task.status]}
                  </p>
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
