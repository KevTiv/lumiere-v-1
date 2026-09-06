"use client"

import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query"

import { isSubscriptionReady, useSubscriptionCache } from "@lumiere/stdb/live"

import { coalesceQueryInitialData, fetchQueryList, rqBigIntKey, type QueryRows } from "./http"
import { invalidateStdbQueryResources, realtimeQueryKeysForResource } from "./hooks/stdb"
import type { QueryRowFor, QueryRowResourceKey } from "@lumiere/stdb/query-row-map"

/**
 * Skip React Query invalidation when the browser STDB subscription cache is active.
 */
export function invalidateResourceQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint | number,
  resources: readonly string[],
): void {
  if (isSubscriptionReady()) return
  invalidateStdbQueryResources(qc, organizationId, resources)
}

/**
 * Resource list query that prefers subscription-seeded React Query cache, with HTTP fallback.
 */
export function useSubscriptionAwareQuery<K extends QueryRowResourceKey>(
  resource: K,
  organizationId: bigint,
  options?: {
    initialData?: QueryRowFor<K>[]
    enabled?: boolean
    staleTime?: number
  },
) {
  const qc = useQueryClient()
  const { subscriptionReady } = useSubscriptionCache()

  return useQuery<QueryRowFor<K>[]>({
    queryKey: [resource, rqBigIntKey(organizationId)],
    queryFn: async (): Promise<QueryRowFor<K>[]> => {
      if (subscriptionReady) {
        for (const key of realtimeQueryKeysForResource(resource, organizationId)) {
          const cached = qc.getQueryData(key)
          if (Array.isArray(cached)) return cached as QueryRowFor<K>[]
        }
      }
      return fetchQueryList(`/api/query/${resource}`, `Failed to fetch ${resource}`) as Promise<QueryRowFor<K>[]>
    },
    staleTime: subscriptionReady ? Number.POSITIVE_INFINITY : (options?.staleTime ?? 30_000),
    refetchOnMount: !subscriptionReady,
    refetchOnWindowFocus: !subscriptionReady,
    enabled: options?.enabled,
    initialData: coalesceQueryInitialData(options?.initialData),
  })
}

export function subscriptionKeysFor(
  resource: string,
  organizationId: bigint | number,
): QueryKey[] {
  return realtimeQueryKeysForResource(resource, organizationId) as QueryKey[]
}
