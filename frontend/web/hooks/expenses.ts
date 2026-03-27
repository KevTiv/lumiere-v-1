/**
 * Expenses hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Expenses module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useExpenses(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['expenses', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/expenses')
      if (!r.ok) throw new Error('Failed to fetch expenses')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useExpenseSheets(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['expense-sheets', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/expense-sheets')
      if (!r.ok) throw new Error('Failed to fetch expense sheets')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateExpense(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_expense?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', organizationId.toString()] }),
  })
}

export function useCreateExpenseSheet(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_expense_sheet?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateExpenseParams, CreateExpenseSheetParams } from '@lumiere/stdb'
