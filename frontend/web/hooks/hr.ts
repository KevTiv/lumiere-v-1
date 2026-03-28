/**
 * HR hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the HR module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Notes:
 * - useJobPositions returns empty array (no route yet)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, emptyQueryRows, type QueryRows } from '@/lib/query-fetch'
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

// TODO: No route yet — returns empty array until job_position table/route is added
export function useJobPositions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['job-positions', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
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

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateJobPositionParams } from '@lumiere/stdb'
