'use client'

import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { RESOURCE_REGISTRY, type QueryResourceKey } from '@lumiere/stdb/generated/query-registry'
import {
  dashboardModelLookupKeys,
  resourceKeysForDashboardModels,
  tableNameForResourceKey,
} from '@lumiere/stdb/stored-dashboard-model-registry'
import { useModuleSubscription, useSubscriptionCache } from '@lumiere/stdb/live'
import { apiFetch } from '@lumiere/query-hooks/http'
import { stdbQueryKey } from '@lumiere/query-hooks/hooks/stdb'
import type { StoredDashboardDataSources, StoredDashboardSourceStates } from '@lumiere/ui'
import {
  StoredDashboardSourceQueryError,
  shouldRetryStoredDashboardSource,
  storedDashboardSourceIssue,
  storedDashboardSourceState,
  type StoredDashboardSourceIssue,
} from './stored-dashboard-source-state'

async function fetchResource(resource: string): Promise<Record<string, unknown>[]> {
  const response = await apiFetch(`/api/query/${resource}`)
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
    throw new StoredDashboardSourceQueryError(
      resource,
      response.status,
      (json.error as string | undefined) ?? `Query ${resource} failed`,
    )
  }
  const json = await response.json().catch(() => null)
  if (
    json == null
    || typeof json !== 'object'
    || !('data' in json)
    || !Array.isArray(json.data)
  ) {
    throw new StoredDashboardSourceQueryError(
      resource,
      response.status,
      `Query ${resource} returned invalid data`,
    )
  }
  return json.data as Record<string, unknown>[]
}

function indexRowsForResource(
  sources: StoredDashboardDataSources,
  resourceKey: QueryResourceKey,
  rows: Record<string, unknown>[],
): void {
  const entry = RESOURCE_REGISTRY[resourceKey]
  const table = tableNameForResourceKey(resourceKey)

  sources[table] = rows
  sources[resourceKey] = rows
  if (!entry) return

  for (const alias of entry.aliases) {
    sources[alias] = rows
    sources[alias.replace(/-/g, '_')] = rows
  }
}

function indexStateForResource(
  states: StoredDashboardSourceStates,
  resourceKey: QueryResourceKey,
  state: StoredDashboardSourceStates[string],
): void {
  const entry = RESOURCE_REGISTRY[resourceKey]
  const table = tableNameForResourceKey(resourceKey)

  states[table] = state
  states[resourceKey] = state
  if (!entry) return

  for (const alias of entry.aliases) {
    states[alias] = state
    states[alias.replace(/-/g, '_')] = state
  }
}

/**
 * Hydrate stored dashboard widgets from any ERP model referenced in widget rows.
 * Subscribes to and queries only the resources needed for the given models.
 */
export function useStoredDashboardDataSources(
  organizationId: bigint,
  models: string[],
): {
  dataSources: StoredDashboardDataSources
  sourceStates: StoredDashboardSourceStates
  isLoading: boolean
  isRefreshing: boolean
  issue: StoredDashboardSourceIssue | null
  retry: () => Promise<void>
} {
  const { subscriptionReady } = useSubscriptionCache()
  const [isManualRetrying, setIsManualRetrying] = useState(false)
  const resourceKeys = useMemo(() => resourceKeysForDashboardModels(models), [models])

  useModuleSubscription(resourceKeys)

  const queries = useQueries({
    queries: resourceKeys.map((resource) => ({
      queryKey: stdbQueryKey(resource, organizationId),
      queryFn: () => fetchResource(resource),
      staleTime: subscriptionReady ? Number.POSITIVE_INFINITY : 30_000,
      enabled: organizationId > 0n && resourceKeys.length > 0,
      retry: shouldRetryStoredDashboardSource,
    })),
  })

  const dataSources = useMemo(() => {
    const sources: StoredDashboardDataSources = {}

    resourceKeys.forEach((resourceKey, index) => {
      indexRowsForResource(sources, resourceKey, queries[index]?.data ?? [])
    })

    for (const model of models) {
      const resourceKey = resourceKeysForDashboardModels([model])[0]
      if (!resourceKey) continue
      const rows = sources[tableNameForResourceKey(resourceKey)] ?? []
      for (const alias of dashboardModelLookupKeys(model)) {
        sources[alias] = rows
      }
    }

    return sources
  }, [resourceKeys, queries, models])

  const sourceStates = useMemo(() => {
    const states: StoredDashboardSourceStates = {}

    resourceKeys.forEach((resourceKey, index) => {
      const query = queries[index]
      const state = storedDashboardSourceState({
        isLoading: query?.isLoading ?? false,
        error: query?.error,
        rowCount: query?.data?.length ?? 0,
      })
      indexStateForResource(states, resourceKey, state)
    })

    for (const model of models) {
      const resourceKey = resourceKeysForDashboardModels([model])[0]
      if (!resourceKey) {
        states[model] = {
          status: 'unavailable',
          rowCount: 0,
          message: `Dashboard model ${model} is not registered.`,
        }
        continue
      }
      const state = states[tableNameForResourceKey(resourceKey)]
      if (!state) continue
      for (const alias of dashboardModelLookupKeys(model)) states[alias] = state
    }

    return states
  }, [resourceKeys, queries, models])

  const isLoading = Object.values(sourceStates).some((state) => state.status === 'loading')
  const isRefreshing =
    isManualRetrying || (!isLoading && queries.some((query) => query.isFetching))
  const issue = storedDashboardSourceIssue(queries.find((query) => query.error != null)?.error)
  const retry = async () => {
    setIsManualRetrying(true)
    try {
      await Promise.all(queries.map((query) => query.refetch()))
    } finally {
      setIsManualRetrying(false)
    }
  }

  return { dataSources, sourceStates, isLoading, isRefreshing, issue, retry }
}
