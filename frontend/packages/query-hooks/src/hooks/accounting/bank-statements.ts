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
import { apiFetch, fetchQueryList } from "../../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  paymentParamsToJson,
  type ClearablePatch,
} from "@lumiere/erp-shared/accounting-create-params"
import { stdbParamsToJson, encodeOptionalU64 } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64, scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
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
import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "../operation-effect"

export type BankStatementImportWorkspace = {
  imports: Record<string, unknown>[]
  lines: Record<string, unknown>[]
}

export interface BankReconciliationLineProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly statementId?: unknown
  readonly statement_id?: unknown
  readonly isReconciled?: unknown
  readonly is_reconciled?: unknown
  readonly moveIds?: unknown
  readonly move_ids?: unknown
  readonly amountResidual?: unknown
  readonly amount_residual?: unknown
  readonly paymentIds?: unknown
  readonly payment_ids?: unknown
  readonly amount?: unknown
  readonly journalId?: unknown
  readonly journal_id?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
}

export interface BankReconciliationStatementProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly journalId?: unknown
  readonly journal_id?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
}

export interface BankReconciliationEffectRef extends CanonicalRecordRef {
  readonly resource: "bank-statement-lines"
  readonly statementId: string
  readonly companyId: string
  readonly moveLineIds: readonly string[]
  readonly isReconciled: boolean
}

export type BankSettlementEffect = (BankReconciliationEffectRef & { status: "confirmed"; paymentId: string })
  | { status: "awaiting_approval"; paymentId: string; resource: "account-payments"; id: string }
export interface BankSettlementFinancialReadback {
  payments: readonly Record<string, unknown>[]
  moves: readonly Record<string, unknown>[]
  moveLines: readonly Record<string, unknown>[]
}

