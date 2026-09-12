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
export function useAccountMoves(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  const sdk = createStdbSdk(apiFetch)
  return useCompanyScopedTypedQuery<AccountMoveQueryRow>(
    "account-moves",
    organizationId,
    (companyId) => sdk.forCompany(companyId).accounting.moves.list(),
    options,
  )
}

export function useAccountMoveLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  const sdk = createStdbSdk(apiFetch)
  return useCompanyScopedTypedQuery<AccountMoveLineQueryRow>(
    "account-move-lines",
    organizationId,
    (companyId) => sdk.forCompany(companyId).accounting.moveLines.list(),
    options,
  )
}

export function useCreateAccountMove(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAccountMoveParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_move", {
        params: stdbParamsToJson(params as object, "CreateAccountMoveParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_move")),
  })
}

export function usePostAccountMove(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moveId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("post_account_move", { moveId: toScalarU64(moveId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("post_account_move")),
  })
}

export function usePostInvoice(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      moveId: bigint | number | string
      cogsAccountId: bigint
      inventoryAccountId: bigint
    }) => {
      const { urlPath, init } = stdbBffCommandPost("post_invoice", {
        moveId: toScalarU64(args.moveId),
        cogsAccountId: args.cogsAccountId,
        inventoryAccountId: args.inventoryAccountId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("post_invoice")),
  })
}

export function useCreateCreditNoteFromInvoice(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; invoiceId: bigint; params: CreateCreditNoteParams }) => {
      const { urlPath, init } = stdbBffCommandPost("create_credit_note_from_invoice", {
        companyId: args.companyId,
        invoiceId: args.invoiceId,
        params: stdbParamsToJson(args.params as object, "CreateCreditNoteParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, ["account-moves", "account-move-lines"]),
  })
}

export function useCancelAccountMove(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moveId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_account_move", { moveId: toScalarU64(moveId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("cancel_account_move")),
  })
}

export function useAddAccountMoveLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { moveId: bigint; params: AddAccountMoveLineParams }) => {
      const { urlPath, init } = stdbBffCommandPost("add_account_move_line", {
        moveId: args.moveId,
        params: stdbParamsToJson(args.params as object, "AddAccountMoveLineParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("add_account_move_line")),
  })
}

export function useDeleteAccountMoveLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { lineId: bigint; params: DeleteAccountMoveLineParams }) => {
      const { urlPath, init } = stdbBffCommandPost("delete_account_move_line", {
        lineId: args.lineId,
        params: stdbParamsToJson(args.params as object, "DeleteAccountMoveLineParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("delete_account_move_line")),
  })
}

export function useComputeInvoiceTotals(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moveId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("compute_invoice_totals", { moveId: toScalarU64(moveId) })
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
      const { urlPath, init } = stdbBffCommandPost("update_account_move_line", { lineId: args.lineId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function invalidateMoveQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  invalidateStdbQueryResources(qc, organizationId, ["account-moves", "account-move-lines"])
}
