"use client"

import { apiFetch } from "../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  paymentParamsToJson,
  type ClearablePatch,
} from "@lumiere/erp-shared/accounting-create-params"
import { stdbParamsToJson, encodeOptionalU64, encodeReducerCallArgs } from "@lumiere/erp-shared/stdb-params-json"
import type {
  AllocatePaymentParams,
  CreateAccountAccountTypeParams,
  CreateAccountGroupParams,
  CreateCurrencyRateParams,
  CreatePaymentAccountParams,
  CreatePaymentFeeParams,
  CreatePaymentParams,
  CreatePaymentTransactionParams,
  ReversePaymentTransactionParams,
  StageBankStatementImportParams,
  UpdateAccountAccountTypeParams,
  UpdateAccountGroupParams,
} from "@lumiere/stdb/types"
import { accountingBffPost, type AccountingBffReducerKey } from "@lumiere/stdb/commands"
import { invalidateStdbQueryResources, useStdbQuery } from "./stdb"
import { stdbInvalidationFor } from "@lumiere/contracts/stdb-reducer-invalidation"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Type Imports from @lumiere/stdb ─────────────────────────────────────────

export type {
  AccountAccount,
  AccountMove,
  AccountMoveLine,
  AccountTax,
  CrossoveredBudget,
  AccountAnalyticAccount,
  AccountBankStatement,
  AccountAsset as AccountFixedAsset,
  AccountJournal,
  CreateAccountAccountParams,
  CreateAccountMoveParams,
  CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
  CreateAccountBankStatementParams,
  CreateAccountJournalParams,
} from "@lumiere/stdb/types"

// ── Query Hooks ───────────────────────────────────────────────────────────────

/**
 * Fetch all accounts (chart of accounts) for the organization.
 */
export function useAccountAccounts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("account-accounts", organizationId, options)
}

/** Account types (chart classification / user types) for the organization. */
export function useAccountAccountTypes(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("account-account-types", organizationId, options)
}

/** Account groups (hierarchy / code ranges) for the organization. */
export function useAccountGroups(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("account-groups", organizationId, options)
}

/**
 * Fetch all account moves (journal entries/invoices) for the organization.
 */
export function useAccountMoves(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("account-moves", organizationId, options)
}

/**
 * Fetch all account move lines for the organization.
 */
export function useAccountMoveLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useStdbQuery("account-move-lines", organizationId, options)
}

/**
 * Fetch all taxes for the organization.
 */
export function useAccountTaxes(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useStdbQuery("account-taxes", organizationId, options)
}

/**
 * Fetch all budgets for the organization.
 */
export function useCrossoveredBudgets(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("budgets", organizationId, options)
}

/** Fiscal years (TanStack scope = organization id, same key as other accounting `useStdbQuery` hooks). */
export function useAccountFiscalYears(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("fiscal-years", organizationId, options)
}

/** Accounting periods (TanStack scope = organization id). */
export function useAccountPeriods(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("account-periods", organizationId, options)
}

/**
 * Budget lines (planned vs actual) for the organization.
 */
export function useBudgetLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("budget-lines", organizationId, options)
}

/**
 * Budget positions (account groupings for budgeting).
 */
export function useBudgetPosts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("budget-posts", organizationId, options)
}

/**
 * Fetch all analytic accounts for the organization.
 */
export function useAccountAnalyticAccounts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useStdbQuery("analytic-accounts", organizationId, options)
}

/**
 * Fetch all bank statements for the organization.
 */
export function useAccountBankStatements(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useStdbQuery("bank-statements", organizationId, options)
}

/**
 * Bank statement lines for the organization (all statements; filter client-side by statementId).
 */
export function useAccountBankStatementLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("bank-statement-lines", organizationId, options)
}

export type BankStatementImportWorkspace = {
  imports: Record<string, unknown>[]
  lines: Record<string, unknown>[]
}

/** Reviewed CSV statement-import batches, loaded from the scoped accounting API. */
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

/**
 * Fetch all fixed assets for the organization.
 */
export function useAccountFixedAssets(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useStdbQuery("fixed-assets", organizationId, options)
}

/** AP/AR payment terms for the organization. */
export function useAccountPaymentTerms(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("account-payment-terms", organizationId, options)
}

/** Installment lines for payment terms in this organization. */
export function useAccountPaymentTermLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("account-payment-term-lines", organizationId, options)
}

/** Customer/vendor payments (draft and posted). */
export function useAccountPayments(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("account-payments", organizationId, options)
}

/** Operational cash, bank, and mobile-money accounts. */
export function usePaymentAccounts(organizationId: bigint) {
  return useStdbQuery("payment-accounts", organizationId)
}

/** Provider and settlement fees recorded against operational payment transactions. */
export function usePaymentFees(organizationId: bigint) {
  return useStdbQuery("payment-fees", organizationId)
}

