"use client"

/**
 * Generic SpacetimeDB hooks
 *
 * useStdbReducer  — call any named operation via POST /api/operations/:operation
 * useStdbQuery    — fetch any resource via GET /api/query/:resource
 *
 * These provide access to the full SpacetimeDB surface area without
 * requiring individual domain-specific hook files.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useErpSession } from '@lumiere/erp-session'

import {
  stdbBffCommandPost,
  type StdbBffCommandInput,
  type StdbBffReducerKey,
} from "@lumiere/stdb/commands"
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs"
import { isSubscriptionReady, useSubscriptionCache } from "@lumiere/stdb/live"
import type { QueryResourceKey } from "@lumiere/stdb/generated/query-registry"
import type { QueryRowFor, QueryRowResourceKey } from "@lumiere/stdb/query-row-map"
import {
  decodeTypedResourceQueryResponse,
  type ResourceQueryRowMap,
  type TypedResourceReadKey,
} from "@lumiere/stdb/resource-reads"

import { apiFetch, coalesceQueryInitialData } from "../http"
import { stdbInvalidationFor } from "@lumiere/contracts/stdb-reducer-invalidation"

export function stdbQueryKey(
  resource: string,
  organizationId: bigint | number,
  companyId?: number | null,
) {
  return companyId != null && companyId > 0
    ? (['stdb', resource, organizationId.toString(), 'company', companyId] as const)
    : (['stdb', resource, organizationId.toString()] as const)
}

/** Cache namespace for rows that passed a generated HTTP projection decoder. */
export function typedStdbQueryKey(
  resource: string,
  organizationId: bigint | number,
  companyId?: number | null,
) {
  return companyId != null && companyId > 0
    ? (['typed-stdb', resource, organizationId.toString(), 'company', companyId] as const)
    : (['typed-stdb', resource, organizationId.toString()] as const)
}

function hasPositiveOrganizationId(value: bigint | number): boolean {
  return typeof value === 'bigint' ? value > 0n : value > 0
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

  // HR hooks (`hooks/hr.ts`) deviate from the `[resource, org]` convention and
  // use hand-rolled `hr-<resource>` query keys. Without this alias, realtime
  // table updates (e.g. a payslip created/confirmed via a direct reducer call
  // that bypasses the app's own mutation hooks) never reach `usePayslips` and
  // similar HR reads — the row exists but silently never appears in the UI.
  const hrAlias = HR_RESOURCE_QUERY_KEY_ALIASES[resource]
  if (hrAlias) {
    keys.push([hrAlias, orgString])
  }

  // TODO(BFF Form Cleanup): add explicit aliases for bundle resources like
  // "auth" and "form-configuration" once their concrete query keys are settled.
  return keys
}

/** Maps `HR_WORKSPACE_RESOURCE_KEYS` resource names to the custom query key prefix used in `hooks/hr.ts`. */
const HR_RESOURCE_QUERY_KEY_ALIASES: Record<string, string> = {
  contracts: 'hr-contracts',
  departments: 'hr-departments',
  'employee-documents': 'hr-employee-documents',
  'leave-requests': 'hr-leave-requests',
  'leaves-to-approve': 'hr-leaves-to-approve',
  'leave-types': 'hr-leave-types',
  'onboarding-progress': 'hr-onboarding-progress',
  'onboarding-template-items': 'hr-onboarding-template-items',
  'onboarding-templates': 'hr-onboarding-templates',
  'performance-cycles': 'hr-performance-cycles',
  'performance-goals': 'hr-performance-goals',
  'performance-reviews': 'hr-performance-reviews',
  'benefit-plans': 'hr-benefit-plans',
  'benefit-enrollments': 'hr-benefit-enrollments',
  'payroll-structures': 'hr-payroll-structures',
  payslips: 'hr-payslips',
  'payslips-to-export': 'hr-payslips-to-export',
  'salary-rules': 'hr-salary-rules',
  attendance: 'hr-attendance',
  'compensation-events': 'hr-compensation-events',
  'work-schedules': 'hr-work-schedules',
  'labor-cost-snapshots': 'hr-labor-cost-snapshots',
  'shift-opt-jobs': 'hr-shift-opt-jobs',
  'global-assignments': 'hr-global-assignments',
  'hr-integration-intents': 'hr-integration-intents-pending',
}

/** Invalidate `useStdbQuery` caches for the given resource names (same `organizationId` as the query). */
export function invalidateStdbQueryResources(
  qc: QueryClient,
  organizationId: bigint | number,
  resources: readonly string[],
) {
  for (const resource of resources) {
    // Typed HTTP rows use a separate namespace so the opt-in legacy direct-row
    // cache can never populate them with unprojected SDK entities.
    void qc.invalidateQueries({
      queryKey: typedStdbQueryKey(resource, organizationId),
    })
    if (isSubscriptionReady()) continue
    for (const queryKey of realtimeQueryKeysForResource(resource, organizationId)) {
      void qc.invalidateQueries({ queryKey })
    }
  }
}

/**
 * POST `/api/operations/:operation` and invalidate listed `stdb` query resources on success.
 * When `invalidateResources` is omitted or empty, uses `STDB_REDUCER_INVALIDATION` from codegen manifest.
 */
type NamedReducerKey = Extract<StdbBffReducerKey, keyof OperationInputMap>

