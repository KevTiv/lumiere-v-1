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
export function useAccountAnalyticAccounts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useTypedStdbQuery("analytic-accounts", organizationId, options)
}

export function useAccountAnalyticLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("analytic-lines", organizationId, options)
}

export function useAccountAnalyticDistributionModels(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("analytic-distribution-models", organizationId, options)
}

export function useCreateAnalyticAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_analytic_account", { params: stdbParamsToJson(params as object, "CreateAnalyticAccountParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useUpdateAnalyticAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_analytic_account", { accountId: args.accountId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useSetAnalyticAccountActive(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; active: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("set_analytic_account_active", { accountId: args.accountId, active: args.active })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useCreateAnalyticLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_analytic_line", { params: stdbParamsToJson(params as object, "CreateAnalyticLineParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useUpdateAnalyticLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_analytic_line", { lineId: args.lineId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useDeleteAnalyticLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_analytic_line", { lineId: lineId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useCreateAnalyticDistributionModel(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_analytic_distribution_model", { params: stdbParamsToJson(params as object, "CreateAnalyticDistributionModelParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useUpdateAnalyticDistributionModel(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { modelId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_analytic_distribution_model", { modelId: args.modelId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function invalidateAnalyticQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-distribution-models", k] })
}
