"use client"

/**
 * HR hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the HR module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { hrBffPost } from "@lumiere/stdb/commands"
import type {
  CreateContractParams,
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  CreateLeaveRequestParams,
  CreateLeaveTypeParams,
  CreatePayrollStructureParams,
  CreatePayslipParams,
  CreateSalaryRuleParams,
  UpdateContractParams,
  UpdateDepartmentParams,
  UpdateEmployeeParams,
  UpdateJobPositionParams,
  UpdateLeaveTypeParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import {
  finalizeCreateContractParams,
  finalizeCreateDepartmentParams,
  finalizeCreateEmployeeParams,
  finalizeCreateJobPositionParams,
  finalizeCreateLeaveRequestParams,
  finalizeCreatePayslipParams,
  finalizeUpdateLeaveTypeParams,
} from "./hr-params-merge"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useEmployees(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-employees', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/employees', 'Failed to fetch employees'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDepartments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-departments', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/departments', 'Failed to fetch departments'),
    staleTime: 30_000,
    initialData,
  })
}

export function useLeaveRequests(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/leave-requests', 'Failed to fetch leave requests'),
    staleTime: 30_000,
    initialData,
  })
}

export function useContracts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-contracts', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/contracts', 'Failed to fetch contracts'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePayslips(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-payslips', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/payslips', 'Failed to fetch payslips'),
    staleTime: 30_000,
    initialData,
  })
}

export function useJobPositions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['job-positions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/job-positions', 'Failed to fetch job positions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useLeaveTypes(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-leave-types', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/leave-types', 'Failed to fetch leave types'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePayrollStructures(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/payroll-structures', 'Failed to fetch payroll structures'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSalaryRules(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/salary-rules', 'Failed to fetch salary rules'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDepartment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateDepartmentParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateDepartmentParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = hrBffPost("create_department", [
        organizationId,
        stdbParamsToJson(finalized),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateJobPositionParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateJobPositionParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = hrBffPost("create_job_position", [
        organizationId,
        stdbParamsToJson(finalized),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateEmployeeParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateEmployeeParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = hrBffPost("create_employee", [
        organizationId,
        stdbParamsToJson(finalized),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateLeaveRequest(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateLeaveRequestParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateLeaveRequestParams(params)
      const { urlPath, init } = hrBffPost("create_leave_request", [
          organizationId,
          companyId,
          stdbParamsToJson(finalized),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create leave request')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = hrBffPost("create_contract", [
        organizationId,
        stdbParamsToJson(finalized),
      ])

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
      const { urlPath, init } = hrBffPost("create_payslip", [
        organizationId,
        stdbParamsToJson(finalized),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Update ───────────────────────────────────────────────────────

export function useUpdateDepartment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { departmentId: number; params: Partial<UpdateDepartmentParams> }>({
    mutationFn: async ({ departmentId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = hrBffPost("update_department", [
        organizationId,
        departmentId,
        stdbParamsToJson(patch),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { jobId: number; params: Partial<UpdateJobPositionParams> }>({
    mutationFn: async ({ jobId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = hrBffPost("update_job_position", [
        organizationId,
        jobId,
        stdbParamsToJson(patch),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; params: Partial<UpdateEmployeeParams> }>({
    mutationFn: async ({ employeeId, params }) => {
      const { urlPath, init } = hrBffPost("update_employee", [
        organizationId,
        companyId ?? null,
        employeeId,
        stdbParamsToJson(params),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

export function useArchiveEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; terminationDate?: Date }>({
    mutationFn: async ({ employeeId, terminationDate }) => {
      const { urlPath, init } = hrBffPost("archive_employee", [organizationId, companyId ?? null, employeeId, terminationDate])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to archive employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Leave Types & Workflow ───────────────────────────────────────

export function useCreateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateLeaveTypeParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = hrBffPost("create_leave_type", [
          organizationId,
          companyId,
          stdbParamsToJson(params, "CreateLeaveTypeParams"),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveTypeId: ScalarId; params: Partial<UpdateLeaveTypeParams> }>({
    mutationFn: async ({ leaveTypeId, params }) => {
      const { urlPath, init } = hrBffPost("update_leave_type", [
          organizationId,
          companyId,
          toScalarU64(leaveTypeId),
          stdbParamsToJson(finalizeUpdateLeaveTypeParams(params)),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useApproveLeave(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = hrBffPost("approve_leave", [organizationId, toScalarU64(leaveId)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useRefuseLeave(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = hrBffPost("refuse_leave", [organizationId, toScalarU64(leaveId)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to refuse leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useResetLeaveToDraft(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = hrBffPost("reset_leave_to_draft", [organizationId, toScalarU64(leaveId)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reset leave to draft')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

// ── Mutations: Contract Workflow ────────────────────────────────────────────

export function useUpdateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number; params: Partial<UpdateContractParams> }>({
    mutationFn: async ({ contractId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = hrBffPost("update_contract", [
        organizationId,
        contractId,
        stdbParamsToJson(patch),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useOpenContract(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const { urlPath, init } = hrBffPost("open_contract", [organizationId, contractId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to open contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useExpireContract(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number }>({
    mutationFn: async ({ contractId }) => {
      const { urlPath, init } = hrBffPost("expire_contract", [organizationId, contractId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to expire contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelContract(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const { urlPath, init } = hrBffPost("cancel_contract", [organizationId, contractId])

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
      const { urlPath, init } = hrBffPost("create_payroll_structure", [
        organizationId,
        stdbParamsToJson(params),
      ])

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
      const { urlPath, init } = hrBffPost("create_salary_rule", [
        organizationId,
        stdbParamsToJson(params),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create salary rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { payslipId: number; grossWage?: number; netWage?: number }>({
    mutationFn: async ({ payslipId, grossWage, netWage }) => {
      const { urlPath, init } = hrBffPost("confirm_payslip", [
          organizationId,
          toScalarU64(payslipId),
          stdbParamsToJson({
            companyId: companyId != null ? toScalarU64(companyId) : undefined,
            grossWage: grossWage ?? 0,
            netWage: netWage ?? 0,
          }),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to confirm payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (payslipId) => {
      const { urlPath, init } = hrBffPost("cancel_payslip", [organizationId, payslipId, companyId ?? null])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

// ── CSV imports (org + csv_data — no company_id in reducers) ───────────────────

async function parseCallError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

function useImportHrResourceCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_resource_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-resources', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrDepartmentCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_department_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrJobPositionCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_job_position_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrEmployeeCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_employee_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrContractCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_contract_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrLeaveTypeCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_leave_type_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrLeaveCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_leave_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrPayrollStructureCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_payroll_structure_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrSalaryRuleCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_salary_rule_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrPayslipCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = hrBffPost("import_hr_payslip_csv", [organizationId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

/** HR CSV import mutations for module toolbar (org-scoped reducers). */
export function useHrCsvImportMutations(organizationId: bigint) {
  return {
    importResource: useImportHrResourceCsv(organizationId),
    importDepartment: useImportHrDepartmentCsv(organizationId),
    importJobPosition: useImportHrJobPositionCsv(organizationId),
    importEmployee: useImportHrEmployeeCsv(organizationId),
    importContract: useImportHrContractCsv(organizationId),
    importLeaveType: useImportHrLeaveTypeCsv(organizationId),
    importLeave: useImportHrLeaveCsv(organizationId),
    importPayrollStructure: useImportHrPayrollStructureCsv(organizationId),
    importSalaryRule: useImportHrSalaryRuleCsv(organizationId),
    importPayslip: useImportHrPayslipCsv(organizationId),
  }
}

export type HrCsvImportMutations = ReturnType<typeof useHrCsvImportMutations>

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateContractParams,
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  CreateLeaveRequestParams,
  CreatePayslipParams,
} from '@lumiere/stdb/types'