/** A matched flag alone is never proof of invoice or ledger settlement. */
export function resolveBankStatementSettlementEffect(
  lines: readonly BankReconciliationLineProjection[], statements: readonly BankReconciliationStatementProjection[],
  financial: BankSettlementFinancialReadback,
  args: { organizationId: bigint; companyId: bigint; lineId: bigint; moveIds: readonly bigint[]; amountResidual: number },
): BankSettlementEffect | null {
  const field = (row: object, camel: string, snake: string) => {
    const values = row as Record<string, unknown>
    return values[camel] ?? values[snake]
  }
  const exact = <T extends { readonly id?: unknown }>(rows: readonly T[], id: bigint | null | undefined): T | undefined => {
    if (id == null) return undefined
    const found = rows.filter((row) => parseStrictU64(row.id) === id)
    return found.length === 1 ? found[0] : undefined
  }
  const numeric = (value: unknown): number | null => {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const scoped = (row: object) => parseStrictU64(field(row, "organizationId", "organization_id")) === args.organizationId
    && parseStrictU64(field(row, "companyId", "company_id")) === args.companyId
  const line = exact(lines, args.lineId)
  if (!line || parseStrictU64(field(line, "organizationId", "organization_id")) !== args.organizationId) return null
  const statement = exact(statements, parseStrictU64(field(line, "statementId", "statement_id")))
  const paymentIds = exactIdList(field(line, "paymentIds", "payment_ids"))
  if (!statement || !scoped(statement) || enumTag(statement.state) !== "open" || paymentIds?.length !== 1) return null
  const paymentId = paymentIds[0]!
  const payment = exact(financial.payments, paymentId)
  const journalId = parseStrictU64(field(statement, "journalId", "journal_id"))
  const currencyId = parseStrictU64(field(statement, "currencyId", "currency_id"))
  const bankAmount = numeric(line.amount)
  const partnerId = payment && parseStrictU64(field(payment, "partnerId", "partner_id"))
  if (!payment || !scoped(payment) || !partnerId || !journalId || !currencyId || bankAmount == null || bankAmount === 0
    || parseStrictU64(field(line, "journalId", "journal_id")) !== journalId
    || parseStrictU64(field(payment, "journalId", "journal_id")) !== journalId
    || parseStrictU64(field(payment, "currencyId", "currency_id")) !== currencyId
    || numeric(payment.amount) !== Math.abs(bankAmount)
    || enumTag(field(payment, "paymentType", "payment_type")) !== (bankAmount > 0 ? "inbound" : "outbound")
    || enumTag(field(payment, "partnerType", "partner_type")) !== (bankAmount > 0 ? "customer" : "supplier")
    || parseStrictU64(field(payment, "reversalMoveId", "reversal_move_id")) != null) return null
  const targets = args.moveIds.map((id) => exact(financial.moveLines, id))
  if (!targets.length || new Set(args.moveIds.map(String)).size !== targets.length || targets.some((row) => !row)) return null
  const invoices = targets.map((target) => exact(financial.moves, parseStrictU64(field(target!, "moveId", "move_id"))))
  if (targets.some((target, index) => {
    const invoice = invoices[index]
    return !target || !invoice || !scoped(target) || !scoped(invoice)
      || enumTag(invoice.state) !== "posted" || enumTag(field(target, "parentState", "parent_state")) !== "posted"
      || enumTag(field(invoice, "moveType", "move_type")) !== (bankAmount > 0 ? "outinvoice" : "ininvoice")
      || parseStrictU64(field(invoice, "partnerId", "partner_id")) !== partnerId
      || parseStrictU64(field(target, "partnerId", "partner_id")) !== partnerId
      || parseStrictU64(field(target, "currencyId", "currency_id")) !== currencyId
      || parseStrictU64(field(invoice, "currencyId", "currency_id")) !== currencyId
      || String(field(target, "accountInternalType", "account_internal_type")).toLowerCase() !== (bankAmount > 0 ? "receivable" : "payable")
  })) return null
  if (enumTag(payment.state) === "notpaid" || (enumTag(payment.state) === "paid" && field(line, "isReconciled", "is_reconciled") === false)) {
    const linked = exactIdList(field(line, "moveIds", "move_ids"))
    const residuals = targets.map((target) => numeric(field(target!, "amountResidual", "amount_residual")))
    if (boolValue(field(line, "isReconciled", "is_reconciled")) || !linked || linked.length !== 0
      || (enumTag(payment.state) === "notpaid" && parseStrictU64(field(payment, "moveId", "move_id")) != null)
      || residuals.some((value) => value == null || Math.sign(value) !== Math.sign(bankAmount))
      || Math.abs(residuals.reduce<number>((sum, value) => sum + value!, 0) - bankAmount) > 0.000001) return null
    if (enumTag(payment.state) === "paid") {
      const posted = exact(financial.moves, parseStrictU64(field(payment, "moveId", "move_id")))
      if (!posted || !scoped(posted) || enumTag(posted.state) !== "posted"
        || parseStrictU64(field(posted, "journalId", "journal_id")) !== journalId
        || parseStrictU64(field(posted, "currencyId", "currency_id")) !== currencyId) return null
    }
    return { status: "awaiting_approval", paymentId: String(paymentId), resource: "account-payments", id: String(paymentId) }
  }
  const effect = resolveBankStatementReconciliationEffect(lines, statements, args)
  const paymentMoveId = parseStrictU64(field(payment, "moveId", "move_id"))
  const paymentMove = exact(financial.moves, paymentMoveId)
  if (!effect || enumTag(payment.state) !== "paid" || !paymentMoveId || !paymentMove || !scoped(paymentMove)
    || enumTag(paymentMove.state) !== "posted" || parseStrictU64(field(paymentMove, "journalId", "journal_id")) !== journalId
    || parseStrictU64(field(paymentMove, "currencyId", "currency_id")) !== currencyId
    || targets.some((target, index) => numeric(field(target!, "amountResidual", "amount_residual")) !== 0
      || numeric(field(invoices[index]!, "amountResidual", "amount_residual")) !== 0
      || enumTag(field(invoices[index]!, "paymentState", "payment_state")) !== "paid"
      || field(target!, "matchingNumber", "matching_number") !== `MATCH-${paymentMoveId}-${String(invoices[index]!.id)}`)) return null
  const clearing = financial.moveLines.filter((row) => parseStrictU64(field(row, "moveId", "move_id")) === paymentMoveId
    && ["receivable", "payable"].includes(String(field(row, "accountInternalType", "account_internal_type")).toLowerCase()))
  if (!clearing.length || clearing.some((row) => !scoped(row) || numeric(field(row, "amountResidual", "amount_residual")) !== 0)) return null
  return { ...effect, status: "confirmed", paymentId: String(paymentId) }
}

function enumTag(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
  }
  return ""
}

