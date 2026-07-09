'use client'

import { useMemo } from 'react'
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
import type { StoredDashboardDataSources } from '@lumiere/ui'

async function fetchResource(resource: string): Promise<Record<string, unknown>[]> {
  const response = await apiFetch(`/api/query/${resource}`)
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((json.error as string | undefined) ?? `Query ${resource} failed`)
  }
  const json = (await response.json()) as { data: Record<string, unknown>[] }
  return json.data ?? []
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

/**
 * Hydrate stored dashboard widgets from any ERP model referenced in widget rows.
 * Subscribes to and queries only the resources needed for the given models.
 */
export function useStoredDashboardDataSources(
  organizationId: bigint,
  models: string[],
): { dataSources: StoredDashboardDataSources; isLoading: boolean } {
  const { subscriptionReady } = useSubscriptionCache()
  const resourceKeys = useMemo(() => resourceKeysForDashboardModels(models), [models])

  useModuleSubscription(resourceKeys)

  const queries = useQueries({
    queries: resourceKeys.map((resource) => ({
      queryKey: stdbQueryKey(resource, organizationId),
      queryFn: () => fetchResource(resource),
      staleTime: subscriptionReady ? Number.POSITIVE_INFINITY : 30_000,
      enabled: organizationId > 0n && resourceKeys.length > 0,
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

  const isLoading = queries.some((query) => query.isLoading)

  return { dataSources, isLoading }
}
