"use client"

/**
 * Expenses hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Expenses module.
 */


import { expensesBffPost } from "@lumiere/stdb/commands"
import type {
  CreateExpenseParams,
  CreateExpenseProjectRebillParams,
  CreateExpenseReimbursementParams,
  CreateExpenseSheetParams,
  PostExpenseSheetParams,
  RefuseExpenseSheetParams,
  SetExpenseAllocationsParams,
  UpdateExpenseParams,
  UpsertExpenseMileageRateParams,
  UpsertExpensePerDiemRateParams,
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

/** Server-bounded: `expense_sheet.state = Submitted`. */
export function useExpenseSheetsToApprove(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expense-sheets-to-approve', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/expense-sheets-to-approve',
        'Failed to fetch expense sheets awaiting approval',
      ),
    staleTime: 30_000,
    initialData,
  })
}

/** Server-bounded: draft expenses with `has_receipt = false`. */
export function useExpensesMissingReceipt(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expenses-missing-receipt', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/expenses-missing-receipt',
        'Failed to fetch expenses missing receipts',
      ),
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
    mutationFn: async (sheetId: string | number | bigint) => {
      const { urlPath, init } = expensesBffPost("submit_expense_sheet", [
        organizationId,
        sheetId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to submit expense sheet')
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', k] }),
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets-to-approve', k] }),
        qc.invalidateQueries({ queryKey: ['expenses-missing-receipt', k] }),
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to approve expense sheet')
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', k] }),
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets-to-approve', k] }),
      ])
    },
  })
}

export function useRefuseExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      params,
    }: {
      sheetId: string | number | bigint
      params?: Partial<RefuseExpenseSheetParams>
    }) => {
      const { urlPath, init } = expensesBffPost("refuse_expense_sheet", [
        organizationId,
        sheetId,
        stdbParamsToJson(params ?? {}),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to refuse expense sheet')
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expense-sheets', k] }),
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets-to-approve', k] }),
      ])
    },
  })
}

export function usePostExpenseSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      params,
    }: {
      sheetId: string | number | bigint
      params: Partial<PostExpenseSheetParams>
    }) => {
      const { urlPath, init } = expensesBffPost("post_expense_sheet", [
        organizationId,
        sheetId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to post expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useCreateExpenseReimbursementPayment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      params,
    }: {
      sheetId: string | number | bigint
      params: Partial<CreateExpenseReimbursementParams>
    }) => {
      const { urlPath, init } = expensesBffPost("create_expense_reimbursement_payment", [
        organizationId,
        sheetId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to reimburse expense sheet')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useUpsertExpenseMileageRate(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      rateId,
      params,
    }: {
      rateId?: string | number | bigint | null
      params: Partial<UpsertExpenseMileageRateParams>
    }) => {
      const { urlPath, init } = expensesBffPost("upsert_expense_mileage_rate", [
        organizationId,
        rateId ?? null,
        stdbParamsToJson({ ...params, companyId: params.companyId ?? companyId }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to upsert mileage rate')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useUpsertExpensePerDiemRate(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      rateId,
      params,
    }: {
      rateId?: string | number | bigint | null
      params: Partial<UpsertExpensePerDiemRateParams>
    }) => {
      const { urlPath, init } = expensesBffPost("upsert_expense_per_diem_rate", [
        organizationId,
        rateId ?? null,
        stdbParamsToJson({ ...params, companyId: params.companyId ?? companyId }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to upsert per diem rate')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useSetExpenseAllocations(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expenseId,
      params,
    }: {
      expenseId: string | number | bigint
      params: SetExpenseAllocationsParams
    }) => {
      const { urlPath, init } = expensesBffPost("set_expense_allocations", [
        organizationId,
        expenseId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to set expense allocations')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateExpenseProjectRebill(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      params,
    }: {
      sheetId: string | number | bigint
      params: Partial<CreateExpenseProjectRebillParams>
    }) => {
      const { urlPath, init } = expensesBffPost("create_expense_project_rebill", [
        organizationId,
        sheetId,
        stdbParamsToJson(params),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to create project rebill')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useCreateExpenseIntegrationIntent(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      intentType: string
      idempotencyKey: string
      deviceId?: string
      payload: string
      metadata?: string
    }) => {
      const { urlPath, init } = expensesBffPost("create_expense_integration_intent", [
        organizationId,
        stdbParamsToJson({
          companyId,
          intentType: params.intentType,
          idempotencyKey: params.idempotencyKey,
          deviceId: params.deviceId,
          payload: params.payload,
          metadata: params.metadata,
        }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to create integration intent')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useApplyExpenseIntegrationIntent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (intentId: string | number | bigint) => {
      const { urlPath, init } = expensesBffPost("apply_expense_integration_intent", [
        organizationId,
        intentId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to apply integration intent')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useSetExpenseFraudHold(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expenseId,
      fraudHold,
      fraudReason,
    }: {
      expenseId: string | number | bigint
      fraudHold: boolean
      fraudReason?: string
    }) => {
      const { urlPath, init } = expensesBffPost("set_expense_fraud_hold", [
        organizationId,
        expenseId,
        stdbParamsToJson({ fraudHold, fraudReason }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to set fraud hold')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateExpenseAdvance(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = expensesBffPost("create_expense_advance", [
        organizationId,
        stdbParamsToJson({ ...params, companyId: params.companyId ?? companyId }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to create advance')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useApplyExpenseAdvanceToSheet(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      advanceId,
      sheetId,
      amount,
    }: {
      advanceId: string | number | bigint
      sheetId: string | number | bigint
      amount: number
    }) => {
      const { urlPath, init } = expensesBffPost("apply_expense_advance_to_sheet", [
        organizationId,
        advanceId,
        sheetId,
        stdbParamsToJson({ amount }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to apply advance')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useCreateExpenseCardStatementLine(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = expensesBffPost("create_expense_card_statement_line", [
        organizationId,
        stdbParamsToJson(
          { ...params, companyId: params.companyId ?? companyId },
          "CreateExpenseCardStatementLineParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to create card statement line')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useMatchExpenseCardStatementLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      statementLineId,
      expenseId,
    }: {
      statementLineId: string | number | bigint
      expenseId: string | number | bigint
    }) => {
      const { urlPath, init } = expensesBffPost("match_expense_card_statement_line", [
        organizationId,
        statementLineId,
        stdbParamsToJson({ expenseId, metadata: null }, "MatchExpenseCardStatementLineParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to match statement line')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useApplyPendingExpenseIntegrationIntents(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (limit = 20) => {
      const { urlPath, init } = expensesBffPost("apply_pending_expense_integration_intents", [
        organizationId,
        limit,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r) || 'Failed to apply pending intents')
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
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
export type {
  CreateExpenseParams,
  CreateExpenseSheetParams,
  PostExpenseSheetParams,
  CreateExpenseReimbursementParams,
  CreateExpenseProjectRebillParams,
  SetExpenseAllocationsParams,
} from '@lumiere/stdb/types'
