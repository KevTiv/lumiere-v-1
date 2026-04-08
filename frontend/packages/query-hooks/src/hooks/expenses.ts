"use client"

/**
 * Expenses hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Expenses module.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useExpenses(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['expenses', organizationId],
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
    queryKey: ['expense-sheets', organizationId],
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
      const r = await apiFetch('/api/call/create_expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error('Failed to create expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
  })
}

export function useCreateExpenseSheet(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error('Failed to create expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
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
      const r = await apiFetch('/api/call/update_expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, expenseId, params]),
      })
      if (!r.ok) throw new Error('Failed to update expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
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
      const r = await apiFetch('/api/call/submit_expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          expenseId,
          sheetId,
        ]),
      })
      if (!r.ok) throw new Error('Failed to submit expense')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
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
      const r = await apiFetch('/api/call/submit_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, sheetId, params]),
      })
      if (!r.ok) throw new Error('Failed to submit expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
        qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
      ])
    },
  })
}

export function useApproveExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sheetId: string | number | bigint) => {
      const r = await apiFetch('/api/call/approve_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, sheetId]),
      })
      if (!r.ok) throw new Error('Failed to approve expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
        qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
      ])
    },
  })
}

export function useRefuseExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sheetId: string | number | bigint) => {
      const r = await apiFetch('/api/call/refuse_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, sheetId]),
      })
      if (!r.ok) throw new Error('Failed to refuse expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
        qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
      ])
    },
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

      const r = await apiFetch('/api/call/post_expense_sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          sheetId,
          accountingDateValue,
        ]),
      })
      if (!r.ok) throw new Error('Failed to post expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
      ])
    },
  })
}

// ── CSV imports (organization_id, csv_data) ───────────────────────────────────

async function parseCallErrorExpenses(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

export function useImportExpenseCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_expense_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorExpenses(res))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses', organizationId] }),
  })
}

export function useImportExpenseSheetCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_expense_sheet_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorExpenses(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expense-sheets', organizationId] }),
  })
}

export function useExpensesCsvImportMutations(organizationId: bigint) {
  return {
    importExpense: useImportExpenseCsv(organizationId),
    importExpenseSheet: useImportExpenseSheetCsv(organizationId),
  }
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateExpenseParams, CreateExpenseSheetParams } from '@lumiere/stdb/generated/types'