export function useStdbCallMutation<K extends NamedReducerKey>(
  reducerName: K,
  organizationId: bigint | number,
  invalidateResources?: readonly string[],
) {
  const qc = useQueryClient()
  const resources =
    invalidateResources != null && invalidateResources.length > 0
      ? invalidateResources
      : stdbInvalidationFor(reducerName)
  return useMutation<void, Error, StdbBffCommandInput<K>>({
    mutationFn: async (input) => {
      const { urlPath, init } = stdbBffCommandPost(reducerName, input)
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Reducer ${reducerName} failed`)
      }
    },
    onSuccess: () => {
      if (resources.length > 0) {
        invalidateStdbQueryResources(qc, organizationId, resources)
      }
    },
  })
}

/**
 * Call any SpacetimeDB reducer by name.
 *
 * @example
 * const confirm = useStdbReducer('confirm_sales_order')
 * confirm.mutate({ companyId, orderId })
 */
export function useStdbReducer<K extends NamedReducerKey>(reducerName: K) {
  return useMutation<void, Error, StdbBffCommandInput<K>>({
    mutationFn: async (input) => {
      const { urlPath, init } = stdbBffCommandPost(reducerName, input)
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
export function useStdbQuery<K extends QueryRowResourceKey>(
  resource: K,
  organizationId: bigint | number,
  options?: {
    staleTime?: number
    enabled?: boolean
    /** SSR / hydration seed until the first fetch completes */
    initialData?: QueryRowFor<K>[]
  },
) {
  const qc = useQueryClient()
  const { subscriptionReady } = useSubscriptionCache()
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  const companyId = activeCompanyReady ? activeCompanyId : null
  const queryKey = stdbQueryKey(resource, organizationId, companyId)

  return useQuery({
    queryKey,
    queryFn: async (): Promise<QueryRowFor<K>[]> => {
      if (subscriptionReady) {
        for (const key of realtimeQueryKeysForResource(resource, organizationId)) {
          const cached = qc.getQueryData(key)
          if (Array.isArray(cached)) return cached as QueryRowFor<K>[]
        }
      }
      const companyQuery = companyId != null && companyId > 0
        ? `?companyId=${encodeURIComponent(String(companyId))}`
        : ''
      const r = await apiFetch(`/api/query/${resource}${companyQuery}`)
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Query ${resource} failed`)
      }
      const json = await r.json() as { data: QueryRowFor<K>[] }
      return json.data ?? []
    },
    staleTime: subscriptionReady ? Number.POSITIVE_INFINITY : (options?.staleTime ?? 30_000),
    refetchOnMount: !subscriptionReady,
    refetchOnWindowFocus: !subscriptionReady,
    enabled: options?.enabled,
    initialData: coalesceQueryInitialData(options?.initialData),
  })
}

/**
 * Fetch a company-scoped resource through a generated projection decoder.
 * The loader owns transport and decoding; this hook owns selected-company
 * readiness, cache identity, and React Query lifecycle only.
 */
export function useCompanyScopedTypedQuery<Row>(
  resource: QueryResourceKey,
  organizationId: bigint | number,
  loadRows: (companyId: bigint) => Promise<Row[]>,
  options?: {
    staleTime?: number
    enabled?: boolean
  },
) {
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  const companyId = activeCompanyReady ? activeCompanyId : null
  return useQuery<Row[]>({
    queryKey: typedStdbQueryKey(resource, organizationId, companyId),
    queryFn: () => {
      if (companyId == null || companyId <= 0) {
        throw new Error(`An active company is required to query ${resource}`)
      }
      return loadRows(BigInt(companyId))
    },
    enabled:
      (options?.enabled ?? true) &&
      hasPositiveOrganizationId(organizationId) &&
      companyId != null &&
      companyId > 0,
    staleTime: options?.staleTime ?? 30_000,
  })
}

/** Fetch and decode any resource in the reviewed generated typed-read set. */
export function useTypedStdbQuery<Resource extends TypedResourceReadKey>(
  resource: Resource,
  organizationId: bigint | number,
  options?: {
    staleTime?: number
    enabled?: boolean
    initialData?: ResourceQueryRowMap[Resource][]
  },
) {
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  const companyId = activeCompanyReady ? activeCompanyId : null
  return useQuery<ResourceQueryRowMap[Resource][]>({
    queryKey: typedStdbQueryKey(resource, organizationId, companyId),
    queryFn: async () => {
      if (companyId == null || companyId <= 0) {
        throw new Error(`An active company is required to query ${resource}`)
      }
      const companyQuery = `?companyId=${encodeURIComponent(String(companyId))}`
      const response = await apiFetch(`/api/query/${resource}${companyQuery}`)
      if (!response.ok) {
        const json = await response.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Query ${resource} failed`)
      }
      return decodeTypedResourceQueryResponse(resource, await response.json())
    },
    enabled:
      (options?.enabled ?? true) &&
      hasPositiveOrganizationId(organizationId) &&
      activeCompanyReady &&
      companyId != null &&
      companyId > 0,
    staleTime: options?.staleTime ?? 30_000,
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
export function useStdbReducerWithInvalidation<K extends NamedReducerKey>(
  reducerName: K,
  invalidateResource: string,
  organizationId: bigint | number,
) {
  return useStdbCallMutation(reducerName, organizationId, [invalidateResource])
}
