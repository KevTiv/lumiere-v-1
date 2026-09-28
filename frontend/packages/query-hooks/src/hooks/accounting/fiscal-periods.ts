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

export interface ClosedPeriodProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
}

function periodState(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
  }
  // SATS sum JSON from /api/query, e.g. `{ closed: [] }`.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value)
    const key = keys.length === 1 ? keys[0] : undefined
    if (key) return key.toLowerCase()
  }
  return ""
}

export function resolveClosedPeriodEffect(
  rows: readonly ClosedPeriodProjection[],
  organizationId: bigint,
  companyId: bigint,
  periodId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === periodId)
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one account period, found ${matches.length}`)
  const row = matches[0]
  if (!row
    || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId
    || parseStrictU64(row.companyId ?? row.company_id) !== companyId
    || periodState(row.state) !== "closed") return null
  return { resource: "account-periods", id: periodId.toString() }
}
export function useAccountFiscalYears(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: AccountFiscalYear[] },
) {
  return useTypedStdbQuery("fiscal-years", organizationId, options)
}

export function useAccountPeriods(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean; initialData?: AccountPeriod[] },
) {
  return useTypedStdbQuery("account-periods", organizationId, options)
}

export function useCreateFiscalYear(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_fiscal_year", { companyId: companyId, params: stdbParamsToJson(params as object, "CreateFiscalYearParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useSetupFiscalCalendar(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("setup_fiscal_calendar", { companyId: companyId, params: stdbParamsToJson(params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("update_fiscal_year", { companyId: companyId, fiscalYearId: args.fiscalYearId, params: stdbParamsToJson(args.params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("delete_fiscal_year", { companyId: companyId, fiscalYearId: fiscalYearId })
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
      const { urlPath, init } = stdbBffCommandPost("open_fiscal_year", { companyId: companyId, fiscalYearId: fiscalYearId })
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
      const { urlPath, init } = stdbBffCommandPost("close_fiscal_year", { companyId: companyId, fiscalYearId: fiscalYearId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFiscalYearQueries(qc, organizationId),
  })
}

export function useCreateAccountPeriod(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_period", { companyId: companyId, params: stdbParamsToJson(params as object, "CreateAccountPeriodParams") })
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
      const { urlPath, init } = stdbBffCommandPost("update_account_period", { companyId: companyId, periodId: args.periodId, params: stdbParamsToJson(args.params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("delete_account_period", { companyId: companyId, periodId: periodId })
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
      const { urlPath, init } = stdbBffCommandPost("open_account_period", { companyId: companyId, periodId: periodId })
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
      const { urlPath, init } = stdbBffCommandPost("close_account_period", { companyId: companyId, periodId: periodId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      const rows = await fetchQueryList("/api/query/account-periods", "Failed to read closed period")
      const effect = resolveClosedPeriodEffect(rows, BigInt(organizationId), companyId, periodId)
      if (!effect) throw new Error("Closed period did not read back exactly")
      return effect
    },
    onSuccess: () => invalidateAccountPeriodQueries(qc, organizationId),
  })
}

export function invalidateFiscalYearQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, ["fiscal-years"])
}

export function invalidateAccountPeriodQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, ["account-periods"])
}
