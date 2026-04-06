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

import type { QueryClient } from '@tanstack/react-query'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from "../http"

/** Same as `@lumiere/api-client` / `callStdbReducer` — JSON.stringify cannot encode bigint. */
function stringifyReducerArgs(args: unknown[]): string {
  return JSON.stringify(args, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  )
}

/** Invalidate `useStdbQuery` caches for the given resource names (same `organizationId` as the query). */
export function invalidateStdbQueryResources(
  qc: QueryClient,
  organizationId: bigint | number,
  resources: readonly string[],
) {
  const k = organizationId.toString()
  for (const resource of resources) {
    void qc.invalidateQueries({ queryKey: ['stdb', resource, k] })
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
      const r = await apiFetch(`/api/call/${encodeURIComponent(reducerName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerArgs(args),
      })
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
      const r = await apiFetch(`/api/call/${encodeURIComponent(reducerName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerArgs(args),
      })
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
    queryKey: ['stdb', resource, organizationId.toString()],
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
    initialData: options?.initialData,
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