/** Draft, posted, and corrected operational payment transactions. */
export function usePaymentTransactions(organizationId: bigint) {
  return useStdbQuery("payment-transactions", organizationId)
}

export function usePaymentReconciliations(organizationId: bigint) {
  return useStdbQuery("payment-reconciliations", organizationId)
}

export function usePaymentReversals(organizationId: bigint) {
  return useStdbQuery("payment-reversals", organizationId)
}

function invalidateOperationalPaymentQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  for (const resource of [
    "payment-accounts",
    "payment-fees",
    "payment-reconciliations",
    "payment-reversals",
    "payment-transactions",
    "account-moves",
    "account-move-lines",
    "account-payments",
  ]) {
    void qc.invalidateQueries({ queryKey: ["stdb", resource, String(organizationId)] })
  }
}

export function useCreatePaymentAccount(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePaymentAccountParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = accountingBffPost("create_payment_account", [
        organizationId,
        stdbParamsToJson(params, "CreatePaymentAccountParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function useCreatePaymentTransaction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePaymentTransactionParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = accountingBffPost("create_payment_transaction", [
        organizationId,
        stdbParamsToJson(params, "CreatePaymentTransactionParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function usePostPaymentTransaction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint>({
    mutationFn: async (transactionId) => {
      const { urlPath, init } = accountingBffPost("post_payment_transaction", [organizationId, transactionId])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function useAllocatePaymentTransaction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, AllocatePaymentParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = accountingBffPost("allocate_payment_transaction", [
        organizationId,
        stdbParamsToJson(params, "AllocatePaymentParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function useReversePaymentTransaction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { transactionId: bigint; params: ReversePaymentTransactionParams }>({
    mutationFn: async ({ transactionId, params }) => {
      const { urlPath, init } = accountingBffPost("reverse_payment_transaction", [
        organizationId,
        transactionId,
        stdbParamsToJson(params, "ReversePaymentTransactionParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

/** Void a draft provider transaction before it is posted to the ledger. */
export function useVoidPaymentTransaction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint>({
    mutationFn: async (transactionId) => {
      const { urlPath, init } = accountingBffPost("void_payment_transaction", [organizationId, transactionId])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

/** Add an explicit provider fee to a draft operational payment transaction. */
export function useCreatePaymentFee(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePaymentFeeParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = accountingBffPost("create_payment_fee", [
        organizationId,
        stdbParamsToJson(params, "CreatePaymentFeeParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

/**
 * Fetch all account journals for the organization.
 */
export function useAccountJournals(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("account-journals", organizationId, options)
}

/**
 * Analytic accounting lines for the organization.
 */
export function useAccountAnalyticLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("analytic-lines", organizationId, options)
}

/**
 * Analytic distribution models (auto-split rules).
 */
export function useAccountAnalyticDistributionModels(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("analytic-distribution-models", organizationId, options)
}

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function useAccountingCallMutation(
  reducer: AccountingBffReducerKey,
  organizationId: bigint | number,
  invalidateResources: readonly string[],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: unknown[]) => {
      const { urlPath, init } = accountingBffPost(reducer, args)
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Reducer ${reducer} failed`)
      }
    },
    onSuccess: () => invalidateStdbQueryResources(qc, organizationId, invalidateResources),
  })
}

function invalidateBudgetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  // `stdbQueryKey` (hooks/stdb.ts) stringifies the organization id, so the invalidation key
  // must match that shape or React Query will not match the cached query and the new row never
  // refetches (this was the root cause of the budget-create E2E failure).
  const k = String(organizationId)
  void qc.invalidateQueries({ queryKey: ["stdb", "budgets", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "budget-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "budget-posts", k] })
}

function invalidateChartStructureQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "account-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-account-types", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-groups", k] })
}

/** Account taxes + related tax master data (TanStack scope = organization id). */
function invalidateTaxQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_tax"))
}

// ── Mutation Hooks ────────────────────────────────────────────────────────────

/**
 * Create a new account in the chart of accounts.
 */
export function useCreateAccountAccount(organizationId: number) {
  return useAccountingCallMutation(
    "create_account_account",
    organizationId,
    stdbInvalidationFor("create_account_account"),
  )
}

/**
 * Update an existing account.
 */
export function useUpdateAccountAccount(organizationId: number) {
  return useAccountingCallMutation(
    "update_account_account",
    organizationId,
    stdbInvalidationFor("update_account_account"),
  )
}

/**
 * Deprecate (soft-delete) an account.
 */
export function useDeprecateAccountAccount(organizationId: number) {
  return useAccountingCallMutation(
    "deprecate_account_account",
    organizationId,
    stdbInvalidationFor("deprecate_account_account"),
  )
}

/**
 * Create a new account move (journal entry).
 */
export function useCreateAccountMove(organizationId: number) {
  return useAccountingCallMutation(
    "create_account_move",
    organizationId,
    stdbInvalidationFor("create_account_move"),
  )
}

/**
 * Post an account move (confirm it).
 */
export function usePostAccountMove(organizationId: number) {
  return useAccountingCallMutation(
    "post_account_move",
    organizationId,
    stdbInvalidationFor("post_account_move"),
  )
}

/**
 * Post a customer/vendor invoice or refund (totals + optional COGS lines).
 */
export function usePostInvoice(organizationId: number) {
  return useAccountingCallMutation("post_invoice", organizationId, stdbInvalidationFor("post_invoice"))
}

/**
 * Create a draft credit note (OutRefund) from a posted customer invoice.
 */
export function useCreateCreditNoteFromInvoice(organizationId: number) {
  return useAccountingCallMutation(
    "create_credit_note_from_invoice",
    organizationId,
    ["account-moves", "account-move-lines"],
  )
}

/**
 * Cancel an account move.
 */
export function useCancelAccountMove(organizationId: number) {
  return useAccountingCallMutation(
    "cancel_account_move",
    organizationId,
    stdbInvalidationFor("cancel_account_move"),
  )
}

/**
 * Add a line to an account move.
 */
export function useAddAccountMoveLine(organizationId: number) {
  return useAccountingCallMutation(
    "add_account_move_line",
    organizationId,
    stdbInvalidationFor("add_account_move_line"),
  )
}

/**
 * Delete an account move line.
 */
export function useDeleteAccountMoveLine(organizationId: number) {
  return useAccountingCallMutation(
    "delete_account_move_line",
    organizationId,
    stdbInvalidationFor("delete_account_move_line"),
  )
}

/**
 * Create a new tax.
 */
export function useCreateAccountTax(organizationId: number) {
  return useAccountingCallMutation(
    "create_account_tax",
    organizationId,
    stdbInvalidationFor("create_account_tax"),
  )
}

/**
 * Update an existing tax.
 */
export function useUpdateAccountTax(organizationId: number) {
  return useAccountingCallMutation(
    "update_account_tax",
    organizationId,
    stdbInvalidationFor("update_account_tax"),
  )
}

/**
 * Create a new budget (crossovered budget header).
 */
export function useCreateCrossoveredBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_crossovered_budget", [
        organizationId,
        stdbParamsToJson(params as object, "CreateCrossoveredBudgetParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useCreateAccountAccountType(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAccountAccountTypeParams) => {
      const { urlPath, init } = accountingBffPost("create_account_account_type", [
        organizationId,
        stdbParamsToJson(params as object, "CreateAccountAccountTypeParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useUpdateAccountAccountType(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      typeId: bigint
      params: ClearablePatch<UpdateAccountAccountTypeParams>
    }) => {
      const { urlPath, init } = accountingBffPost("update_account_account_type", [
        organizationId,
        args.typeId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useCreateAccountGroup(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAccountGroupParams) => {
      const { urlPath, init } = accountingBffPost("create_account_group", [
        organizationId,
        stdbParamsToJson(params as object, "CreateAccountGroupParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useUpdateAccountGroup(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      groupId: bigint
      params: ClearablePatch<UpdateAccountGroupParams>
    }) => {
      const { urlPath, init } = accountingBffPost("update_account_group", [
        organizationId,
        args.groupId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

/**
 * Update an existing budget.
 */
export function useUpdateCrossoveredBudget(organizationId: number) {
  return useAccountingCallMutation(
    "update_crossovered_budget",
    organizationId,
    stdbInvalidationFor("update_crossovered_budget"),
  )
}

/**
 * Create a new budget line.
 */
export function useCreateBudgetLine(organizationId: number) {
  return useAccountingCallMutation(
    "create_budget_line",
    organizationId,
    stdbInvalidationFor("create_budget_line"),
  )
}

/**
 * Update an existing budget line.
 */
export function useUpdateBudgetLine(organizationId: number) {
  return useAccountingCallMutation(
    "update_budget_line",
    organizationId,
    stdbInvalidationFor("update_budget_line"),
  )
}

export function useConfirmBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const { urlPath, init } = accountingBffPost("confirm_budget", [organizationId, budgetId])
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
      const { urlPath, init } = accountingBffPost("validate_budget", [organizationId, budgetId])
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
      const { urlPath, init } = accountingBffPost("done_budget", [organizationId, budgetId])
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
      const { urlPath, init } = accountingBffPost("cancel_budget", [organizationId, budgetId])
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
      const { urlPath, init } = accountingBffPost("delete_budget_line", [organizationId, lineId])
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
      const { urlPath, init } = accountingBffPost("update_budget_line_actuals", [organizationId, args.lineId, stdbParamsToJson(args.params as object)])
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
      const { urlPath, init } = accountingBffPost("create_budget_post", [
        organizationId,
        stdbParamsToJson(params as object, "CreateBudgetPostParams"),
      ])
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
      const { urlPath, init } = accountingBffPost("update_budget_post", [organizationId, args.postId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

/**
 * Create a new bank statement.
 */
export function useCreateAccountBankStatement(organizationId: number) {
  return useAccountingCallMutation(
    "create_account_bank_statement",
    organizationId,
    stdbInvalidationFor("create_account_bank_statement"),
  )
}

/**
 * Update an existing bank statement.
 */
export function useUpdateAccountBankStatement(organizationId: number) {
  return useAccountingCallMutation(
    "update_account_bank_statement",
    organizationId,
    stdbInvalidationFor("update_account_bank_statement"),
  )
}

/**
 * Unreconcile a bank statement line.
 */
export function useUnreconcileAccountBankStatementLine(organizationId: number) {
  return useAccountingCallMutation(
    "unreconcile_account_bank_statement_line",
    organizationId,
    stdbInvalidationFor("unreconcile_account_bank_statement_line"),
  )
}

/**
 * Create a new fixed asset.
 */
export function useCreateAccountAsset(organizationId: number) {
  return useAccountingCallMutation(
    "create_account_asset",
    organizationId,
    stdbInvalidationFor("create_account_asset"),
  )
}

/**
 * Update an existing fixed asset.
 */
export function useUpdateAccountAsset(organizationId: number) {
  return useAccountingCallMutation(
    "update_account_asset",
    organizationId,
    stdbInvalidationFor("update_account_asset"),
  )
}

/**
 * Dispose of a fixed asset.
 */
export function useDisposeAccountAsset(organizationId: number) {
  return useAccountingCallMutation(
    "dispose_account_asset",
    organizationId,
    stdbInvalidationFor("dispose_account_asset"),
  )
}

/**
 * Create a new account journal.
 */
export function useCreateAccountJournal(organizationId: number) {
  return useAccountingCallMutation(
    "create_account_journal",
    organizationId,
    stdbInvalidationFor("create_account_journal"),
  )
}

/**
 * Update an existing account journal.
 */
export function useUpdateAccountJournal(organizationId: number) {
  return useAccountingCallMutation(
    "update_account_journal",
    organizationId,
    stdbInvalidationFor("update_account_journal"),
  )
}

// ── Analytic accounting (explicit /api/call — reducer coverage + correct [orgId, …] args) ──

function invalidateAnalyticQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-distribution-models", k] })
}

function invalidateBankStatementQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-statements", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-statement-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-match-candidates", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-reconciliation-widgets", k] })
  void qc.invalidateQueries({ queryKey: ["bank-statement-imports", String(k)] })
}

function invalidateFiscalYearQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, ["fiscal-years"])
}

function invalidateAccountPeriodQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, ["account-periods"])
}

/** Create fiscal year — args `[organizationId, companyId, params]`. */
export function useCreateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_fiscal_year", [
        organizationId,
        companyId,
        stdbParamsToJson(params as object, "CreateFiscalYearParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

/** Bootstrap fiscal year + 12 monthly periods — args `[organizationId, companyId, params]`. */
export function useSetupFiscalCalendar(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("setup_fiscal_calendar", [
        organizationId,
        companyId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateFiscalYearQueries(qc, organizationId)
      invalidateAccountPeriodQueries(qc, organizationId)
    },
  })
}

export function useUpdateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { fiscalYearId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_fiscal_year", [
        organizationId,
        companyId,
        args.fiscalYearId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useDeleteFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_fiscal_year", [organizationId, companyId, fiscalYearId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useOpenFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const { urlPath, init } = accountingBffPost("open_fiscal_year", [organizationId, companyId, fiscalYearId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useCloseFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const { urlPath, init } = accountingBffPost("close_fiscal_year", [organizationId, companyId, fiscalYearId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

/** Create account period — args `[organizationId, companyId, params]`. */
export function useCreateAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_account_period", [
        organizationId,
        companyId,
        stdbParamsToJson(params as object, "CreateAccountPeriodParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useUpdateAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { periodId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_account_period", [
        organizationId,
        companyId,
        args.periodId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useDeleteAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_account_period", [organizationId, companyId, periodId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useOpenAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const { urlPath, init } = accountingBffPost("open_account_period", [organizationId, companyId, periodId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useCloseAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const { urlPath, init } = accountingBffPost("close_account_period", [organizationId, companyId, periodId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useCreateAnalyticAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_analytic_account", [
        organizationId,
        stdbParamsToJson(params as object, "CreateAnalyticAccountParams"),
      ])
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
      const { urlPath, init } = accountingBffPost("update_analytic_account", [organizationId, args.accountId, stdbParamsToJson(args.params as object)])
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
      const { urlPath, init } = accountingBffPost("set_analytic_account_active", [organizationId, args.accountId, args.active])
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
      const { urlPath, init } = accountingBffPost("create_analytic_line", [
        organizationId,
        stdbParamsToJson(params as object, "CreateAnalyticLineParams"),
      ])
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
      const { urlPath, init } = accountingBffPost("update_analytic_line", [organizationId, args.lineId, stdbParamsToJson(args.params as object)])
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
      const { urlPath, init } = accountingBffPost("delete_analytic_line", [organizationId, lineId])
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
      const { urlPath, init } = accountingBffPost("create_analytic_distribution_model", [
        organizationId,
        stdbParamsToJson(params as object, "CreateAnalyticDistributionModelParams"),
      ])
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
      const { urlPath, init } = accountingBffPost("update_analytic_distribution_model", [organizationId, args.modelId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

// ── Bank statements (explicit /api/call — org + company via ?withCompany=true) ──

export function useStageBankStatementImport(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: bigint
      journalId: bigint
      currencyId: bigint
      params: StageBankStatementImportParams
    }) => {
      const { urlPath, init } = accountingBffPost("stage_bank_statement_import", [
        organizationId,
        args.companyId,
        args.journalId,
        args.currencyId,
        stdbParamsToJson(args.params as object, "StageBankStatementImportParams"),
      ])
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
      const { urlPath, init } = accountingBffPost("approve_bank_statement_import", [
        organizationId,
        importId,
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function usePostAccountBankStatement(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: bigint) => {
      const { urlPath, init } = accountingBffPost("post_account_bank_statement", [statementId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountBankStatement(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_account_bank_statement", [statementId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useCreateAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { statementId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("create_account_bank_statement_line", [args.statementId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUpdateAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_account_bank_statement_line", [args.lineId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_account_bank_statement_line", [lineId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

/**
 * Suggested move-line matches for bank statement lines (refreshed after match / rules reducers).
 */
export function useBankMatchCandidates(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("bank-match-candidates", organizationId, options)
}

/**
 * Reconciliation workspace widgets (move lines grouped for review).
 */
export function useAccountReconciliationWidgets(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("account-reconciliation-widgets", organizationId, options)
}

export function useMatchBankLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; ruleId: number | null }) => {
      const { urlPath, init } = accountingBffPost("match_bank_line", [organizationId, args.lineId, args.ruleId])
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
      const { urlPath, init } = accountingBffPost("apply_reconciliation_rules", [organizationId, args.lineId, args.ruleId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useReconcileAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("reconcile_account_bank_statement_line", [args.lineId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUnreconciledAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("unreconciled_account_bank_statement_line", [args.lineId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

// ── Consolidation ─────────────────────────────────────────────────────────────

function invalidateConsolidationQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "consolidation-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "consolidation-journals", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "consolidation-elimination-entries", k] })
}

export function useConsolidationAccounts(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("consolidation-accounts", organizationId, options)
}

export function useConsolidationJournals(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("consolidation-journals", organizationId, options)
}

export function useConsolidationEliminationEntries(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("consolidation-elimination-entries", organizationId, options)
}

export function useCreateConsolidationAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_consolidation_account", [organizationId, stdbParamsToJson(params as object)])
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
      const { urlPath, init } = accountingBffPost("update_consolidation_account", [organizationId, args.accountId, stdbParamsToJson(args.params as object)])
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
      const { urlPath, init } = accountingBffPost("create_consolidation_journal", [organizationId, stdbParamsToJson(params as object)])
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
      const { urlPath, init } = accountingBffPost("create_elimination_entry", [organizationId, stdbParamsToJson(params as object)])
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
      const { urlPath, init } = accountingBffPost("process_consolidation", [organizationId, journalId])
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
      const { urlPath, init } = accountingBffPost("validate_consolidation", [organizationId, journalId])
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
      const { urlPath, init } = accountingBffPost("cancel_consolidation", [organizationId, args.journalId, args.reason])
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
      const { urlPath, init } = accountingBffPost("set_consolidation_company_rate", [organizationId, stdbParamsToJson(params as object)])
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
      const { urlPath, init } = accountingBffPost("match_elimination_entries", [
        organizationId,
        args.entryId,
        args.matchedEntryId,
      ])
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
      const { urlPath, init } = accountingBffPost("unmatch_elimination_entry", [organizationId, entryId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCreateAccountReconciliationWidget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_account_reconciliation_widget", [stdbParamsToJson(params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUpdateAccountReconciliationWidget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { widgetId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_account_reconciliation_widget", [args.widgetId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountReconciliationWidget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (widgetId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_account_reconciliation_widget", [widgetId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

// ── Fixed Assets ──────────────────────────────────────────────────────────────

function invalidateFixedAssetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "fixed-assets", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "depreciation-lines", k] })
}

/** Depreciation lines (TanStack scope = organization id). */
export function useDepreciationLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("depreciation-lines", organizationId, options)
}

export function useDeleteAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_account_asset", [organizationId, companyId, assetId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useConfirmAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = accountingBffPost("confirm_account_asset", [organizationId, companyId, assetId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useCloseAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = accountingBffPost("close_account_asset", [organizationId, companyId, assetId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useSetAccountAssetActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { assetId: bigint; active: boolean }) => {
      const { urlPath, init } = accountingBffPost("set_asset_active", [
        organizationId,
        companyId,
        args.assetId,
        args.active,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useCreateDepreciationLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_depreciation_line", [organizationId, companyId, stdbParamsToJson(params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useComputeDepreciationBoard(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = accountingBffPost("compute_depreciation_board", [organizationId, companyId, assetId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

// ── Intercompany ──────────────────────────────────────────────────────────────

function invalidateIntercompanyQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-rules", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-transactions", k] })
}

/** Intercompany rules for the organization. */
export function useIntercompanyRules(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("intercompany-rules", organizationId, options)
}

/** Intercompany transactions for the organization. */
export function useIntercompanyTransactions(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("intercompany-transactions", organizationId, options)
}

/** Create intercompany rule — args `[organizationId, sourceCompanyId, destinationCompanyId, params]`. */
export function useCreateIntercompanyRule(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      sourceCompanyId: bigint
      destinationCompanyId: bigint
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = accountingBffPost("create_intercompany_rule", [
        organizationId,
        args.sourceCompanyId,
        args.destinationCompanyId,
        stdbParamsToJson(args.params as object),
      ])
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
      const { urlPath, init } = accountingBffPost("update_intercompany_rule", [
        organizationId,
        companyId,
        args.ruleId,
        stdbParamsToJson(args.params as object),
      ])
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
      const { urlPath, init } = accountingBffPost("delete_intercompany_rule", [organizationId, companyId, ruleId])
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
      const { urlPath, init } = accountingBffPost("set_intercompany_rule_active", [
        organizationId,
        companyId,
        args.ruleId,
        args.isActive,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

/** Create intercompany transaction — args `[organizationId, originCompanyId, params]`. */
export function useCreateIntercompanyTransaction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { originCompanyId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("create_intercompany_transaction", [
        organizationId,
        args.originCompanyId,
        stdbParamsToJson(args.params as object),
      ])
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
      const { urlPath, init } = accountingBffPost("approve_intercompany_transaction", [organizationId, companyId, transactionId])
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
      const { urlPath, init } = accountingBffPost("process_intercompany_transaction", [
        organizationId,
        companyId,
        args.transactionId,
        stdbParamsToJson(args.params as object),
      ])
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
      const { urlPath, init } = accountingBffPost("complete_intercompany_transaction", [organizationId, companyId, transactionId])
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
      const { urlPath, init } = accountingBffPost("error_intercompany_transaction", [
        organizationId,
        companyId,
        args.transactionId,
        { errorMessage: args.errorMessage },
      ])
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
      const { urlPath, init } = accountingBffPost("cancel_intercompany_transaction", [
        organizationId,
        companyId,
        args.transactionId,
        { reason: args.reason },
      ])
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
      const { urlPath, init } = accountingBffPost("retry_intercompany_transaction", [organizationId, companyId, transactionId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

// ── Moves / Payments ──────────────────────────────────────────────────────────

function invalidateMoveQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "account-moves", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-move-lines", k] })
}

/** Recompute `amount_untaxed` / `amount_tax` / `amount_total` from lines (invoice/refund moves only). */
export function useComputeInvoiceTotals(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moveId: bigint | number | string) => {
      const { urlPath, init } = accountingBffPost("compute_invoice_totals", [organizationId, toScalarU64(moveId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useUpdateAccountMoveLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_account_move_line", [organizationId, args.lineId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useReconcilePaymentWithInvoice(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { paymentMoveId: bigint; invoiceMoveId: bigint }) => {
      const { urlPath, init } = accountingBffPost("reconcile_payment_with_invoice", [
        organizationId,
        args.paymentMoveId,
        args.invoiceMoveId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

function invalidateAccountPaymentQueries(qc: ReturnType<typeof useQueryClient>, orgKey: string) {
  void qc.invalidateQueries({ queryKey: ["stdb", "account-payments", orgKey] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-payment-terms", orgKey] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-payment-term-lines", orgKey] })
}

/** Draft customer/vendor payment — call {@link usePostAccountPayment} to post. */
export function useCreateAccountPayment(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: CreatePaymentParams) => {
      const { urlPath, init } = accountingBffPost("create_payment", [organizationId, paymentParamsToJson(params)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function usePostAccountPayment(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (paymentId: bigint) => {
      const { urlPath, init } = accountingBffPost("post_payment", [organizationId, paymentId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateAccountPaymentQueries(qc, k)
      void qc.invalidateQueries({ queryKey: ["stdb", "account-moves", k] })
    },
  })
}

export function useCancelAccountPayment(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (paymentId: bigint) => {
      const { urlPath, init } = accountingBffPost("cancel_payment", [organizationId, paymentId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateAccountPaymentQueries(qc, k)
      void qc.invalidateQueries({ queryKey: ["stdb", "account-moves", k] })
    },
  })
}

/** Link posted payment to invoice/bill move IDs (`isBill: true` for vendor bills). */
export function useRegisterPaymentOnInvoice(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (args: { paymentId: bigint; invoiceIds: bigint[]; isBill: boolean }) => {
      const { urlPath, init } = accountingBffPost("register_payment_on_invoice", [
        organizationId,
        args.paymentId,
        args.invoiceIds,
        args.isBill,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function useCreatePaymentTerm(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_payment_term", [
        organizationId,
        stdbParamsToJson(params as object, "CreatePaymentTermParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function useUpdatePaymentTerm(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (args: {
      termId: bigint
      name: string | null
      note: string | null
      isActive: boolean | null
    }) => {
      const { urlPath, init } = accountingBffPost(
        "update_payment_term",
        encodeReducerCallArgs("update_payment_term", [
          organizationId,
          args.termId,
          args.name,
          args.note,
          args.isActive,
        ]),
      )
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function useDeletePaymentTerm(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (termId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_payment_term", [organizationId, termId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function useCreatePaymentTermLine(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_payment_term_line", [
        organizationId,
        stdbParamsToJson(params as object, "CreatePaymentTermLineParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function useUpdatePaymentTermLine(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (args: {
      lineId: bigint
      value: Record<string, unknown> | null
      valueAmount: number | null
      days: number | null
      months: number | null
      daysAfterEndOfMonth: boolean | null
      sequence: number | null
    }) => {
      const { urlPath, init } = accountingBffPost("update_payment_term_line", [
        organizationId,
        args.lineId,
        args.value,
        args.valueAmount,
        args.days,
        args.months,
        args.daysAfterEndOfMonth,
        args.sequence,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

export function useDeletePaymentTermLine(organizationId: number) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_payment_term_line", [organizationId, lineId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, k),
  })
}

/** Org-level FX rate (optional company scope — pass `null` for org-wide). */
export function useCreateCurrencyRate(organizationId: number, companyId: bigint | null) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: CreateCurrencyRateParams) => {
      const { urlPath, init } = accountingBffPost("create_currency_rate", [
        organizationId,
        encodeOptionalU64(companyId),
        stdbParamsToJson(params as object, "CreateCurrencyRateParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "account-accounts", k] })
    },
  })
}

// ── Tax (Extended) ──────────────────────────────────────────────────────────────

/** Tax groups for the organization. */
export function useAccountTaxGroups(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-groups", organizationId, options)
}

/** Tax jurisdictions for the organization. */
export function useTaxJurisdictions(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-jurisdictions", organizationId, options)
}

/** Tax schedules for the organization. */
export function useTaxSchedules(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-schedules", organizationId, options)
}

/** Tax deadlines for the organization. */
export function useTaxDeadlines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-deadlines", organizationId, options)
}

// ── Tax Groups ─────────────────────────────────────────────────────────────────

export function useCreateAccountTaxGroup(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_account_tax_group", [organizationId, companyId, stdbParamsToJson(params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

export function useUpdateAccountTaxGroup(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { groupId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_account_tax_group", [
        organizationId,
        companyId,
        args.groupId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

// ── Tax Jurisdictions ──────────────────────────────────────────────────────────

export function useCreateTaxJurisdiction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_tax_jurisdiction", [organizationId, stdbParamsToJson(params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-jurisdictions"])
    },
  })
}

export function useUpdateTaxJurisdiction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { jurisdictionId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_tax_jurisdiction", [organizationId, args.jurisdictionId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-jurisdictions"])
    },
  })
}

// ── Tax Schedules ──────────────────────────────────────────────────────────────

export function useCreateTaxSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_tax_schedule", [organizationId, companyId, stdbParamsToJson(params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

export function useUpdateTaxSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { scheduleId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_tax_schedule", [
        organizationId,
        companyId,
        args.scheduleId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

// ── Tax Deadlines ──────────────────────────────────────────────────────────────

export function useCreateTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_tax_deadline", [organizationId, stdbParamsToJson(params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function useUpdateTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deadlineId: bigint; params: Record<string, unknown> }) => {
      const { urlPath, init } = accountingBffPost("update_tax_deadline", [organizationId, args.deadlineId, stdbParamsToJson(args.params as object)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function useDeleteTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deadlineId: bigint) => {
      const { urlPath, init } = accountingBffPost("delete_tax_deadline", [organizationId, deadlineId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function useCompleteTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deadlineId: bigint) => {
      const { urlPath, init } = accountingBffPost("complete_tax_deadline", [organizationId, deadlineId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function useWaiveTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deadlineId: bigint) => {
      const { urlPath, init } = accountingBffPost("waive_tax_deadline", [organizationId, deadlineId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

// ── Tax Deadline Bulk Operations ───────────────────────────────────────────────

export function useRefreshTaxDeadlineStatuses(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = accountingBffPost("refresh_tax_deadline_statuses", [organizationId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function useScheduleTaxDeadlineUpdates(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = accountingBffPost("schedule_tax_deadline_updates", [organizationId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

// ── Tax Import ─────────────────────────────────────────────────────────────────

export function useImportTaxRateCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_tax_rate_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

// ── Imports (Budget, Analytic) ──────────────────────────────────────────────────

export function useImportBudgetCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_budget_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useImportBudgetLineCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_budget_line_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useImportAnalyticAccountCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_analytic_account_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useImportAccountCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_account_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useImportAccountMoveCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_account_move_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useImportAccountMoveLineCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = accountingBffPost("import_account_move_line_csv", [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

/** FX revaluation run history for the organization. */
export function useFxRevaluationRuns(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("fx-revaluation-runs", organizationId, options)
}

export function useRunFxRevaluation(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("run_fx_revaluation", [
        organizationId,
        companyId,
        stdbParamsToJson(params, "RunFxRevaluationParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "fx-revaluation-runs", k] })
      invalidateMoveQueries(qc, organizationId)
    },
  })
}

export function useRunFxRevaluationBatch(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("run_fx_revaluation_batch", [
        organizationId,
        companyId,
        stdbParamsToJson(params, "RunFxRevaluationBatchParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "fx-revaluation-runs", k] })
      invalidateMoveQueries(qc, organizationId)
    },
  })
}

export function usePostRealizedFxGainLoss(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("post_realized_fx_gain_loss", [
        organizationId,
        companyId,
        stdbParamsToJson(params, "PostRealizedFxParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "fx-revaluation-runs", k] })
      invalidateMoveQueries(qc, organizationId)
    },
  })
}

export function usePartnerCreditControls(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("partner-credit-controls", organizationId, options)
}

/** Server-bounded: `partner_credit_control.payment_hold = true`. */
export function usePartnerCreditHolds(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("partner-credit-holds", organizationId, options)
}

export function useUpsertPartnerCreditControl(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("upsert_partner_credit_control", [
        organizationId,
        companyId,
        stdbParamsToJson(params, "UpsertPartnerCreditControlParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "partner-credit-controls", k] })
      void qc.invalidateQueries({ queryKey: ["stdb", "partner-credit-holds", k] })
    },
  })
}

export function useCreateBadDebtWriteOff(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_bad_debt_write_off", [
        organizationId,
        companyId,
        stdbParamsToJson(params, "CreateBadDebtWriteOffParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateMoveQueries(qc, organizationId)
    },
  })
}

export function useAmortizationSchedules(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("amortization-schedules", organizationId, options)
}

export function useAmortizationLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("amortization-lines", organizationId, options)
}

export function useCreateAmortizationSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = accountingBffPost("create_amortization_schedule", [
        organizationId,
        companyId,
        stdbParamsToJson(params, "CreateAmortizationScheduleParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "amortization-schedules", k] })
      void qc.invalidateQueries({ queryKey: ["stdb", "amortization-lines", k] })
    },
  })
}

export function useRecognizeAmortizationLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async ({
      lineId,
      params,
    }: {
      lineId: bigint
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = accountingBffPost("recognize_amortization_line", [
        organizationId,
        companyId,
        lineId,
        stdbParamsToJson(params, "RecognizeAmortizationLineParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "amortization-schedules", k] })
      void qc.invalidateQueries({ queryKey: ["stdb", "amortization-lines", k] })
      invalidateMoveQueries(qc, organizationId)
    },
  })
}

/** Chart / journal / tax / budget / analytic CSV imports for accounting UI toolbars. */
export function useAccountingCsvImportMutations(organizationId: number, companyId: bigint) {
  return {
    importAccount: useImportAccountCsv(organizationId, companyId),
    importAccountMove: useImportAccountMoveCsv(organizationId, companyId),
    importAccountMoveLine: useImportAccountMoveLineCsv(organizationId, companyId),
    importTaxRate: useImportTaxRateCsv(organizationId, companyId),
    importBudget: useImportBudgetCsv(organizationId, companyId),
    importBudgetLine: useImportBudgetLineCsv(organizationId, companyId),
    importAnalyticAccount: useImportAnalyticAccountCsv(organizationId, companyId),
  }
}
