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
export function useIntercompanyRules(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("intercompany-rules", organizationId, options)
}

export function useIntercompanyTransactions(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("intercompany-transactions", organizationId, options)
}

export function useCreateIntercompanyRule(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      sourceCompanyId: bigint
      destinationCompanyId: bigint
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = stdbBffCommandPost("create_intercompany_rule", { sourceCompanyId: args.sourceCompanyId, destinationCompanyId: args.destinationCompanyId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useUpdateIntercompanyRule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { ruleId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_intercompany_rule", { companyId: companyId, ruleId: args.ruleId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useDeleteIntercompanyRule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ruleId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_intercompany_rule", { companyId: companyId, ruleId: ruleId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useSetIntercompanyRuleActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { ruleId: bigint; isActive: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("set_intercompany_rule_active", { companyId: companyId, ruleId: args.ruleId, isActive: args.isActive })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useCreateIntercompanyTransaction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { originCompanyId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("create_intercompany_transaction", { originCompanyId: args.originCompanyId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["intercompany-transactions"])
    },
  })
}

export function useApproveIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("approve_intercompany_transaction", { companyId: companyId, transactionId: transactionId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useProcessIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("process_intercompany_transaction", { companyId: companyId, transactionId: args.transactionId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useCompleteIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("complete_intercompany_transaction", { companyId: companyId, transactionId: transactionId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useErrorIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; errorMessage: string }) => {
      const { urlPath, init } = stdbBffCommandPost("error_intercompany_transaction", { companyId: companyId, transactionId: args.transactionId, params: { errorMessage: args.errorMessage } })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useCancelIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; reason: string }) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_intercompany_transaction", { companyId: companyId, transactionId: args.transactionId, params: { reason: args.reason } })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useRetryIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("retry_intercompany_transaction", { companyId: companyId, transactionId: transactionId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function invalidateIntercompanyQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-rules", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-transactions", k] })
}
