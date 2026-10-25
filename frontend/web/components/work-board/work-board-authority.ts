"use client"

import { useEffect, useState } from "react"
import {
  useQueryClient,
  useQuery,
  skipToken,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import {
  workBoardQueryKey,
  type WorkBoardScope,
} from "@lumiere/query-hooks/hooks/work-board-model"
import { workActivitiesQueryKey } from "@lumiere/query-hooks/hooks/work-activities"
import {
  realtimeAuthorityKey,
  type RealtimeAuthorityState,
} from "@lumiere/query-hooks/hooks/realtime"

type WorkSource = "workflow" | "activities"

async function refreshActiveQuery(
  client: QueryClient,
  queryKey: QueryKey,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (!isCurrent()) return false
  const query = client.getQueryCache().find({ queryKey, exact: true })
  if (!query?.isActive())
    throw new Error(
      "Current permissions and assignments could not be refreshed.",
    )
  const before = query.state.dataUpdateCount
  await client.refetchQueries(
    { queryKey, exact: true, type: "active" },
    { cancelRefetch: true, throwOnError: true },
  )
  if (!isCurrent()) return false
  if (
    client.getQueryCache().find({ queryKey, exact: true }) !== query ||
    query.state.status !== "success" ||
    query.state.fetchStatus !== "idle" ||
    query.state.dataUpdateCount <= before
  ) {
    throw new Error(
      "Current permissions and assignments could not be refreshed.",
    )
  }
  return true
}

/** Reuse the provider's authority query; never treat retained cache data as a reconnect check. */
export async function refreshWorkBoardAuthority(
  client: QueryClient,
  scope: WorkBoardScope,
  source: WorkSource,
  isCurrent: () => boolean,
): Promise<boolean> {
  const authorityKey = [
    "auth-access",
    scope.organizationId,
    scope.actorIdentity,
  ] as const
  if (!(await refreshActiveQuery(client, authorityKey, isCurrent))) return false
  const boardKey =
    source === "activities"
      ? workActivitiesQueryKey(scope)
      : workBoardQueryKey(scope)
  return refreshActiveQuery(client, boardKey, isCurrent)
}

export function useWorkBoardAuthority(
  scope: WorkBoardScope,
  source: WorkSource,
  online: boolean,
  reconnect: number,
) {
  const client = useQueryClient()
  const connection = useQuery<RealtimeAuthorityState>({
    queryFn: skipToken,
    queryKey: realtimeAuthorityKey(
      scope.organizationId,
      scope.companyId,
      scope.actorIdentity,
    ),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    key: string
    state: "checking" | "fresh" | "failed"
  } | null>(null)
  const contextKey = JSON.stringify({ scope, source })
  const needsRefresh = reconnect > 0 || (connection?.generation ?? 0) > 0
  const runKey = JSON.stringify([
    contextKey,
    reconnect,
    retry,
    connection?.generation,
  ])

  useEffect(() => {
    if (!online || !needsRefresh) return
    let current = true
    const context = JSON.parse(contextKey) as {
      scope: WorkBoardScope
      source: WorkSource
    }
    setResult({ key: runKey, state: "checking" })
    void refreshWorkBoardAuthority(
      client,
      context.scope,
      context.source,
      () => current,
    )
      .then((fresh) => {
        if (current && fresh) setResult({ key: runKey, state: "fresh" })
      })
      .catch(() => {
        if (current) setResult({ key: runKey, state: "failed" })
      })
    return () => {
      current = false
    }
  }, [client, contextKey, online, needsRefresh, runKey])

  const fresh =
    !needsRefresh || (result?.key === runKey && result.state === "fresh")
  return {
    blocked: !fresh,
    failed: !fresh && result?.key === runKey && result.state === "failed",
    retry: () => setRetry((value) => value + 1),
  }
}