function boolValue(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true"
}

function exactIdList(value: unknown): bigint[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.map(parseStrictU64)
  return ids.every((id): id is bigint => id != null) ? ids : null
}

export function resolveBankStatementReconciliationEffect(
  lines: readonly BankReconciliationLineProjection[],
  statements: readonly BankReconciliationStatementProjection[],
  args: { organizationId: bigint; companyId: bigint; lineId: bigint; moveIds: readonly bigint[]; amountResidual: number },
): BankReconciliationEffectRef | null {
  const exact = <T extends { readonly id?: unknown }>(rows: readonly T[], id: bigint, name: string) => {
    const matches = rows.filter((row) => parseStrictU64(row.id) === id)
    if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one ${name}, found ${matches.length}`)
    return matches[0] ?? null
  }
  const line = exact(lines, args.lineId, "bank statement line")
  if (!line) return null
  const statementId = parseStrictU64(line.statementId ?? line.statement_id)
  if (statementId == null) return null
  const statement = exact(statements, statementId, "bank statement")
  if (!statement) return null
  const actualIds = exactIdList(line.moveIds ?? line.move_ids)
  const expectedIds = [...args.moveIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const sortedActual = actualIds?.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const rawResidual = line.amountResidual ?? line.amount_residual
  if (rawResidual == null || (typeof rawResidual === "string" && rawResidual.trim() === "")
    || (typeof rawResidual !== "number" && typeof rawResidual !== "string")) return null
  const residual = Number(rawResidual)
  const expectedReconciled = Math.abs(args.amountResidual) < 0.01
  if (
    parseStrictU64(line.organizationId ?? line.organization_id) !== args.organizationId ||
    parseStrictU64(statement.organizationId ?? statement.organization_id) !== args.organizationId ||
    parseStrictU64(statement.companyId ?? statement.company_id) !== args.companyId ||
    enumTag(statement.state) !== "open" ||
    boolValue(line.isReconciled ?? line.is_reconciled) !== expectedReconciled ||
    !sortedActual ||
    sortedActual.length !== expectedIds.length ||
    sortedActual.some((id, index) => id !== expectedIds[index]) ||
    !Number.isFinite(residual) ||
    Math.abs(residual - args.amountResidual) > 0.000001
  ) return null
  return {
    resource: "bank-statement-lines",
    id: args.lineId.toString(),
    statementId: statementId.toString(),
    companyId: args.companyId.toString(),
    moveLineIds: expectedIds.map(String),
    isReconciled: expectedReconciled,
  }
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
      const rawMoveIds = args.params.move_ids ?? args.params.moveIds
      const moveIds = exactIdList(rawMoveIds)
      const amountResidual = Number(args.params.amount_residual ?? args.params.amountResidual)
      if (!moveIds || moveIds.length === 0 || !Number.isFinite(amountResidual)) {
        throw new Error("Valid move line ids and residual are required")
      }
      const { urlPath, init } = stdbBffCommandPost("reconcile_account_bank_statement_line", {
        companyId,
        lineId: args.lineId,
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      const [lines, statements, payments, moves, moveLines] = await Promise.all([
        fetchQueryList("/api/query/bank-statement-lines", "Failed to read reconciled bank line"),
        fetchQueryList("/api/query/bank-statements", "Failed to read parent bank statement"),
        fetchQueryList("/api/query/account-payments", "Failed to read bank settlement payment"),
        fetchQueryList("/api/query/account-moves", "Failed to read bank settlement journal entries"),
        fetchQueryList("/api/query/account-move-lines", "Failed to read bank settlement balances"),
      ])
      const effect = resolveBankStatementSettlementEffect(lines, statements, { payments, moves, moveLines }, {
        organizationId: BigInt(organizationId),
        companyId,
        lineId: args.lineId,
        moveIds,
        amountResidual,
      })
      if (!effect) throw new Error("Bank settlement financial result did not read back exactly")
      return effect
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
  invalidateStdbQueryResources(qc, organizationId, ["account-payments", "account-moves", "account-move-lines", "workflow-human-tasks", "sale-orders"])
  void qc.invalidateQueries({ queryKey: ["workflow-human-tasks-inbox"] })
}
