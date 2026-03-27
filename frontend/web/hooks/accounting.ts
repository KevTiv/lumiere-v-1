/**
 * Accounting hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Accounting module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Notes:
 * - useBankStatements and useFixedAssets return empty arrays (no route yet)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useAccountAccounts(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['account-accounts', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/account-accounts')
      if (!r.ok) throw new Error('Failed to fetch account accounts')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useAccountMoves(
  organizationId: bigint,
  _moveType?: string,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['account-moves', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/account-moves')
      if (!r.ok) throw new Error('Failed to fetch account moves')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useAccountTaxes(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['account-taxes', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/account-taxes')
      if (!r.ok) throw new Error('Failed to fetch account taxes')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useBudgets(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['budgets', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/budgets')
      if (!r.ok) throw new Error('Failed to fetch budgets')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useAnalyticAccounts(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['analytic-accounts', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/analytic-accounts')
      if (!r.ok) throw new Error('Failed to fetch analytic accounts')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until bank_statement table/route is added
export function useBankStatements(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['bank-statements', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No route yet — returns empty array until fixed_asset table/route is added
export function useFixedAssets(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['fixed-assets', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateAccount(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_account_account?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create account')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['account-accounts', organizationId.toString()] }),
  })
}

export function useCreateMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_account_move?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create move')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['account-moves', organizationId.toString()] }),
  })
}

export function useCreateTax(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_account_tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create tax')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['account-taxes', organizationId.toString()] }),
  })
}

export function useCreateBudget(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_crossovered_budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create budget')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  AccountMove, CreateAccountAccountParams, CreateAccountMoveParams, CreateAccountTaxParams,
  CreateCrossoveredBudgetParams
} from '@lumiere/stdb'
