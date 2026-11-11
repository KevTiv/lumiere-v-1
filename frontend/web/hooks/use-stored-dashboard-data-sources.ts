'use client'

import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useErpSession } from '@lumiere/erp-session'
import { currenciesQueryOptions } from '@lumiere/query-hooks/hooks/settings-currencies'
import {
  RESOURCE_REGISTRY,
  type QueryResourceKey,
} from '@lumiere/stdb/generated/query-registry'
import {
  dashboardModelLookupKeys,
  resourceKeysForDashboardModels,
  tableNameForResourceKey,
} from '@lumiere/stdb/stored-dashboard-model-registry'
import { useModuleSubscription, useSubscriptionCache } from '@lumiere/stdb/live'
import { apiFetch } from '@lumiere/query-hooks/http'
import { stdbQueryKey } from '@lumiere/query-hooks/hooks/stdb'
import {
  fetchStoredDashboardResource,
  type StoredDashboardIncompleteReason,
} from './stored-dashboard-resource'
import type {
  StoredDashboardDataSources,
  StoredDashboardSourceStates,
} from '@lumiere/ui'
import {
  shouldRetryStoredDashboardSource,
  storedDashboardSourceIssue,
  storedDashboardSourceState,
  type StoredDashboardSourceIssue,
} from './stored-dashboard-source-state'

const CURRENCY_SOURCE_KEYS = ['currency', 'currencies', 'res_currency']

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

const incompleteSourceMessages: Record<
  StoredDashboardIncompleteReason,
  string
> = {
  'company-scope':
    'The company scope of this source could not be verified. Its complete total is unavailable.',
  'read-limit':
    'This source exceeds the widget read limit. Its complete total is unavailable.',
  'source-incomplete':
    'This source returned incomplete coverage. Its complete total is unavailable.',
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
  options?: { companyId?: string; identity?: string; enabled?: boolean },
): {
  dataSources: StoredDashboardDataSources
  sourceStates: StoredDashboardSourceStates
  isLoading: boolean
  isRefreshing: boolean
  issue: StoredDashboardSourceIssue | null
  retry: () => Promise<void>
} {
  const { subscriptionReady } = useSubscriptionCache()
  const session = useErpSession()
  const [isManualRetrying, setIsManualRetrying] = useState(false)
  const resourceKeys = useMemo(
    () => resourceKeysForDashboardModels(models),
    [models],
  )
  const enabled = options?.enabled !== false && organizationId > 0n
  const currencies = useQuery({
    // Currency IDs are tenant-local. Never reuse the legacy unscoped currency cache.
    ...currenciesQueryOptions({ organizationId, identity: options?.identity ?? session.identity }),
    enabled: enabled && resourceKeys.length > 0,
    retry: shouldRetryStoredDashboardSource,
  })

  useModuleSubscription(enabled ? resourceKeys : [])

  const queries = useQueries({
    queries: resourceKeys.map((resource) => ({
      queryKey: [
        ...stdbQueryKey(resource, organizationId),
        'dashboard-source-v2',
        options?.identity ?? null,
        options?.companyId ?? null,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchStoredDashboardResource(apiFetch, resource, {
          companyId: options?.companyId,
          signal,
        }),
      // Scoped cursor envelopes cannot be populated by the legacy direct row cache.
      // API invalidations share the resource-key prefix; direct-cache deployments poll.
      staleTime: 30_000,
      refetchInterval: subscriptionReady ? 30_000 : (false as const),
      enabled: enabled && resourceKeys.length > 0,
      retry: shouldRetryStoredDashboardSource,
    })),
  })

  const dataSources = useMemo(() => {
    const sources: StoredDashboardDataSources = {}
    for (const key of CURRENCY_SOURCE_KEYS) sources[key] = !enabled || currencies.error ? [] : currencies.data ?? []

    resourceKeys.forEach((resourceKey, index) => {
      indexRowsForResource(
        sources,
        resourceKey,
        !enabled || queries[index]?.error
          ? []
          : (queries[index]?.data?.rows ?? []),
      )
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
  }, [enabled, resourceKeys, queries, models, currencies.data, currencies.error])

  const sourceStates = useMemo(() => {
    const states: StoredDashboardSourceStates = {}
    const currencyState = !enabled || resourceKeys.length === 0
      ? { status: 'unavailable' as const, rowCount: 0 }
      : storedDashboardSourceState({ isLoading: currencies.isLoading, error: currencies.error, rowCount: currencies.error ? 0 : currencies.data?.length ?? 0 })
    for (const key of CURRENCY_SOURCE_KEYS) states[key] = currencyState

    resourceKeys.forEach((resourceKey, index) => {
      if (!enabled) {
        indexStateForResource(states, resourceKey, {
          status: 'unavailable',
          rowCount: 0,
          message: 'Widget data is unavailable in the current page context.',
        })
        return
      }
      const query = queries[index]
      const state = storedDashboardSourceState({
        isLoading: query?.isLoading ?? false,
        error: query?.error,
        rowCount: query?.error ? 0 : (query?.data?.rows.length ?? 0),
      })
      indexStateForResource(
        states,
        resourceKey,
        !query?.error && query?.data?.complete === false
          ? {
              status: 'partial',
              rowCount: query.data.rows.length,
              message:
                incompleteSourceMessages[
                  query.data.incompleteReason ?? 'source-incomplete'
                ],
            }
          : state,
      )
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
  }, [enabled, resourceKeys, queries, models, currencies.isLoading, currencies.error, currencies.data])

  // Reference-data readiness belongs to each monetary widget. It must not hide
  // unrelated counts or tables while their own source is already available.
  const isLoading = resourceKeys.some(
    (resource) => sourceStates[tableNameForResourceKey(resource)]?.status === 'loading',
  )
  const isRefreshing =
    isManualRetrying ||
    (!isLoading && (queries.some((query) => query.isFetching) || currencies.isFetching))
  const issue = storedDashboardSourceIssue(
    queries.find((query) => query.error != null)?.error,
  )
  const retry = async () => {
    if (!enabled) return
    setIsManualRetrying(true)
    try {
      await Promise.all([...queries.map((query) => query.refetch()), currencies.refetch()])
    } finally {
      setIsManualRetrying(false)
    }
  }

  return { dataSources, sourceStates, isLoading, isRefreshing, issue, retry }
}
