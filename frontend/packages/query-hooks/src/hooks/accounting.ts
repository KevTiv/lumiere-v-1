"use client"

import { apiFetch } from "../http"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { paymentParamsToJson } from "@lumiere/erp-shared/accounting-create-params"
import { stringifyReducerCallBody } from "@lumiere/api-client"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { CreatePaymentParams } from "@lumiere/stdb/generated/types"
import { invalidateStdbQueryResources, useStdbCallMutation, useStdbQuery } from "./stdb"
import { stdbInvalidationFor } from "../generated/stdb-reducer-invalidation"

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
} from "@lumiere/stdb/generated/types"

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

async function parseCallError(r: Response): Promise<string> {
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return (json.error as string | undefined) ?? `Request failed (${r.status})`
}

function invalidateBudgetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = organizationId
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
  return useStdbCallMutation(
    "create_account_account",
    organizationId,
    stdbInvalidationFor("create_account_account"),
  )
}

/**
 * Update an existing account.
 */
export function useUpdateAccountAccount(organizationId: number) {
  return useStdbCallMutation(
    "update_account_account",
    organizationId,
    stdbInvalidationFor("update_account_account"),
  )
}

/**
 * Deprecate (soft-delete) an account.
 */
export function useDeprecateAccountAccount(organizationId: number) {
  return useStdbCallMutation(
    "deprecate_account_account",
    organizationId,
    stdbInvalidationFor("deprecate_account_account"),
  )
}

/**
 * Create a new account move (journal entry).
 */
export function useCreateAccountMove(organizationId: number) {
  return useStdbCallMutation(
    "create_account_move",
    organizationId,
    stdbInvalidationFor("create_account_move"),
  )
}

/**
 * Post an account move (confirm it).
 */
export function usePostAccountMove(organizationId: number) {
  return useStdbCallMutation(
    "post_account_move",
    organizationId,
    stdbInvalidationFor("post_account_move"),
  )
}

/**
 * Post a customer/vendor invoice or refund (totals + optional COGS lines).
 */
export function usePostInvoice(organizationId: number) {
  return useStdbCallMutation("post_invoice", organizationId, stdbInvalidationFor("post_invoice"))
}

/**
 * Cancel an account move.
 */
export function useCancelAccountMove(organizationId: number) {
  return useStdbCallMutation(
    "cancel_account_move",
    organizationId,
    stdbInvalidationFor("cancel_account_move"),
  )
}

/**
 * Add a line to an account move.
 */
export function useAddAccountMoveLine(organizationId: number) {
  return useStdbCallMutation(
    "add_account_move_line",
    organizationId,
    stdbInvalidationFor("add_account_move_line"),
  )
}

/**
 * Delete an account move line.
 */
export function useDeleteAccountMoveLine(organizationId: number) {
  return useStdbCallMutation(
    "delete_account_move_line",
    organizationId,
    stdbInvalidationFor("delete_account_move_line"),
  )
}

/**
 * Create a new tax.
 */
export function useCreateAccountTax(organizationId: number) {
  return useStdbCallMutation(
    "create_account_tax",
    organizationId,
    stdbInvalidationFor("create_account_tax"),
  )
}

/**
 * Update an existing tax.
 */
