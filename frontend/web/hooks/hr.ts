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

// ── Reads ────────────────────────────────────────────────────────────────────

export function useEmployees(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['hr-employees', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/employees')
      if (!r.ok) throw new Error('Failed to fetch employees')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useDepartments(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['hr-departments', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/departments')
      if (!r.ok) throw new Error('Failed to fetch departments')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useLeaveRequests(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['hr-leave-requests', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/leave-requests')
      if (!r.ok) throw new Error('Failed to fetch leave requests')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useContracts(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['hr-contracts', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/contracts')
      if (!r.ok) throw new Error('Failed to fetch contracts')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function usePayslips(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['hr-payslips', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/payslips')
      if (!r.ok) throw new Error('Failed to fetch payslips')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until job_position table/route is added
export function useJobPositions(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['job-positions', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateEmployee(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_hr_employee?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', organizationId.toString()] }),
  })
}

export function useCreateLeaveRequest(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
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

export function useCreateContract(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_hr_contract?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', organizationId.toString()] }),
  })
}

export function useCreatePayslip(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_hr_payslip?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', organizationId.toString()] }),
  })
}
