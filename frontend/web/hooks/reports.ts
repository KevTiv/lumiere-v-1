/**
 * Reports hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Reports module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFinancialReports(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['financial-reports', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/financial-reports')
      if (!r.ok) throw new Error('Failed to fetch financial reports')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useTrialBalances(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['trial-balances', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/trial-balances')
      if (!r.ok) throw new Error('Failed to fetch trial balances')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}
