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
export function useAccountAccounts(
  organizationId: bigint,
  options?: {
    staleTime?: number
    enabled?: boolean
  },
) {
  const sdk = createStdbSdk(apiFetch)
  return useCompanyScopedTypedQuery<AccountAccountQueryRow>(
    "account-accounts",
    organizationId,
    (companyId) => sdk.forCompany(companyId).accounting.accounts.list(),
    options,
  )
}

export function useAccountAccountTypes(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  const sdk = createStdbSdk(apiFetch)
  return useCompanyScopedTypedQuery<AccountAccountTypeQueryRow>(
    "account-account-types",
    organizationId,
    (companyId) => sdk.forCompany(companyId).accounting.accountTypes.list(),
    options,
  )
}

export function useAccountGroups(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("account-groups", organizationId, options)
}

export function useCreateAccountAccount(organizationId: number) {
  const qc = useQueryClient()
  const sdk = createStdbSdk(apiFetch)
  return useMutation({
    mutationFn: async (params: CreateAccountAccountParams) => {
      if (params.companyId == null) {
        throw new Error("Account creation requires a company")
      }
      const { companyId, ...input } = params
      await sdk.forCompany(companyId).accounting.accounts.create(input)
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_account")),
  })
}

export function useUpdateAccountAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; params: UpdateAccountAccountParams }) => {
      const { urlPath, init } = stdbBffCommandPost("update_account_account", {
        accountId: args.accountId,
        params: stdbParamsToJson(args.params as object, "UpdateAccountAccountParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("update_account_account")),
  })
}

export function useDeprecateAccountAccount(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { accountId: bigint; params: DeprecateAccountAccountParams }) => {
      const { urlPath, init } = stdbBffCommandPost("deprecate_account_account", {
        accountId: args.accountId,
        params: stdbParamsToJson(args.params as object, "DeprecateAccountAccountParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("deprecate_account_account")),
  })
}

export function useCreateAccountAccountType(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAccountAccountTypeParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_account_type", { params: stdbParamsToJson(params as object, "CreateAccountAccountTypeParams") })
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
      const { urlPath, init } = stdbBffCommandPost("update_account_account_type", { typeId: args.typeId, params: stdbParamsToJson(args.params as object) })
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
      const { urlPath, init } = stdbBffCommandPost("create_account_group", { params: stdbParamsToJson(params as object, "CreateAccountGroupParams") })
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
      const { urlPath, init } = stdbBffCommandPost("update_account_group", { groupId: args.groupId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateChartStructureQueries(qc, organizationId),
  })
}

export function invalidateChartStructureQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  invalidateStdbQueryResources(qc, organizationId, [
    "account-accounts",
    "account-account-types",
    "account-groups",
  ])
}
