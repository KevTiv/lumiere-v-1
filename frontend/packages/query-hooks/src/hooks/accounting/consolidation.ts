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
export function useConsolidationAccounts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("consolidation-accounts", organizationId, options)
}

export function useConsolidationJournals(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("consolidation-journals", organizationId, options)
}

export function useConsolidationEliminationEntries(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("consolidation-elimination-entries", organizationId, options)
}

export function useCreateConsolidationAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_consolidation_account", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useUpdateConsolidationAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_consolidation_account", { accountId: args.accountId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCreateConsolidationJournal(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_consolidation_journal", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCreateEliminationEntry(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_elimination_entry", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useProcessConsolidation(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (journalId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("process_consolidation", { journalId: journalId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useValidateConsolidation(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (journalId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("validate_consolidation", { journalId: journalId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCancelConsolidation(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { journalId: bigint; reason: string }) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_consolidation", { journalId: args.journalId, reason: args.reason })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useSetConsolidationCompanyRate(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("set_consolidation_company_rate", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useMatchEliminationEntries(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { entryId: bigint; matchedEntryId: bigint }) => {
      const { urlPath, init } = stdbBffCommandPost("match_elimination_entries", { entryId: args.entryId, matchedEntryId: args.matchedEntryId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useUnmatchEliminationEntry(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entryId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("unmatch_elimination_entry", { entryId: entryId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function invalidateConsolidationQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "consolidation-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "consolidation-journals", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "consolidation-elimination-entries", k] })
}
