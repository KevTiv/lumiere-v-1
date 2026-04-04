"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { paymentParamsToJson } from "@/lib/accounting-create-params"
import { stdbParamsToJson } from "@/lib/stdb-params-json"
import type { CreatePaymentParams } from "@lumiere/stdb/generated/types"
import { useStdbQuery, useStdbReducer } from "./stdb"

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
} from "@lumiere/stdb"

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
  options?: { staleTime?: number; enabled?: boolean }
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
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useStdbQuery("budgets", organizationId, options)
}

/** Fiscal years for the company (default company id = org id in web). */
export function useAccountFiscalYears(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("fiscal-years", companyId, options)
}

/** Accounting periods for the company (default company id = org id in web). */
export function useAccountPeriods(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: Record<string, unknown>[] },
) {
  return useStdbQuery("account-periods", companyId, options)
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
  const k = String(organizationId)
  void qc.invalidateQueries({ queryKey: ["stdb", "budgets", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "budget-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "budget-posts", k] })
}

function invalidateChartStructureQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = String(organizationId)
  void qc.invalidateQueries({ queryKey: ["stdb", "account-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-account-types", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-groups", k] })
}

// ── Mutation Hooks ────────────────────────────────────────────────────────────

/**
 * Create a new account in the chart of accounts.
 */
export function useCreateAccountAccount() {
  return useStdbReducer("create_account_account")
}

/**
 * Update an existing account.
 */
export function useUpdateAccountAccount() {
  return useStdbReducer("update_account_account")
}

/**
 * Deprecate (soft-delete) an account.
 */
export function useDeprecateAccountAccount() {
  return useStdbReducer("deprecate_account_account")
}

/**
 * Create a new account move (journal entry).
 */
export function useCreateAccountMove() {
  return useStdbReducer("create_account_move")
}

/**
 * Post an account move (confirm it).
 */
export function usePostAccountMove() {
  return useStdbReducer("post_account_move")
}

/**
 * Cancel an account move.
 */
export function useCancelAccountMove() {
  return useStdbReducer("cancel_account_move")
}

/**
 * Add a line to an account move.
 */
export function useAddAccountMoveLine() {
  return useStdbReducer("add_account_move_line")
}

/**
 * Delete an account move line.
 */
export function useDeleteAccountMoveLine() {
  return useStdbReducer("delete_account_move_line")
}

/**
 * Create a new tax.
 */
export function useCreateAccountTax() {
  return useStdbReducer("create_account_tax")
}

/**
 * Update an existing tax.
 */
export function useUpdateAccountTax() {
  return useStdbReducer("update_account_tax")
}

/**
 * Create a new budget (crossovered budget header).
 */
export function useCreateCrossoveredBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_crossovered_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/create_account_account_type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), stdbParamsToJson(params as object)]),
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
      const r = await fetch("/api/call/update_account_account_type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.typeId),
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
      const r = await fetch("/api/call/create_account_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), stdbParamsToJson(params as object)]),
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
      const r = await fetch("/api/call/update_account_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.groupId),
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
export function useUpdateCrossoveredBudget() {
  return useStdbReducer("update_crossovered_budget")
}

/**
 * Create a new budget line.
 */
export function useCreateBudgetLine() {
  return useStdbReducer("create_budget_line")
}

/**
 * Update an existing budget line.
 */
export function useUpdateBudgetLine() {
  return useStdbReducer("update_budget_line")
}

export function useConfirmBudget(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: bigint) => {
      const r = await fetch("/api/call/confirm_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(budgetId)]),
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
      const r = await fetch("/api/call/validate_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(budgetId)]),
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
      const r = await fetch("/api/call/done_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(budgetId)]),
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
      const r = await fetch("/api/call/cancel_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(budgetId)]),
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
      const r = await fetch("/api/call/delete_budget_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(lineId)]),
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
      const r = await fetch("/api/call/update_budget_line_actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.lineId), args.params]),
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
      const r = await fetch("/api/call/create_budget_post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_budget_post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.postId), args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBudgetQueries(qc, organizationId),
  })
}

/**
 * Create a new bank statement.
 */
export function useCreateAccountBankStatement() {
  return useStdbReducer("create_account_bank_statement")
}

/**
 * Update an existing bank statement.
 */
export function useUpdateAccountBankStatement() {
  return useStdbReducer("update_account_bank_statement")
}

/**
 * Unreconcile a bank statement line.
 */
export function useUnreconcileAccountBankStatementLine() {
  return useStdbReducer("unreconcile_account_bank_statement_line")
}

/**
 * Create a new fixed asset.
 */
export function useCreateAccountAsset() {
  return useStdbReducer("create_account_asset")
}

/**
 * Update an existing fixed asset.
 */
export function useUpdateAccountAsset() {
  return useStdbReducer("update_account_asset")
}

/**
 * Dispose of a fixed asset.
 */
export function useDisposeAccountAsset() {
  return useStdbReducer("dispose_account_asset")
}

/**
 * Create a new account journal.
 */
export function useCreateAccountJournal() {
  return useStdbReducer("create_account_journal")
}

/**
 * Update an existing account journal.
 */
export function useUpdateAccountJournal() {
  return useStdbReducer("update_account_journal")
}

// ── Analytic accounting (explicit /api/call — reducer coverage + correct [orgId, …] args) ──

function invalidateAnalyticQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = String(organizationId)
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-accounts", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "analytic-distribution-models", k] })
}

function invalidateBankStatementQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const k = String(organizationId)
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-statements", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-statement-lines", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "bank-match-candidates", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-reconciliation-widgets", k] })
}

function invalidateFiscalYearQueries(qc: ReturnType<typeof useQueryClient>, companyId: bigint | number) {
  const k = String(companyId)
  void qc.invalidateQueries({ queryKey: ["stdb", "fiscal-years", k] })
}

function invalidateAccountPeriodQueries(qc: ReturnType<typeof useQueryClient>, companyId: bigint | number) {
  const k = String(companyId)
  void qc.invalidateQueries({ queryKey: ["stdb", "account-periods", k] })
}

/** Create fiscal year — args `[organizationId, companyId, params]`. */
export function useCreateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, companyId),
  })
}

export function useUpdateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { fiscalYearId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.fiscalYearId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, companyId),
  })
}

export function useDeleteFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const r = await fetch("/api/call/delete_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(fiscalYearId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, companyId),
  })
}

