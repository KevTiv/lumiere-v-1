/**
 * Subscriptions hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Subscriptions module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSubscriptions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscriptions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/subscriptions', 'Failed to fetch subscriptions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscriptionPlans(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-plans', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/subscription-plans', 'Failed to fetch subscription plans'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSubscriptionPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_subscription_plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create subscription plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', organizationId.toString()] }),
  })
}

export function useCreateSubscriptionFromSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_subscription_from_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create subscription from sale order')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['subscription-plans', organizationId.toString()] }),
      ])
    },
  })
}

export function useCreateSubscription(organizationId: bigint, companyId?: bigint) {
  return useCreateSubscriptionFromSaleOrder(organizationId, companyId)
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from '@lumiere/stdb'
