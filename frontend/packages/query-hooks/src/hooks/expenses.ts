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

/** Server-bounded: card statement lines with `status = unmatched`. */
export function useExpenseCardStatementUnmatched(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['expense-card-statement-unmatched', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/expense-card-statement-unmatched',
        'Failed to fetch unmatched card statement lines',
      ),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useExpenseReceipts(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expense-receipts', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/expense-receipts', 'Failed to fetch expense receipts'),
    staleTime: 15_000,
    initialData,
  })
}

/** Open / partially applied advances with residual. */
export function useExpenseAdvances(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expense-advances', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/expense-advances', 'Failed to fetch expense advances'),
    staleTime: 15_000,
    initialData,
  })
}

/** Pending policy exceptions queue. */
export function useExpensePolicyExceptions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expense-policy-exceptions', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/expense-policy-exceptions',
        'Failed to fetch policy exceptions',
      ),
    staleTime: 15_000,
    initialData,
  })
}

/** Active mileage rates for travel expense selects. */
export function useExpenseMileageRates(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expense-mileage-rates', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/expense-mileage-rates', 'Failed to fetch mileage rates'),
    staleTime: 30_000,
    initialData,
  })
}

/** Active per-diem rates for travel expense selects. */
export function useExpensePerDiemRates(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['expense-per-diem-rates', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/expense-per-diem-rates', 'Failed to fetch per-diem rates'),
    staleTime: 30_000,
    initialData,
  })
}

export type CreateExpenseReceiptInput = {
  employeeId: bigint
  storageKey: string
  fileName?: string
  mimeType?: string
  contentHash?: string
  clientRequestId?: string
  companyId?: bigint
}

/** Register a receipt row, then resolve its id via client_request_id (reducers do not return ids). */
export async function createExpenseReceiptAndResolveId(
  organizationId: bigint,
  params: CreateExpenseReceiptInput,
): Promise<bigint> {
  const clientRequestId =
    params.clientRequestId ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `rcpt-${crypto.randomUUID()}`
      : `rcpt-${Date.now()}`)
  const { urlPath, init } = expensesBffPost("create_expense_receipt", [
    organizationId,
    stdbParamsToJson(
      {
        companyId: params.companyId,
        employeeId: params.employeeId,
        storageKey: params.storageKey,
        fileName: params.fileName,
        mimeType: params.mimeType,
        contentHash: params.contentHash,
        clientRequestId,
      },
      "CreateExpenseReceiptParams",
    ),
  ])
  const r = await apiFetch(urlPath, init)
  if (!r.ok) throw new Error(await parseCallErrorExpenses(r, "Failed to create expense receipt"))
  const rows = await fetchQueryList(
    "/api/query/expense-receipts",
    "Failed to fetch expense receipts",
  )
  const match = rows.find((row) => {
    const key = row.clientRequestId ?? row.client_request_id
    return key != null && String(key) === clientRequestId
  })
  if (match?.id == null) {
    throw new Error("Receipt created but id could not be resolved")
  }
  return BigInt(String(match.id))
}

export function useCreateExpenseReceipt(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateExpenseReceiptInput) => {
      return createExpenseReceiptAndResolveId(organizationId, {
        ...params,
        companyId: params.companyId ?? companyId,
      })
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ["expense-receipts", k] })
      void qc.invalidateQueries({ queryKey: ["expenses-missing-receipt", k] })
    },
  })
}

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
        stdbParamsToJson(finalized, "CreateExpenseParams"),
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
        stdbParamsToJson(finalized, "CreateExpenseSheetParams"),
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
        stdbParamsToJson(patch, "UpdateExpenseParams"),
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to submit expense sheet'))
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to approve expense sheet'))
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
        stdbParamsToJson(params ?? {}, "RefuseExpenseSheetParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to refuse expense sheet'))
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
        stdbParamsToJson(params, "PostExpenseSheetParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to post expense sheet'))
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
        stdbParamsToJson(params, "CreateExpenseReimbursementParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to reimburse expense sheet'))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', k] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets-to-approve', k] }),
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
        stdbParamsToJson(
          { ...params, companyId: params.companyId ?? companyId },
          "UpsertExpenseMileageRateParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to upsert mileage rate'))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['expenses', k] })
      void qc.invalidateQueries({ queryKey: ['expense-mileage-rates', k] })
    },
  })
}