export function useOpenFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const r = await fetch("/api/call/open_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(fiscalYearId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, companyId),
  })
}

export function useCloseFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fiscalYearId: bigint) => {
      const r = await fetch("/api/call/close_fiscal_year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(fiscalYearId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, companyId),
  })
}

/** Create account period — args `[organizationId, companyId, params]`. */
export function useCreateAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, companyId),
  })
}

export function useUpdateAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { periodId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.periodId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, companyId),
  })
}

export function useDeleteAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const r = await fetch("/api/call/delete_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(periodId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, companyId),
  })
}

export function useOpenAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const r = await fetch("/api/call/open_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(periodId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, companyId),
  })
}

export function useCloseAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: bigint) => {
      const r = await fetch("/api/call/close_account_period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(periodId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, companyId),
  })
}

export function useCreateAnalyticAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_analytic_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_analytic_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.accountId), args.params]),
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
      const r = await fetch("/api/call/set_analytic_account_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.accountId), args.active]),
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
      const r = await fetch("/api/call/create_analytic_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_analytic_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.lineId), args.params]),
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
      const r = await fetch("/api/call/delete_analytic_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(lineId)]),
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
      const r = await fetch("/api/call/create_analytic_distribution_model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_analytic_distribution_model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.modelId), args.params]),
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
      const r = await fetch("/api/call/post_account_bank_statement?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(statementId)]),
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
      const r = await fetch("/api/call/delete_account_bank_statement?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(statementId)]),
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
      const r = await fetch("/api/call/create_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.statementId), args.params]),
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
      const r = await fetch("/api/call/update_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.lineId), args.params]),
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
      const r = await fetch("/api/call/delete_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(lineId)]),
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
      const r = await fetch("/api/call/match_bank_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.lineId), args.ruleId]),
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
      const r = await fetch("/api/call/apply_reconciliation_rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.lineId), args.ruleId]),
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
      const r = await fetch("/api/call/reconcile_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.lineId), args.params]),
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
      const r = await fetch("/api/call/unreconciled_account_bank_statement_line?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.lineId), args.params]),
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
  const k = String(organizationId)
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
      const r = await fetch("/api/call/create_consolidation_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_consolidation_account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.accountId), args.params]),
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
      const r = await fetch("/api/call/create_consolidation_journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/create_elimination_entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/process_consolidation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(journalId)]),
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
      const r = await fetch("/api/call/validate_consolidation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(journalId)]),
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
      const r = await fetch("/api/call/cancel_consolidation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.journalId), args.reason]),
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
      const r = await fetch("/api/call/set_consolidation_company_rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/match_elimination_entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.entryId),
          String(args.matchedEntryId),
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
      const r = await fetch("/api/call/unmatch_elimination_entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(entryId)]),
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
      const r = await fetch("/api/call/create_account_reconciliation_widget?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([params]),
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
      const r = await fetch("/api/call/update_account_reconciliation_widget?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.widgetId), args.params]),
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
      const r = await fetch("/api/call/delete_account_reconciliation_widget?withCompany=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(widgetId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateBankStatementQueries(qc, organizationId),
  })
}

// ── Fixed Assets ──────────────────────────────────────────────────────────────

function invalidateFixedAssetQueries(qc: ReturnType<typeof useQueryClient>, companyId: bigint | number) {
  const k = String(companyId)
  void qc.invalidateQueries({ queryKey: ["stdb", "fixed-assets", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "depreciation-lines", k] })
}

/** Depreciation lines for the company (asset depreciation schedule). */
export function useDepreciationLines(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("depreciation-lines", companyId, options)
}

export function useDeleteAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await fetch("/api/call/delete_account_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(assetId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, companyId),
  })
}

export function useConfirmAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await fetch("/api/call/confirm_account_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(assetId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, companyId),
  })
}

export function useCloseAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await fetch("/api/call/close_account_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(assetId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, companyId),
  })
}

export function useSetAccountAssetActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { assetId: bigint; active: boolean }) => {
      const r = await fetch("/api/call/set_asset_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.assetId),
          args.active,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, companyId),
  })
}

export function useCreateDepreciationLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_depreciation_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, companyId),
  })
}

export function useComputeDepreciationBoard(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const r = await fetch("/api/call/compute_depreciation_board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(assetId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, companyId),
  })
}

// ── Intercompany ──────────────────────────────────────────────────────────────

function invalidateIntercompanyQueries(qc: ReturnType<typeof useQueryClient>, companyId: bigint | number) {
  const k = String(companyId)
  void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-rules", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-transactions", k] })
}

/** Intercompany rules for the organization. */
export function useIntercompanyRules(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("intercompany-rules", companyId, options)
}

/** Intercompany transactions for the organization. */
export function useIntercompanyTransactions(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("intercompany-transactions", companyId, options)
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
      const r = await fetch("/api/call/create_intercompany_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.sourceCompanyId),
          String(args.destinationCompanyId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      // Invalidate all intercompany rule queries for this organization
      void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-rules"] })
    },
  })
}

export function useUpdateIntercompanyRule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { ruleId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_intercompany_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.ruleId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useDeleteIntercompanyRule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ruleId: bigint) => {
      const r = await fetch("/api/call/delete_intercompany_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(ruleId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useSetIntercompanyRuleActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { ruleId: bigint; isActive: boolean }) => {
      const r = await fetch("/api/call/set_intercompany_rule_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.ruleId),
          args.isActive,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

/** Create intercompany transaction — args `[organizationId, originCompanyId, params]`. */
export function useCreateIntercompanyTransaction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { originCompanyId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/create_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.originCompanyId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "intercompany-transactions"] })
    },
  })
}

