/**
 * Subscriptions hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Subscriptions module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSubscriptions(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['subscriptions', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/subscriptions')
      if (!r.ok) throw new Error('Failed to fetch subscriptions')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscriptionPlans(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['subscription-plans', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/subscription-plans')
      if (!r.ok) throw new Error('Failed to fetch subscription plans')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSubscription(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create subscription')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
  })
}
