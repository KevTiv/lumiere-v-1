/**
 * Expenses hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Expenses module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useExpenses(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['expenses', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/expenses', 'Failed to fetch expenses'),
    staleTime: 30_000,
    initialData,
  })
}

export function useExpenseSheets(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['expense-sheets', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/expense-sheets', 'Failed to fetch expense sheets'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateExpense(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', organizationId.toString()] }),
  })
}

export function useCreateExpenseSheet(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
  })
}

export function useUpdateExpense(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expenseId,
      params,
    }: {
      expenseId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const r = await fetch('/api/call/update_expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), expenseId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', organizationId.toString()] }),
  })
}

export function useSubmitExpense(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expenseId,
      sheetId,
    }: {
      expenseId: string | number | bigint
      sheetId: string | number | bigint
    }) => {
      const r = await fetch('/api/call/submit_expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          expenseId.toString(),
          sheetId.toString(),
        ]),
      })
      if (!r.ok) throw new Error('Failed to submit expense')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
      ])
    },
  })
}

export function useSubmitExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      params,
    }: {
      sheetId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const r = await fetch('/api/call/submit_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), sheetId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to submit expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
  })
}

export function useApproveExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sheetId: string | number | bigint) => {
      const r = await fetch('/api/call/approve_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), sheetId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to approve expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
  })
}

export function useRefuseExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sheetId: string | number | bigint) => {
      const r = await fetch('/api/call/refuse_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), sheetId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to refuse expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
  })
}

export function usePostExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      accountingDate,
    }: {
      sheetId: string | number | bigint
      accountingDate: string | number | Date
    }) => {
      const accountingDateValue =
        accountingDate instanceof Date
          ? accountingDate.toISOString()
          : String(accountingDate)

      const r = await fetch('/api/call/post_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          sheetId.toString(),
          accountingDateValue,
        ]),
      })
      if (!r.ok) throw new Error('Failed to post expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId.toString()] }),
      ])
    },
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateExpenseParams, CreateExpenseSheetParams } from '@lumiere/stdb'