export function useApproveIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const r = await fetch("/api/call/approve_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(transactionId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useProcessIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/process_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.transactionId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useCompleteIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const r = await fetch("/api/call/complete_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(transactionId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useErrorIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; errorMessage: string }) => {
      const r = await fetch("/api/call/error_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.transactionId),
          { errorMessage: args.errorMessage },
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useCancelIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { transactionId: bigint; reason: string }) => {
      const r = await fetch("/api/call/cancel_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.transactionId),
          { reason: args.reason },
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

export function useRetryIntercompanyTransaction(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: bigint) => {
      const r = await fetch("/api/call/retry_intercompany_transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), String(transactionId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIntercompanyQueries(qc, companyId),
  })
}

// ── Moves / Payments ──────────────────────────────────────────────────────────

function invalidateMoveQueries(qc: ReturnType<typeof useQueryClient>, companyId: bigint | number) {
  const k = String(companyId)
  void qc.invalidateQueries({ queryKey: ["stdb", "account-moves", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "account-move-lines", k] })
}

/** Recompute `amount_untaxed` / `amount_tax` / `amount_total` from lines (invoice/refund moves only). */
export function useComputeInvoiceTotals(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moveId: bigint | number | string) => {
      const r = await fetch("/api/call/compute_invoice_totals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), Number(moveId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, companyId),
  })
}

export function useUpdateAccountMoveLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_account_move_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.lineId), args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, companyId),
  })
}

