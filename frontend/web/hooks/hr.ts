/**
 * HR hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the HR module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useEmployees(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-employees', organizationId.toString()],
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
    queryKey: ['hr-departments', organizationId.toString()],
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
    queryKey: ['hr-leave-requests', organizationId.toString()],
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
    queryKey: ['hr-contracts', organizationId.toString()],
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
    queryKey: ['hr-payslips', organizationId.toString()],
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
    queryKey: ['job-positions', organizationId.toString()],
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
    queryKey: ['hr-leave-types', organizationId.toString()],
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
    queryKey: ['hr-payroll-structures', organizationId.toString()],
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
    queryKey: ['hr-salary-rules', organizationId.toString()],
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
      const r = await fetch('/api/call/create_department', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', organizationId.toString()] }),
  })
}

export function useCreateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_job_position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', organizationId.toString()] }),
  })
}

export function useCreateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', organizationId.toString()] }),
  })
}

export function useCreateLeaveRequest(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_leave_request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create leave request')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', organizationId.toString()] }),
  })
}

export function useCreateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', organizationId.toString()] }),
  })
}

export function useCreatePayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_payslip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', organizationId.toString()] }),
  })
}

// ── Mutations: Update ───────────────────────────────────────────────────────

export function useUpdateDepartment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { departmentId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ departmentId, params }) => {
      const r = await fetch('/api/call/update_department', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), departmentId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to update department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', organizationId.toString()] }),
  })
}

export function useUpdateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { jobId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ jobId, params }) => {
      const r = await fetch('/api/call/update_job_position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), jobId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to update job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', organizationId.toString()] }),
  })
}

export function useUpdateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ employeeId, params }) => {
      const r = await fetch('/api/call/update_employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId?.toString(), employeeId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to update employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', organizationId.toString()] }),
  })
}

export function useArchiveEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; terminationDate?: Date }>({
    mutationFn: async ({ employeeId, terminationDate }) => {
      const r = await fetch('/api/call/archive_employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId?.toString(), employeeId, terminationDate]),
      })
      if (!r.ok) throw new Error('Failed to archive employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', organizationId.toString()] }),
  })
}

// ── Mutations: Leave Types & Workflow ───────────────────────────────────────

export function useCreateLeaveType(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_leave_type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', organizationId.toString()] }),
  })
}

export function useUpdateLeaveType(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveTypeId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ leaveTypeId, params }) => {
      const r = await fetch('/api/call/update_leave_type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leaveTypeId, params]),
      })
      if (!r.ok) throw new Error('Failed to update leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', organizationId.toString()] }),
  })
}

export function useApproveLeave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveId: number; managerId?: number }>({
    mutationFn: async ({ leaveId, managerId }) => {
      const r = await fetch('/api/call/approve_leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leaveId, managerId]),
      })
      if (!r.ok) throw new Error('Failed to approve leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', organizationId.toString()] })
    },
  })
}

export function useRefuseLeave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveId: number; managerId?: number }>({
    mutationFn: async ({ leaveId, managerId }) => {
      const r = await fetch('/api/call/refuse_leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leaveId, managerId]),
      })
      if (!r.ok) throw new Error('Failed to refuse leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', organizationId.toString()] })
    },
  })
}

export function useResetLeaveToDraft(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (leaveId) => {
      const r = await fetch('/api/call/reset_leave_to_draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leaveId]),
      })
      if (!r.ok) throw new Error('Failed to reset leave to draft')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', organizationId.toString()] })
    },
  })
}

// ── Mutations: Contract Workflow ────────────────────────────────────────────

export function useUpdateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number; params: Record<string, unknown> }>({
    mutationFn: async ({ contractId, params }) => {
      const r = await fetch('/api/call/update_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contractId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to update contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', organizationId.toString()] }),
  })
}

export function useOpenContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const r = await fetch('/api/call/open_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contractId, companyId?.toString()]),
      })
      if (!r.ok) throw new Error('Failed to open contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', organizationId.toString()] }),
  })
}

export function useExpireContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number; endDate?: Date }>({
    mutationFn: async ({ contractId, endDate }) => {
      const r = await fetch('/api/call/expire_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contractId, companyId?.toString(), endDate]),
      })
      if (!r.ok) throw new Error('Failed to expire contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', organizationId.toString()] }),
  })
}

export function useCancelContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const r = await fetch('/api/call/cancel_contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contractId, companyId?.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', organizationId.toString()] }),
  })
}

// ── Mutations: Payroll ───────────────────────────────────────────────────────

export function useCreatePayrollStructure(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_payroll_structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create payroll structure')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payroll-structures', organizationId.toString()] }),
  })
}

export function useCreateSalaryRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_salary_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create salary rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-salary-rules', organizationId.toString()] }),
  })
}

export function useConfirmPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { payslipId: number; grossWage?: number; netWage?: number }>({
    mutationFn: async ({ payslipId, grossWage, netWage }) => {
      const r = await fetch('/api/call/confirm_payslip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), payslipId, companyId?.toString(), { gross_wage: grossWage, net_wage: netWage }]),
      })
      if (!r.ok) throw new Error('Failed to confirm payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', organizationId.toString()] }),
  })
}

export function useCancelPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (payslipId) => {
      const r = await fetch('/api/call/cancel_payslip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), payslipId, companyId?.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateJobPositionParams } from '@lumiere/stdb'
