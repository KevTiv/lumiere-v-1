"use client"

/**
 * Generic SpacetimeDB hooks
 *
 * useStdbReducer  — call any reducer via POST /api/call/:reducer
 * useStdbQuery    — fetch any resource via GET /api/query/:resource
 *
 * These provide access to the full SpacetimeDB surface area without
 * requiring individual domain-specific hook files.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { stdbBffPost } from "@lumiere/stdb/commands"

import { apiFetch, coalesceQueryInitialData } from "../http"

export function stdbQueryKey(resource: string, organizationId: bigint | number) {
  return ['stdb', resource, organizationId.toString()] as const
}

/**
 * Query keys affected by an api-server realtime resource.
 *
 * Most BFF-backed hooks use resource-specific keys (`[resource, org]`), while
 * generic STDB queries use `["stdb", resource, org]`. Keep both forms here so
 * realtime invalidation can move toward domain keys without touching every hook.
 */
export function realtimeQueryKeysForResource(
  resource: string,
  organizationId: bigint | number,
): QueryKey[] {
  const orgString = organizationId.toString()
  const keys: QueryKey[] = [
    stdbQueryKey(resource, organizationId),
    [resource, orgString],
  ]

  if (typeof organizationId === 'number') {
    keys.push(['stdb', resource, organizationId])
  }

  // TODO(BFF Form Cleanup): add explicit aliases for bundle resources like
  // "auth" and "form-configuration" once their concrete query keys are settled.
  return keys
}

/** Invalidate `useStdbQuery` caches for the given resource names (same `organizationId` as the query). */
export function invalidateStdbQueryResources(
  qc: QueryClient,
  organizationId: bigint | number,
  resources: readonly string[],
) {
  for (const resource of resources) {
    for (const queryKey of realtimeQueryKeysForResource(resource, organizationId)) {
      void qc.invalidateQueries({ queryKey })
    }
  }
}

/**
 * POST `/api/call/:reducer` and invalidate listed `stdb` query resources on success.
 */
export function useStdbCallMutation(
  reducerName: string,
  organizationId: bigint | number,
  invalidateResources: readonly string[],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: unknown[]) => {
      const { urlPath, init } = stdbBffPost(reducerName, args)
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Reducer ${reducerName} failed`)
      }
    },
    onSuccess: () => invalidateStdbQueryResources(qc, organizationId, invalidateResources),
  })
}

/**
 * Call any SpacetimeDB reducer by name.
 *
 * @example
 * const confirm = useStdbReducer('confirm_sale_order')
 * confirm.mutate([orgId, orderId])
 */
export function useStdbReducer(reducerName: string) {
  return useMutation({
    mutationFn: async (args: unknown[]) => {
      const { urlPath, init } = stdbBffPost(reducerName, args)
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Reducer ${reducerName} failed`)
      }
    },
  })
}

/**
 * Fetch any server query resource by name.
 * Automatically scoped to the authenticated user's organization.
 *
 * @param resource - Resource name (e.g. "leads", "sale-orders", "employees")
 * @param organizationId - Used as part of the React Query cache key
 * @param options - Optional React Query options
 *
 * @example
 * const { data } = useStdbQuery('leads', orgId)
 * const { data } = useStdbQuery('mrp-productions', orgId, { staleTime: 60_000 })
 */
export function useStdbQuery(
  resource: string,
  organizationId: bigint | number,
  options?: {
    staleTime?: number
    enabled?: boolean
    /** SSR / hydration seed until the first fetch completes */
    initialData?: Record<string, unknown>[]
  },
) {
  return useQuery({
    queryKey: stdbQueryKey(resource, organizationId),
    queryFn: async () => {
      const r = await apiFetch(`/api/query/${resource}`)
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Query ${resource} failed`)
      }
      const json = await r.json() as { data: Record<string, unknown>[] }
      return json.data ?? []
    },
    staleTime: options?.staleTime ?? 30_000,
    enabled: options?.enabled,
    initialData: coalesceQueryInitialData(options?.initialData),
  })
}

/**
 * Call a reducer and automatically invalidate a query resource on success.
 *
 * @example
 * const create = useStdbReducerWithInvalidation('create_lead', 'leads', orgId)
 * create.mutate([orgId, { name: 'New Lead' }])
 */
export function useStdbReducerWithInvalidation(
  reducerName: string,
  invalidateResource: string,
  organizationId: bigint | number,
) {
  return useStdbCallMutation(reducerName, organizationId, [invalidateResource])
}
