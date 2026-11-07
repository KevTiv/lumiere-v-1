"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { apiFetch } from "./api-fetch"
import { listSavedImportTasks } from "./chat-import-task"
import type { SavedImportScope } from "./use-saved-import-task"

export function SavedImportTaskPicker({
  scope,
  onSelect,
}: {
  scope: SavedImportScope
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const query = useInfiniteQuery({
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
  })
  const tasks = query.isError
    ? []
    : (query.data?.pages.flatMap((page) => page.tasks) ?? [])
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
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
      {query.isPending ? (
        <p role="status" className="text-sm">
          {t("settings.importTask.loading", {
            defaultValue: "Checking the saved import…",
          })}
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {!query.isPending && !query.error && !tasks.length ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.importTask.noSavedTasks", {
            defaultValue:
              "No saved file tasks yet. Choose source files above or attach them in the assistant to start.",
          })}
        </p>
      ) : null}
      {tasks.length ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {tasks.map((task) => (
            <li key={task.requestId} className="min-w-0">
              <button
                type="button"
                className="h-full w-full rounded-lg border p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelect(task.requestId)}
              >
                <span className="block break-words text-sm font-medium">
                  {task.files.map((file) => file.fileName).join(" · ")}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("settings.importTask.taskPending", {
                    defaultValue:
                      "{{files}} files · {{pending}} source rows need review",
                    files: task.files.length,
                    pending: task.reviews.reduce(
                      (count, review) => count + review.pending,
                      0,
                    ),
                  })}
                </span>
                <span className="mt-2 block text-xs font-medium">
                  {t("settings.importTask.openTask", {
                    defaultValue: "Open saved task",
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