export function useUpdateAccountTax(organizationId: number) {
  return useStdbCallMutation(
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
      const r = await apiFetch("/api/call/create_crossovered_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useCreateAccountAccountType(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_account_account_type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useUpdateAccountAccountType(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { typeId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_account_type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.typeId,
          stdbParamsToJson(args.params as object),
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useCreateAccountGroup(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_account_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useUpdateAccountGroup(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { groupId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.groupId,
          stdbParamsToJson(args.params as object),
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

/**
 * Update an existing budget.
 */
export function useUpdateCrossoveredBudget(organizationId: number) {
  return useStdbCallMutation(
    "update_crossovered_budget",
    organizationId,
    stdbInvalidationFor("update_crossovered_budget"),
  )
}

/**
 * Create a new budget line.
 */
export function useCreateBudgetLine(organizationId: number) {
  return useStdbCallMutation(
    "create_budget_line",
    organizationId,
    stdbInvalidationFor("create_budget_line"),
  )
}

/**
 * Update an existing budget line.
 */
export function useUpdateBudgetLine(organizationId: number) {
  return useStdbCallMutation(
    "update_budget_line",
    organizationId,
    stdbInvalidationFor("update_budget_line"),
  )
}

export function useConfirmBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const r = await apiFetch("/api/call/confirm_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, budgetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useValidateBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const r = await apiFetch("/api/call/validate_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, budgetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useDoneBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const r = await apiFetch("/api/call/done_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, budgetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useCancelBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const r = await apiFetch("/api/call/cancel_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, budgetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useDeleteBudgetLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const r = await apiFetch("/api/call/delete_budget_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, lineId]),
      })
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
      const r = await apiFetch("/api/call/update_budget_line_actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.lineId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useCreateBudgetPost(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_budget_post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useUpdateBudgetPost(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { postId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_budget_post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.postId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

/**
 * Create a new bank statement.
 */
export function useCreateAccountBankStatement(organizationId: number) {
  return useStdbCallMutation(
    "create_account_bank_statement",
    organizationId,
    stdbInvalidationFor("create_account_bank_statement"),
  )
}

/**
 * Update an existing bank statement.
 */
export function useUpdateAccountBankStatement(organizationId: number) {
  return useStdbCallMutation(
    "update_account_bank_statement",
    organizationId,
    stdbInvalidationFor("update_account_bank_statement"),
  )
}

/**
 * Unreconcile a bank statement line.
 */
export function useUnreconcileAccountBankStatementLine(organizationId: number) {
  return useStdbCallMutation(
    "unreconcile_account_bank_statement_line",
    organizationId,
    stdbInvalidationFor("unreconcile_account_bank_statement_line"),
  )
}

/**
 * Create a new fixed asset.
 */
export function useCreateAccountAsset(organizationId: number) {
  return useStdbCallMutation(
    "create_account_asset",
    organizationId,
    stdbInvalidationFor("create_account_asset"),
  )
}

/**
 * Update an existing fixed asset.
 */
export function useUpdateAccountAsset(organizationId: number) {
  return useStdbCallMutation(
    "update_account_asset",
    organizationId,
    stdbInvalidationFor("update_account_asset"),
  )
}

/**
 * Dispose of a fixed asset.
 */
export function useDisposeAccountAsset(organizationId: number) {
  return useStdbCallMutation(
    "dispose_account_asset",
    organizationId,
    stdbInvalidationFor("dispose_account_asset"),
  )
}

/**
 * Create a new account journal.
 */
export function useCreateAccountJournal(organizationId: number) {
  return useStdbCallMutation(
    "create_account_journal",
    organizationId,
    stdbInvalidationFor("create_account_journal"),
  )
}

/**
 * Update an existing account journal.
 */
export function useUpdateAccountJournal(organizationId: number) {
  return useStdbCallMutation(
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
}

function invalidateFiscalYearQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "fiscal-years", k] })
}

function invalidateAccountPeriodQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "account-periods", k] })
}

/** Create fiscal year — args `[organizationId, companyId, params]`. */
export function useCreateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useUpdateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { fiscalYearId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.fiscalYearId,
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useDeleteFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const r = await apiFetch("/api/call/delete_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, fiscalYearId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useOpenFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const r = await apiFetch("/api/call/open_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, fiscalYearId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useCloseFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const r = await apiFetch("/api/call/close_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, fiscalYearId]),
      })
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
      const r = await apiFetch("/api/call/create_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useUpdateAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { periodId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.periodId,
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useDeleteAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const r = await apiFetch("/api/call/delete_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, periodId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useOpenAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const r = await apiFetch("/api/call/open_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, periodId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useCloseAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const r = await apiFetch("/api/call/close_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, periodId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function useCreateAnalyticAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_analytic_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useUpdateAnalyticAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_analytic_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.accountId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useSetAnalyticAccountActive(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; active: boolean }) => {
      const r = await apiFetch("/api/call/set_analytic_account_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.accountId, args.active]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useCreateAnalyticLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_analytic_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useUpdateAnalyticLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_analytic_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.lineId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useDeleteAnalyticLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const r = await apiFetch("/api/call/delete_analytic_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, lineId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useCreateAnalyticDistributionModel(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_analytic_distribution_model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useUpdateAnalyticDistributionModel(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { modelId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_analytic_distribution_model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.modelId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

// ── Bank statements (explicit /api/call — org + company via ?withCompany=true) ──

export function usePostAccountBankStatement(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: bigint) => {
      const r = await apiFetch("/api/call/post_account_bank_statement?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([statementId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountBankStatement(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: bigint) => {
      const r = await apiFetch("/api/call/delete_account_bank_statement?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([statementId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useCreateAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { statementId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/create_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([args.statementId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUpdateAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([args.lineId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const r = await apiFetch("/api/call/delete_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([lineId]),
      })
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
      const r = await apiFetch("/api/call/match_bank_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.lineId, args.ruleId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useApplyReconciliationRules(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; ruleId: number | null }) => {
      const r = await apiFetch("/api/call/apply_reconciliation_rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.lineId, args.ruleId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useReconcileAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/reconcile_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([args.lineId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUnreconciledAccountBankStatementLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/unreconciled_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([args.lineId, args.params]),
      })
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
      const r = await apiFetch("/api/call/create_consolidation_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useUpdateConsolidationAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_consolidation_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.accountId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCreateConsolidationJournal(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_consolidation_journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCreateEliminationEntry(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_elimination_entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useProcessConsolidation(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (journalId: bigint) => {
      const r = await apiFetch("/api/call/process_consolidation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, journalId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useValidateConsolidation(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (journalId: bigint) => {
      const r = await apiFetch("/api/call/validate_consolidation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, journalId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCancelConsolidation(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { journalId: bigint; reason: string }) => {
      const r = await apiFetch("/api/call/cancel_consolidation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.journalId, args.reason]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useSetConsolidationCompanyRate(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/set_consolidation_company_rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useMatchEliminationEntries(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { entryId: bigint; matchedEntryId: bigint }) => {
      const r = await apiFetch("/api/call/match_elimination_entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.entryId,
          args.matchedEntryId,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useUnmatchEliminationEntry(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entryId: bigint) => {
      const r = await apiFetch("/api/call/unmatch_elimination_entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, entryId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateConsolidationQueries(qc, organizationId),
  })
}

export function useCreateAccountReconciliationWidget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_account_reconciliation_widget?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useUpdateAccountReconciliationWidget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { widgetId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_reconciliation_widget?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([args.widgetId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

export function useDeleteAccountReconciliationWidget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (widgetId: bigint) => {
      const r = await apiFetch("/api/call/delete_account_reconciliation_widget?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([widgetId]),
      })
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
      const r = await apiFetch("/api/call/delete_account_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, assetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useConfirmAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await apiFetch("/api/call/confirm_account_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, assetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useCloseAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await apiFetch("/api/call/close_account_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, assetId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useSetAccountAssetActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { assetId: bigint; active: boolean }) => {
      const r = await apiFetch("/api/call/set_asset_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.assetId,
          args.active,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useCreateDepreciationLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_depreciation_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useComputeDepreciationBoard(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await apiFetch("/api/call/compute_depreciation_board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, assetId]),
      })
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
      const r = await apiFetch("/api/call/create_intercompany_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.sourceCompanyId,
          args.destinationCompanyId,
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useUpdateIntercompanyRule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { ruleId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_intercompany_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.ruleId,
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useDeleteIntercompanyRule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ruleId: bigint) => {
      const r = await apiFetch("/api/call/delete_intercompany_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, ruleId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useSetIntercompanyRuleActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { ruleId: bigint; isActive: boolean }) => {
      const r = await apiFetch("/api/call/set_intercompany_rule_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.ruleId,
          args.isActive,
        ]),
      })
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
      const r = await apiFetch("/api/call/create_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.originCompanyId,
          args.params,
        ]),
      })
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
      const r = await apiFetch("/api/call/approve_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, transactionId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useProcessIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/process_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.transactionId,
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useCompleteIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const r = await apiFetch("/api/call/complete_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, transactionId]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useErrorIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; errorMessage: string }) => {
      const r = await apiFetch("/api/call/error_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.transactionId,
          { errorMessage: args.errorMessage },
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useCancelIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; reason: string }) => {
      const r = await apiFetch("/api/call/cancel_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.transactionId,
          { reason: args.reason },
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, organizationId),
  })
}

export function useRetryIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const r = await apiFetch("/api/call/retry_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, transactionId]),
      })
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
      const r = await apiFetch("/api/call/compute_invoice_totals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, Number(moveId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useUpdateAccountMoveLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_move_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.lineId, args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useReconcilePaymentWithInvoice(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { paymentMoveId: bigint; invoiceMoveId: bigint }) => {
      const r = await apiFetch("/api/call/reconcile_payment_with_invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.paymentMoveId,
          args.invoiceMoveId,
        ]),
      })
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
      const r = await apiFetch("/api/call/create_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, paymentParamsToJson(params)]),
      })
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
      const r = await apiFetch("/api/call/post_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, paymentId]),
      })
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
      const r = await apiFetch("/api/call/cancel_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, paymentId]),
      })
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
      const r = await apiFetch("/api/call/register_payment_on_invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.paymentId,
          args.invoiceIds,
          args.isBill,
        ]),
      })
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
      const r = await apiFetch("/api/call/create_payment_term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
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
      const r = await apiFetch("/api/call/update_payment_term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.termId,
          args.name,
          args.note,
          args.isActive,
        ]),
      })
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
      const r = await apiFetch("/api/call/delete_payment_term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, termId]),
      })
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
      const r = await apiFetch("/api/call/create_payment_term_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
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
      const r = await apiFetch("/api/call/update_payment_term_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          args.lineId,
          args.value,
          args.valueAmount,
          args.days,
          args.months,
          args.daysAfterEndOfMonth,
          args.sequence,
        ]),
      })
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
      const r = await apiFetch("/api/call/delete_payment_term_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, lineId]),
      })
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
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_currency_rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId === null ? null : companyId, params]),
      })
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
      const r = await apiFetch("/api/call/create_account_tax_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

export function useUpdateAccountTaxGroup(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { groupId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_account_tax_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.groupId,
          args.params,
        ]),
      })
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
      const r = await apiFetch("/api/call/create_tax_jurisdiction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
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
      const r = await apiFetch("/api/call/update_tax_jurisdiction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.jurisdictionId, args.params]),
      })
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
      const r = await apiFetch("/api/call/create_tax_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

export function useUpdateTaxSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { scheduleId: bigint; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_tax_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          args.scheduleId,
          args.params,
        ]),
      })
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
      const r = await apiFetch("/api/call/create_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, params]),
      })
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
      const r = await apiFetch("/api/call/update_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, args.deadlineId, args.params]),
      })
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
      const r = await apiFetch("/api/call/delete_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, deadlineId]),
      })
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
      const r = await apiFetch("/api/call/complete_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, deadlineId]),
      })
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
      const r = await apiFetch("/api/call/waive_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, deadlineId]),
      })
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
      const r = await apiFetch("/api/call/refresh_tax_deadline_statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId]),
      })
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
      const r = await apiFetch("/api/call/schedule_tax_deadline_updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId]),
      })
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
      const r = await apiFetch("/api/call/import_tax_rate_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
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
      const r = await apiFetch("/api/call/import_budget_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useImportBudgetLineCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await apiFetch("/api/call/import_budget_line_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

export function useImportAnalyticAccountCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await apiFetch("/api/call/import_analytic_account_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAnalyticQueries(qc, organizationId),
  })
}

export function useImportAccountCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await apiFetch("/api/call/import_account_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function useImportAccountMoveCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await apiFetch("/api/call/import_account_move_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useImportAccountMoveLineCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await apiFetch("/api/call/import_account_move_line_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
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
