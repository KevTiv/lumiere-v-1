"use client"

import { useQueries, useQuery } from "@tanstack/react-query"
import { apiFetch } from "./api-fetch"
import { parseSavedImportRuns, type SavedImportRuns } from "./saved-import-operator"
import type { ChatImportTask } from "./chat-import-task"
import type { SavedImportScope } from "./use-saved-import-task"

export function savedImportRunsKey(scope: SavedImportScope, taskId: string) {
  return ["durable-import-runs", scope.identity, scope.organizationId, scope.companyId, taskId] as const
}

function options(scope: SavedImportScope, taskId: string, enabled: boolean) {
  return {
    queryKey: savedImportRunsKey(scope, taskId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const response = await apiFetch(
        `/api/import-tasks/${encodeURIComponent(taskId)}/runs?companyId=${scope.companyId}`,
        { cache: "no-store", signal },
      )
      if (response.status === 404) return null
      if (!response.ok) throw new Error("The saved result could not be checked.")
      return parseSavedImportRuns(await response.json(), taskId)
    },
    enabled,
    retry: false,
    staleTime: 15_000,
    refetchInterval: (query: { state: { status: string; data?: SavedImportRuns | null } }) =>
      query.state.status !== "error" && query.state.data?.runs.some(
        run => run.status === "queued" || run.status === "running",
      ) ? 8_000 : false,
  }
}

export function useSavedImportRuns(scope: SavedImportScope, taskId: string, enabled: boolean) {
  return useQuery(options(scope, taskId, enabled))
}

export function useVisibleSavedImportRuns(scope: SavedImportScope, tasks: readonly ChatImportTask[]) {
  return useQueries({
    queries: tasks.map(task => ({
      ...options(scope, task.requestId, task.status === "needs_review"),
      staleTime: 60_000,
      refetchInterval: false as const,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  })
}
