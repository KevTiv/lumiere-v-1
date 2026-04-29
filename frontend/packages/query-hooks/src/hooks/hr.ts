"use client"

/**
 * HR hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the HR module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

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
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_department', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_job_position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateLeaveRequest(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_leave_request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to create leave request')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_payslip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Update ───────────────────────────────────────────────────────

export function useUpdateDepartment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { departmentId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ departmentId, params }) => {
      const r = await apiFetch('/api/call/update_department', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, departmentId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to update department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { jobId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ jobId, params }) => {
      const r = await apiFetch('/api/call/update_job_position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, jobId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to update job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ employeeId, params }) => {
      const r = await apiFetch('/api/call/update_employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, companyId ?? null, employeeId, withCompanyScope(params, companyId)]),
      })
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
      const r = await apiFetch('/api/call/archive_employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, companyId ?? null, employeeId, terminationDate]),
      })
      if (!r.ok) throw new Error('Failed to archive employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Leave Types & Workflow ───────────────────────────────────────

export function useCreateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_leave_type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to create leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveTypeId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ leaveTypeId, params }) => {
      const r = await apiFetch('/api/call/update_leave_type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          toScalarU64(leaveTypeId),
          stdbParamsToJson(params as object),
        ]),
      })
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
      const r = await apiFetch('/api/call/approve_leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(leaveId)]),
      })
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
      const r = await apiFetch('/api/call/refuse_leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(leaveId)]),
      })
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
      const r = await apiFetch('/api/call/reset_leave_to_draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(leaveId)]),
      })
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
  return useMutation<void, Error, { contractId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ contractId, params }) => {
      const r = await apiFetch('/api/call/update_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, contractId, withCompanyScope(params, companyId)]),
      })
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
      const r = await apiFetch('/api/call/open_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, contractId]),
      })
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
      const r = await apiFetch('/api/call/expire_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, contractId]),
      })
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
      const r = await apiFetch('/api/call/cancel_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, contractId]),
      })
      if (!r.ok) throw new Error('Failed to cancel contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Payroll ───────────────────────────────────────────────────────

export function useCreatePayrollStructure(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_payroll_structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error('Failed to create payroll structure')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateSalaryRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_salary_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, params]),
      })
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
      const r = await apiFetch('/api/call/confirm_payslip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(payslipId),
          stdbParamsToJson({
            companyId: companyId != null ? toScalarU64(companyId) : undefined,
            grossWage: grossWage ?? 0,
            netWage: netWage ?? 0,
          }),
        ]),
      })
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
      const r = await apiFetch('/api/call/cancel_payslip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, payslipId, companyId ?? null]),
      })
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
      const res = await apiFetch('/api/call/import_hr_resource_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_department_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_job_position_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_employee_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_contract_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_leave_type_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_leave_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_payroll_structure_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_salary_rule_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
      const res = await apiFetch('/api/call/import_hr_payslip_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
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
export type { CreateJobPositionParams } from '@lumiere/stdb/generated/types'
