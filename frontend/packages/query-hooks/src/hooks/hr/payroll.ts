"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import type {
  CreateContractParams,
  CreatePayrollStructureParams,
  CreatePayslipParams,
  CreateSalaryRuleParams,
  HrContract,
  HrPayrollStructure,
  HrPayslip,
  HrSalaryRule,
  UpdateContractParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { decodeOperationDispatch } from "@lumiere/api-client"
import {
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  type ResolvedOperationEffectOutcome,
} from "../operation-effect"
import {
  resolvePayslipPostingEffect,
  resolvePayslipStateEffect,
} from "../hr-payroll-effects"
import {
  finalizeCreateContractParams,
  finalizeCreatePayslipParams,
} from "../hr-params-merge"


export function useContracts(
  organizationId: bigint,
  initialData?: HrContract[],
) {
  return useQuery<HrContract[]>({
    queryKey: ['hr-contracts', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/contracts', 'Failed to fetch contracts'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePayslips(
  organizationId: bigint,
  initialData?: HrPayslip[],
) {
  return useQuery<HrPayslip[]>({
    queryKey: ['hr-payslips', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/payslips', 'Failed to fetch payslips'),
    staleTime: 30_000,
    initialData,
  })
}

/** Bounded queue: payslips approved for export (Verify state). */
export function usePayslipsToExport(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-payslips-to-export', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/payslips-to-export', 'Failed to fetch payslips to export'),
    staleTime: 15_000,
    initialData,
  })
}


export function usePayrollStructures(
  organizationId: bigint,
  initialData?: HrPayrollStructure[],
) {
  return useQuery<HrPayrollStructure[]>({
    queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/payroll-structures', 'Failed to fetch payroll structures'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSalaryRules(
  organizationId: bigint,
  initialData?: HrSalaryRule[],
) {
  return useQuery<HrSalaryRule[]>({
    queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/salary-rules', 'Failed to fetch salary rules'),
    staleTime: 30_000,
    initialData,
  })
}


export function useCreateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateContractParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateContractParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_contract", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreatePayslipParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreatePayslipParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_payslip", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

// ── Attendance & schedules ───────────────────────────────────────────────────


export function useUpdateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number; params: Partial<UpdateContractParams> }>({
    mutationFn: async ({ contractId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = stdbBffCommandPost("update_contract", { contractId: contractId, params: stdbParamsToJson(patch) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contract')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-compensation-events', rqBigIntKey(organizationId)] })
    },
  })
}

export function useOpenContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const { urlPath, init } = stdbBffCommandPost("open_contract", { companyId: companyId ?? null, contractId: contractId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to open contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useExpireContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number }>({
    mutationFn: async ({ contractId }) => {
      const { urlPath, init } = stdbBffCommandPost("expire_contract", { companyId: companyId ?? null, contractId: contractId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to expire contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_contract", { companyId: companyId ?? null, contractId: contractId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Payroll ───────────────────────────────────────────────────────

export function useCreatePayrollStructure(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePayrollStructureParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_payroll_structure", { params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payroll structure')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateSalaryRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateSalaryRuleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_salary_rule", { params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create salary rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<ResolvedOperationEffectOutcome, Error, { payslipId: number; grossWage?: number; netWage?: number; calculationSource?: string }>({
    mutationFn: async ({ payslipId, grossWage, netWage, calculationSource }) => {
      if (companyId == null) throw new Error("companyId is required to approve a payslip")
      const scopedCompanyId = toScalarU64(companyId)
      const scopedPayslipId = toScalarU64(payslipId)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolvePayslipStateEffect(
            await fetchQueryList('/api/query/payslips', 'Failed to read payslips'),
            organizationId,
            scopedCompanyId,
            scopedPayslipId,
            "Verify",
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("confirm_payslip", { payslipId: scopedPayslipId, params: stdbParamsToJson({
              companyId: scopedCompanyId,
              grossWage: grossWage ?? 0,
              netWage: netWage ?? 0,
              calculationSource: calculationSource ?? "manual",
            }) })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            'Failed to approve payslip for export',
          )
        },
        afterDispatch: () => qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useCreatePayrollExportIntent(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { payslipId: number; idempotencyKey: string; payload: string; packKey?: string }
  >({
    mutationFn: async ({ payslipId, idempotencyKey, payload, packKey }) => {
      const { urlPath, init } = stdbBffCommandPost("create_payroll_export_intent", { companyId: companyId ?? null, payslipId: toScalarU64(payslipId), params: stdbParamsToJson({
          idempotencyKey,
          payload,
          packKey,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payroll export intent')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

/** Pending HR statutory/partner integration intents (bounded SQL). */

export function usePostPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome,
    Error,
    {
      payslipId: number
      journalId: number
      expenseAccountId: number
      payableAccountId: number
      taxWithholdingAccountId?: number
      accountingDate: Date
    }
  >({
    mutationFn: async ({
      payslipId,
      journalId,
      expenseAccountId,
      payableAccountId,
      taxWithholdingAccountId,
      accountingDate,
    }) => {
      if (companyId == null) throw new Error("companyId is required to post a payslip")
      const scopedCompanyId = toScalarU64(companyId)
      const scopedPayslipId = toScalarU64(payslipId)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolvePayslipPostingEffect(
            await fetchQueryList('/api/query/payslips', 'Failed to read payslips'),
            await fetchQueryList('/api/query/account-moves', 'Failed to read payroll account move'),
            organizationId,
            scopedCompanyId,
            scopedPayslipId,
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("post_payslip", { companyId: scopedCompanyId, payslipId: scopedPayslipId, params: stdbParamsToJson({
              journalId: toScalarU64(journalId),
              expenseAccountId: toScalarU64(expenseAccountId),
              payableAccountId: toScalarU64(payableAccountId),
              taxWithholdingAccountId:
                taxWithholdingAccountId != null ? toScalarU64(taxWithholdingAccountId) : undefined,
              accountingDate: stbTimestampFromDate(accountingDate),
            }) })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            'Failed to post payslip to GL',
          )
        },
        afterDispatch: async () => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
            qc.invalidateQueries({ queryKey: ['account-moves', rqBigIntKey(organizationId)] }),
          ])
        },
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useCancelPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<ResolvedOperationEffectOutcome, Error, number>({
    mutationFn: async (payslipId) => {
      if (companyId == null) throw new Error("companyId is required to cancel a payslip")
      const scopedCompanyId = toScalarU64(companyId)
      const scopedPayslipId = toScalarU64(payslipId)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolvePayslipStateEffect(
            await fetchQueryList('/api/query/payslips', 'Failed to read payslips'),
            organizationId,
            scopedCompanyId,
            scopedPayslipId,
            "Cancelled",
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("cancel_payslip", {
            companyId: scopedCompanyId,
            payslipId: scopedPayslipId,
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            'Failed to cancel payslip',
          )
        },
        afterDispatch: () => qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}
