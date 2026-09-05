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
import { invalidateMoveQueries } from "./moves"
export function useAccountPaymentTerms(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("account-payment-terms", organizationId, options)
}

export function useAccountPaymentTermLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("account-payment-term-lines", organizationId, options)
}

export function useAccountPayments(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("account-payments", organizationId, options)
}

export function usePaymentAccounts(organizationId: bigint) {
  return useTypedStdbQuery("payment-accounts", organizationId)
}

export function usePaymentFees(organizationId: bigint) {
  return useTypedStdbQuery("payment-fees", organizationId)
}

export function usePaymentTransactions(organizationId: bigint) {
  return useTypedStdbQuery("payment-transactions", organizationId)
}

export function usePaymentReconciliations(organizationId: bigint) {
  return useTypedStdbQuery("payment-reconciliations", organizationId)
}

export function usePaymentReversals(organizationId: bigint) {
  return useTypedStdbQuery("payment-reversals", organizationId)
}

export function useCreatePaymentAccount(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePaymentAccountParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_payment_account", { params: stdbParamsToJson(params, "CreatePaymentAccountParams") })
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
      const { urlPath, init } = stdbBffCommandPost("create_payment_transaction", { params: stdbParamsToJson(params, "CreatePaymentTransactionParams") })
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
      const { urlPath, init } = stdbBffCommandPost("post_payment_transaction", { transactionId: transactionId })
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
      const { urlPath, init } = stdbBffCommandPost("allocate_payment_transaction", { params: stdbParamsToJson(params, "AllocatePaymentParams") })
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
      const { urlPath, init } = stdbBffCommandPost("reverse_payment_transaction", { transactionId: transactionId, params: stdbParamsToJson(params, "ReversePaymentTransactionParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function useVoidPaymentTransaction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint>({
    mutationFn: async (transactionId) => {
      const { urlPath, init } = stdbBffCommandPost("void_payment_transaction", { transactionId: transactionId })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function useCreatePaymentFee(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePaymentFeeParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_payment_fee", { params: stdbParamsToJson(params, "CreatePaymentFeeParams") })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateOperationalPaymentQueries(qc, organizationId),
  })
}

export function useReconcilePaymentWithInvoice(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { paymentMoveId: bigint; invoiceMoveId: bigint }) => {
      const { urlPath, init } = stdbBffCommandPost("reconcile_payment_with_invoice", { paymentMoveId: args.paymentMoveId, invoiceMoveId: args.invoiceMoveId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMoveQueries(qc, organizationId),
  })
}

export function useCreateAccountPayment(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreatePaymentParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_payment", { params: paymentParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function usePostAccountPayment(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (paymentId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("post_payment", { paymentId: paymentId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateAccountPaymentQueries(qc, organizationId)
      invalidateStdbQueryResources(qc, organizationId, ["account-moves"])
    },
  })
}

export function useCancelAccountPayment(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (paymentId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_payment", { paymentId: paymentId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateAccountPaymentQueries(qc, organizationId)
      invalidateStdbQueryResources(qc, organizationId, ["account-moves"])
    },
  })
}

export function useRegisterPaymentOnInvoice(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { paymentId: bigint; invoiceIds: bigint[]; isBill: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("register_payment_on_invoice", { paymentId: args.paymentId, invoiceIds: args.invoiceIds, isBill: args.isBill })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function useCreatePaymentTerm(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_payment_term", { params: stdbParamsToJson(params as object, "CreatePaymentTermParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function useUpdatePaymentTerm(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      termId: bigint
      name: string | null
      note: string | null
      isActive: boolean | null
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_payment_term", {
        termId: args.termId,
        name: args.name,
        note: args.note,
        isActive: args.isActive,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function useDeletePaymentTerm(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (termId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_payment_term", { termId: termId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function useCreatePaymentTermLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_payment_term_line", { params: stdbParamsToJson(params as object, "CreatePaymentTermLineParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function useUpdatePaymentTermLine(organizationId: number) {
  const qc = useQueryClient()
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
      const { urlPath, init } = stdbBffCommandPost("update_payment_term_line", { lineId: args.lineId, value: args.value, valueAmount: args.valueAmount, days: args.days, months: args.months, daysAfterEndOfMonth: args.daysAfterEndOfMonth, sequence: args.sequence })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function useDeletePaymentTermLine(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_payment_term_line", { lineId: lineId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAccountPaymentQueries(qc, organizationId),
  })
}

export function invalidateOperationalPaymentQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
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

export function invalidateAccountPaymentQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
) {
  invalidateStdbQueryResources(qc, organizationId, [
    "account-payments",
    "account-payment-terms",
    "account-payment-term-lines",
  ])
}