export function useSeedStatutoryExpenseMileageRates(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { currencyId: bigint; companyId?: bigint }) => {
      const { urlPath, init } = expensesBffPost("seed_statutory_expense_mileage_rates", [
        organizationId,
        stdbParamsToJson(
          {
            companyId: params.companyId ?? companyId,
            currencyId: params.currencyId,
          },
          "SeedStatutoryExpenseMileageRatesParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        throw new Error(
          await parseCallErrorExpenses(r, "Failed to seed statutory mileage rates"),
        )
      }
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ["expense-mileage-rates", k] })
      void qc.invalidateQueries({ queryKey: ["expenses", k] })
    },
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
        stdbParamsToJson(
          { ...params, companyId: params.companyId ?? companyId },
          "UpsertExpensePerDiemRateParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to upsert per diem rate'))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['expenses', k] })
      void qc.invalidateQueries({ queryKey: ['expense-per-diem-rates', k] })
    },
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to set expense allocations'))
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
        stdbParamsToJson(params, "CreateExpenseProjectRebillParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to create project rebill'))
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
        stdbParamsToJson(
          {
            companyId,
            intentType: params.intentType,
            idempotencyKey: params.idempotencyKey,
            deviceId: params.deviceId,
            payload: params.payload,
            metadata: params.metadata,
          },
          "CreateExpenseIntegrationIntentParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to create integration intent'))
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to apply integration intent'))
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
        stdbParamsToJson({ fraudHold, fraudReason }, "SetExpenseFraudHoldParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to set fraud hold'))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

export function useRequestExpensePolicyException(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expenseId,
      reason,
    }: {
      expenseId: string | number | bigint
      reason: string
    }) => {
      const { urlPath, init } = expensesBffPost("request_expense_policy_exception", [
        organizationId,
        expenseId,
        stdbParamsToJson({ reason }, "RequestExpensePolicyExceptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to request policy exception'))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-policy-exceptions', k] }),
      ])
    },
  })
}

export function useApproveExpensePolicyException(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (exceptionId: string | number | bigint) => {
      const { urlPath, init } = expensesBffPost("approve_expense_policy_exception", [
        organizationId,
        exceptionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to approve policy exception'))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-policy-exceptions', k] }),
      ])
    },
  })
}

export function useRejectExpensePolicyException(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      exceptionId,
      reason,
    }: {
      exceptionId: string | number | bigint
      reason: string
    }) => {
      const { urlPath, init } = expensesBffPost("reject_expense_policy_exception", [
        organizationId,
        exceptionId,
        stdbParamsToJson({ reason }, "RejectExpensePolicyExceptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to reject policy exception'))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-policy-exceptions', k] }),
      ])
    },
  })
}

export function useCreateExpenseAdvance(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = expensesBffPost("create_expense_advance", [
        organizationId,
        stdbParamsToJson(
          { ...params, companyId: params.companyId ?? companyId },
          "CreateExpenseAdvanceParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to create advance'))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-advances', k] }),
      ])
    },
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
        stdbParamsToJson({ amount }, "ApplyExpenseAdvanceParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to apply advance'))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', k] }),
        qc.invalidateQueries({ queryKey: ['expense-sheets', k] }),
        qc.invalidateQueries({ queryKey: ['expense-advances', k] }),
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to create card statement line'))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['expenses', k] })
      void qc.invalidateQueries({ queryKey: ['expense-card-statement-unmatched', k] })
    },
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
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to match statement line'))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['expenses', k] })
      void qc.invalidateQueries({ queryKey: ['expense-card-statement-unmatched', k] })
    },
  })
}

export function useUnmatchExpenseCardStatementLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      statementLineId,
    }: {
      statementLineId: string | number | bigint
    }) => {
      const { urlPath, init } = expensesBffPost("unmatch_expense_card_statement_line", [
        organizationId,
        statementLineId,
        stdbParamsToJson({ metadata: null }, "UnmatchExpenseCardStatementLineParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to unmatch statement line'))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['expenses', k] })
      void qc.invalidateQueries({ queryKey: ['expense-card-statement-unmatched', k] })
    },
  })
}

export function useApplyPendingExpenseIntegrationIntents(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number | undefined>({
    mutationFn: async (limit = 20) => {
      const { urlPath, init } = expensesBffPost("apply_pending_expense_integration_intents", [
        organizationId,
        limit,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorExpenses(r, 'Failed to apply pending intents'))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['expenses', rqBigIntKey(organizationId)] }),
  })
}

// ── CSV imports (organization_id, csv_data) ───────────────────────────────────

import { responseErrorMessage as parseCallErrorExpenses } from "@lumiere/api-client/response-error"

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
