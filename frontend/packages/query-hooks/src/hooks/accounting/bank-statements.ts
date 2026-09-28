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
}

export interface BankReconciliationStatementProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
}

export interface BankReconciliationEffectRef extends CanonicalRecordRef {
  readonly resource: "bank-statement-lines"
  readonly statementId: string
  readonly companyId: string
  readonly moveLineIds: readonly string[]
  readonly isReconciled: boolean
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
  const residual = Number(line.amountResidual ?? line.amount_residual)
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
      const [lines, statements] = await Promise.all([
        fetchQueryList("/api/query/bank-statement-lines", "Failed to read reconciled bank line"),
        fetchQueryList("/api/query/bank-statements", "Failed to read parent bank statement"),
      ])
      const effect = resolveBankStatementReconciliationEffect(lines, statements, {
        organizationId: BigInt(organizationId),
        companyId,
        lineId: args.lineId,
        moveIds,
        amountResidual,
      })
      if (!effect) throw new Error("Bank reconciliation result did not read back exactly")
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
}
