"use client"

/**
 * Expenses hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Expenses module.
 */


import { expensesBffPost } from "@lumiere/stdb/commands"
import type {
  CreateExpenseParams,
  CreateExpenseSheetParams,
  SubmitExpenseSheetParams,
  UpdateExpenseParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import {
  finalizeCreateExpenseParams,
  finalizeCreateExpenseSheetParams,
} from "./expenses-params-merge"

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useExpenses(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['expenses', rqBigIntKey(organizationId)],
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
    queryKey: ['expense-sheets', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/expense-sheets', 'Failed to fetch expense sheets'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateExpense(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateExpenseParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateExpenseParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = expensesBffPost("create_expense", [
        organizationId,
        stdbParamsToJson(finalized),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateExpenseSheet(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateExpenseSheetParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateExpenseSheetParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = expensesBffPost("create_expense_sheet", [
        organizationId,
        stdbParamsToJson(finalized),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create expense sheet')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateExpense(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expenseId,
      params,
    }: {
      expenseId: string | number | bigint
      params: Partial<UpdateExpenseParams>
    }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = expensesBffPost("update_expense", [
        organizationId,
        expenseId,
        stdbParamsToJson(patch),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update expense')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = expensesBffPost("submit_expense", [
        organizationId,
        expenseId,
        sheetId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit expense')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
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
      params: SubmitExpenseSheetParams
    }) => {
      const { urlPath, init } = expensesBffPost("submit_expense_sheet", [
        organizationId,
        sheetId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useApproveExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sheetId: string | number | bigint) => {
      const { urlPath, init } = expensesBffPost("approve_expense_sheet", [
        organizationId,
        sheetId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useRefuseExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sheetId: string | number | bigint) => {
      const { urlPath, init } = expensesBffPost("refuse_expense_sheet", [
        organizationId,
        sheetId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to refuse expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
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

      const { urlPath, init } = expensesBffPost("post_expense_sheet", [
        organizationId,
        sheetId,
        accountingDateValue,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to post expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = expensesBffPost("import_expense_csv", [organizationId, csvData])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorExpenses(res))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useImportExpenseSheetCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = expensesBffPost("import_expense_sheet_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorExpenses(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
  })
}

export function useExpensesCsvImportMutations(organizationId: bigint) {
  return {
    importExpense: useImportExpenseCsv(organizationId),
    importExpenseSheet: useImportExpenseSheetCsv(organizationId),
  }
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateExpenseParams, CreateExpenseSheetParams } from '@lumiere/stdb/types'
