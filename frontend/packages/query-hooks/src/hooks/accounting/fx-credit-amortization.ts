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
export function useFxRevaluationRuns(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("fx-revaluation-runs", organizationId, options)
}

export function useRunFxRevaluation(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("run_fx_revaluation", { companyId: companyId, params: stdbParamsToJson(params, "RunFxRevaluationParams") })
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
      const { urlPath, init } = stdbBffCommandPost("run_fx_revaluation_batch", { companyId: companyId, params: stdbParamsToJson(params, "RunFxRevaluationBatchParams") })
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
      const { urlPath, init } = stdbBffCommandPost("post_realized_fx_gain_loss", { companyId: companyId, params: stdbParamsToJson(params, "PostRealizedFxParams") })
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
  return useTypedStdbQuery("partner-credit-controls", organizationId, options)
}

export function usePartnerCreditHolds(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("partner-credit-holds", organizationId, options)
}

export function useUpsertPartnerCreditControl(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("upsert_partner_credit_control", { companyId: companyId, params: stdbParamsToJson(params, "UpsertPartnerCreditControlParams") })
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
      const { urlPath, init } = stdbBffCommandPost("create_bad_debt_write_off", { companyId: companyId, params: stdbParamsToJson(params, "CreateBadDebtWriteOffParams") })
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
  return useTypedStdbQuery("amortization-schedules", organizationId, options)
}

export function useAmortizationLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("amortization-lines", organizationId, options)
}

export function useCreateAmortizationSchedule(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  const k = String(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_amortization_schedule", { companyId: companyId, params: stdbParamsToJson(params, "CreateAmortizationScheduleParams") })
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
      const { urlPath, init } = stdbBffCommandPost("recognize_amortization_line", { companyId: companyId, lineId: lineId, params: stdbParamsToJson(params, "RecognizeAmortizationLineParams") })
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
