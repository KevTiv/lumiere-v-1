"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type {
  AccountAccountTypeQueryRow,
  AccountAccountQueryRow,
  AccountJournalQueryRow,
  AccountMoveLineQueryRow,
  AccountMoveQueryRow,
  AccountTaxQueryRow,
} from "@lumiere/stdb/resource-reads"
import { createStdbSdk } from "@lumiere/stdb/sdk"
import { apiFetch } from "../../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  paymentParamsToJson,
  type ClearablePatch,
} from "@lumiere/erp-shared/accounting-create-params"
import { stdbParamsToJson, encodeOptionalU64 } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
import type {
  AccountFiscalYear,
  AccountPeriod,
  AddAccountMoveLineParams,
  AllocatePaymentParams,
  CreateAccountAccountParams,
  CreateAccountAccountTypeParams,
  CreateAccountAssetParams,
  CreateAccountBankStatementParams,
  CreateAccountGroupParams,
  CreateAccountJournalParams,
  CreateAccountMoveParams,
  CreateAccountTaxParams,
  CreateCreditNoteParams,
  CreateCrossoveredBudgetLineParams,
  CreateCrossoveredBudgetParams,
  CreateCurrencyRateParams,
  CreatePaymentAccountParams,
  CreatePaymentFeeParams,
  CreatePaymentParams,
  CreatePaymentTransactionParams,
  CrossoveredBudget,
  DeleteAccountMoveLineParams,
  DeprecateAccountAccountParams,
  DisposeAccountAssetParams,
  ReversePaymentTransactionParams,
  StageBankStatementImportParams,
  UpdateAccountAccountParams,
  UpdateAccountAssetParams,
  UpdateAccountBankStatementParams,
  UpdateAccountAccountTypeParams,
  UpdateAccountGroupParams,
  UpdateAccountJournalParams,
  UpdateAccountTaxParams,
  UpdateCrossoveredBudgetLineParams,
  UpdateCrossoveredBudgetParams,
} from "@lumiere/stdb/types"
import {
  invalidateStdbQueryResources,
  useCompanyScopedTypedQuery,
  useTypedStdbQuery,
} from "../stdb"
import { stdbInvalidationFor } from "@lumiere/contracts/stdb-reducer-invalidation"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"
export function useCrossoveredBudgets(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: CrossoveredBudget[] },
) {
  return useTypedStdbQuery("budgets", organizationId, options)
}

export function useBudgetLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("budget-lines", organizationId, options)
}

export function useBudgetPosts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("budget-posts", organizationId, options)
}

export function useCreateCrossoveredBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateCrossoveredBudgetParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_crossovered_budget", { params: stdbParamsToJson(params as object, "CreateCrossoveredBudgetParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useUpdateCrossoveredBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { budgetId: bigint; params: ClearablePatch<UpdateCrossoveredBudgetParams> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_crossovered_budget", {
        budgetId: args.budgetId,
        params: stdbParamsToJson(args.params as object, "UpdateCrossoveredBudgetParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("update_crossovered_budget")),
  })
}

export function useCreateBudgetLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { budgetId: bigint; params: CreateCrossoveredBudgetLineParams }) => {
      const { urlPath, init } = stdbBffCommandPost("create_budget_line", {
        budgetId: args.budgetId,
        params: stdbParamsToJson(args.params as object, "CreateCrossoveredBudgetLineParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_budget_line")),
  })
}

export function useUpdateBudgetLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: ClearablePatch<UpdateCrossoveredBudgetLineParams> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_budget_line", {
        lineId: args.lineId,
        params: stdbParamsToJson(args.params as object, "UpdateCrossoveredBudgetLineParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("update_budget_line")),
  })
}

export function useConfirmBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("confirm_budget", { budgetId: budgetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useValidateBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("validate_budget", { budgetId: budgetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useDoneBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("done_budget", { budgetId: budgetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useCancelBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_budget", { budgetId: budgetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useDeleteBudgetLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_budget_line", { lineId: lineId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useUpdateBudgetLineActuals(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      lineId: bigint
      params: { practicalAmount: number; theoreticalAmount: number }
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_budget_line_actuals", { lineId: args.lineId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useCreateBudgetPost(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_budget_post", { params: stdbParamsToJson(params as object, "CreateBudgetPostParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useUpdateBudgetPost(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { postId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_budget_post", { postId: args.postId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function invalidateBudgetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  // `stdbQueryKey` (hooks/stdb.ts) stringifies the organization id, so the invalidation key
  // must match that shape or React Query will not match the cached query and the new row never
  // refetches (this was the root cause of the budget-create E2E failure).
  const k = String(organizationId)
  void qc.invalidateQueries({ queryKey: ["stdb", "budgets", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "budget-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "budget-posts", k] })
}