export function useReconcilePaymentWithInvoice(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { paymentMoveId: bigint; invoiceMoveId: bigint }) => {
      const r = await fetch("/api/call/reconcile_payment_with_invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.paymentMoveId),
          String(args.invoiceMoveId),
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, companyId),
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
      const r = await fetch("/api/call/create_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), paymentParamsToJson(params)]),
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
      const r = await fetch("/api/call/post_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(paymentId)]),
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
      const r = await fetch("/api/call/cancel_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(paymentId)]),
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
      const r = await fetch("/api/call/register_payment_on_invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.paymentId),
          args.invoiceIds.map((id) => String(id)),
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
      const r = await fetch("/api/call/create_payment_term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_payment_term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.termId),
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
      const r = await fetch("/api/call/delete_payment_term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(termId)]),
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
      const r = await fetch("/api/call/create_payment_term_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
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
      const r = await fetch("/api/call/update_payment_term_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.lineId),
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
      const r = await fetch("/api/call/delete_payment_term_line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(lineId)]),
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
      const r = await fetch("/api/call/create_currency_rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), companyId === null ? null : String(companyId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "account-accounts", k] })
    },
  })
}

// ── Tax (Extended) ──────────────────────────────────────────────────────────────

function invalidateTaxQueries(qc: ReturnType<typeof useQueryClient>, companyId: bigint | number) {
  const k = String(companyId)
  void qc.invalidateQueries({ queryKey: ["stdb", "account-taxes", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "tax-groups", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "tax-jurisdictions", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "tax-schedules", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines", k] })
}

/** Tax groups for the organization. */
export function useAccountTaxGroups(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-groups", companyId, options)
}

/** Tax jurisdictions for the organization. */
export function useTaxJurisdictions(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-jurisdictions", companyId, options)
}

/** Tax schedules for the organization. */
export function useTaxSchedules(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-schedules", companyId, options)
}

/** Tax deadlines for the organization. */
export function useTaxDeadlines(
  companyId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useStdbQuery("tax-deadlines", companyId, options)
}

// ── Tax Groups ─────────────────────────────────────────────────────────────────

export function useCreateAccountTaxGroup(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_account_tax_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, companyId),
  })
}

export function useUpdateAccountTaxGroup(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { groupId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_account_tax_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.groupId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, companyId),
  })
}

// ── Tax Jurisdictions ──────────────────────────────────────────────────────────

export function useCreateTaxJurisdiction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_tax_jurisdiction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-jurisdictions"] })
    },
  })
}

export function useUpdateTaxJurisdiction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { jurisdictionId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_tax_jurisdiction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.jurisdictionId), args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-jurisdictions"] })
    },
  })
}

// ── Tax Schedules ──────────────────────────────────────────────────────────────

export function useCreateTaxSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_tax_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, companyId),
  })
}

export function useUpdateTaxSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { scheduleId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_tax_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(companyId),
          String(args.scheduleId),
          args.params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, companyId),
  })
}

// ── Tax Deadlines ──────────────────────────────────────────────────────────────

export function useCreateTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch("/api/call/create_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

export function useUpdateTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deadlineId: bigint; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.deadlineId), args.params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

export function useDeleteTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deadlineId: bigint) => {
      const r = await fetch("/api/call/delete_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(deadlineId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

export function useCompleteTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deadlineId: bigint) => {
      const r = await fetch("/api/call/complete_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(deadlineId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

export function useWaiveTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deadlineId: bigint) => {
      const r = await fetch("/api/call/waive_tax_deadline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(deadlineId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

// ── Tax Deadline Bulk Operations ───────────────────────────────────────────────

export function useRefreshTaxDeadlineStatuses(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/call/refresh_tax_deadline_statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

export function useScheduleTaxDeadlineUpdates(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/call/schedule_tax_deadline_updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stdb", "tax-deadlines"] })
    },
  })
}

// ── Tax Import ─────────────────────────────────────────────────────────────────

export function useImportTaxRateCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch("/api/call/import_tax_rate_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, companyId),
  })
}

// ── Imports (Budget, Analytic) ──────────────────────────────────────────────────

export function useImportBudgetCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch("/api/call/import_budget_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
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
      const r = await fetch("/api/call/import_budget_line_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
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
      const r = await fetch("/api/call/import_analytic_account_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
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
      const r = await fetch("/api/call/import_account_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
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
      const r = await fetch("/api/call/import_account_move_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, companyId),
  })
}

export function useImportAccountMoveLineCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch("/api/call/import_account_move_line_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(companyId), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, companyId),
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
