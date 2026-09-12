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

export type BankStatementImportWorkspace = {
  imports: Record<string, unknown>[]
  lines: Record<string, unknown>[]
}

export function useAccountBankStatements(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useTypedStdbQuery("bank-statements", organizationId, options)
}

export function useAccountBankStatementLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("bank-statement-lines", organizationId, options)
}

export function useBankStatementImports(organizationId: bigint, companyId: bigint, enabled = true) {
  return useQuery<BankStatementImportWorkspace>({
    queryKey: ["bank-statement-imports", String(organizationId), String(companyId)],
    enabled: enabled && organizationId > 0n && companyId > 0n,
    queryFn: async () => {
      const response = await apiFetch(`/api/accounting/bank-statement-imports/${companyId}`)
      if (!response.ok) throw new Error(await parseCallError(response))
      const body = (await response.json()) as Partial<BankStatementImportWorkspace>
      return { imports: body.imports ?? [], lines: body.lines ?? [] }
    },
    staleTime: 15_000,
  })
}

export function useCreateAccountBankStatement(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: bigint
      journalId: bigint
      params: CreateAccountBankStatementParams
    }) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_bank_statement", {
        companyId: args.companyId,
        journalId: args.journalId,
        params: stdbParamsToJson(args.params as object, "CreateAccountBankStatementParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_bank_statement")),
  })
}

export function useUpdateAccountBankStatement(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: bigint
      statementId: bigint
      params: UpdateAccountBankStatementParams
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_account_bank_statement", {
        companyId: args.companyId,
        statementId: args.statementId,
        params: stdbParamsToJson(args.params as object, "UpdateAccountBankStatementParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("update_account_bank_statement")),
  })
}

export function useStageBankStatementImport(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: bigint
      journalId: bigint
      currencyId: bigint
      params: StageBankStatementImportParams
    }) => {
      const { urlPath, init } = stdbBffCommandPost("stage_bank_statement_import", { companyId: args.companyId, journalId: args.journalId, currencyId: args.currencyId, params: stdbParamsToJson(args.params as object, "StageBankStatementImportParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useApproveBankStatementImport(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (importId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("approve_bank_statement_import", { importId: importId })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function usePostAccountBankStatement(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("post_account_bank_statement", {
        companyId,
        statementId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountBankStatement(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_account_bank_statement", {
        companyId,
        statementId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useCreateAccountBankStatementLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { statementId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_bank_statement_line", {
        companyId,
        statementId: args.statementId,
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUpdateAccountBankStatementLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_account_bank_statement_line", {
        companyId,
        lineId: args.lineId,
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountBankStatementLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_account_bank_statement_line", {
        companyId,
        lineId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useBankMatchCandidates(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("bank-match-candidates", organizationId, options)
}

export function useAccountReconciliationWidgets(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("account-reconciliation-widgets", organizationId, options)
}

export function useMatchBankLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; ruleId: number | null }) => {
      const { urlPath, init } = stdbBffCommandPost("match_bank_line", { lineId: args.lineId, ruleId: args.ruleId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useApplyReconciliationRules(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; ruleId: number | null }) => {
      const { urlPath, init } = stdbBffCommandPost("apply_reconciliation_rules", { lineId: args.lineId, ruleId: args.ruleId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useReconcileAccountBankStatementLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("reconcile_account_bank_statement_line", {
        companyId,
        lineId: args.lineId,
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUnreconciledAccountBankStatementLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("unreconciled_account_bank_statement_line", {
        companyId,
        lineId: args.lineId,
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useCreateAccountReconciliationWidget(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_reconciliation_widget", {
        companyId,
        params: stdbParamsToJson(params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUpdateAccountReconciliationWidget(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { widgetId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_account_reconciliation_widget", {
        companyId,
        widgetId: args.widgetId,
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountReconciliationWidget(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (widgetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_account_reconciliation_widget", {
        companyId,
        widgetId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function invalidateBankStatementQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-statements", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-statement-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-match-candidates", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-reconciliation-widgets", k] })
  void qc.invalidateQueries({ queryKey: ["bank-statement-imports", String(k)] })
}
