/**
 * Generic SpacetimeDB hooks
 *
 * useStdbReducer  — call any reducer via POST /api/call/:reducer
 * useStdbQuery    — fetch any resource via GET /api/query/:resource
 *
 * These provide access to the full SpacetimeDB surface area without
 * requiring individual domain-specific hook files.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

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
      const r = await fetch(`/api/call/${reducerName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
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
      const r = await fetch(`/api/query/${resource}`)
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: unknown[]) => {
      const r = await fetch(`/api/call/${reducerName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      })
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Reducer ${reducerName} failed`)
      }
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stdb', invalidateResource, organizationId.toString()] }),
  })
}
