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
export function useImportTaxRateCsv(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_tax_rate_csv", { companyId: companyId, csvData: csvData })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}
export function useAccountTaxes(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  const sdk = createStdbSdk(apiFetch)
  return useCompanyScopedTypedQuery<AccountTaxQueryRow>(
    "account-taxes",
    organizationId,
    (companyId) => sdk.forCompany(companyId).accounting.taxes.list(),
    options,
  )
}

export function useCreateAccountTax(organizationId: number) {
  const qc = useQueryClient()
  const sdk = createStdbSdk(apiFetch)
  return useMutation({
    mutationFn: async (args: { companyId: bigint; params: CreateAccountTaxParams }) => {
      await sdk.forCompany(args.companyId).accounting.taxes.create(args.params)
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_tax")),
  })
}

export function useUpdateAccountTax(organizationId: number) {
  const qc = useQueryClient()
  const sdk = createStdbSdk(apiFetch)
  return useMutation({
    mutationFn: async (args: { companyId: bigint; taxId: bigint; params: UpdateAccountTaxParams }) => {
      await sdk.forCompany(args.companyId).accounting.taxes.update(args.taxId, args.params)
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("update_account_tax")),
  })
}

export function useAccountTaxGroups(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("tax-groups", organizationId, options)
}

export function useTaxJurisdictions(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("tax-jurisdictions", organizationId, options)
}

export function useTaxSchedules(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("tax-schedules", organizationId, options)
}

export function useTaxDeadlines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("tax-deadlines", organizationId, options)
}

export function useCreateAccountTaxGroup(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_tax_group", { companyId: companyId, params: stdbParamsToJson(params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("update_account_tax_group", { companyId: companyId, groupId: args.groupId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

export function useCreateTaxJurisdiction(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_tax_jurisdiction", { params: stdbParamsToJson(params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("update_tax_jurisdiction", { jurisdictionId: args.jurisdictionId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-jurisdictions"])
    },
  })
}

export function useCreateTaxSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_tax_schedule", { companyId: companyId, params: stdbParamsToJson(params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("update_tax_schedule", { companyId: companyId, scheduleId: args.scheduleId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateTaxQueries(qc, organizationId),
  })
}

export function useCreateTaxDeadline(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_tax_deadline", { params: stdbParamsToJson(params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("update_tax_deadline", { deadlineId: args.deadlineId, params: stdbParamsToJson(args.params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("delete_tax_deadline", { deadlineId: deadlineId })
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
      const { urlPath, init } = stdbBffCommandPost("complete_tax_deadline", { deadlineId: deadlineId })
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
      const { urlPath, init } = stdbBffCommandPost("waive_tax_deadline", { deadlineId: deadlineId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function useRefreshTaxDeadlineStatuses(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = stdbBffCommandPost("refresh_tax_deadline_statuses", {  })
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
      const { urlPath, init } = stdbBffCommandPost("schedule_tax_deadline_updates", {  })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateStdbQueryResources(qc, organizationId, ["tax-deadlines"])
    },
  })
}

export function invalidateTaxQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_tax"))
}
