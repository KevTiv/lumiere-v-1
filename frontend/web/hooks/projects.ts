/**
 * Projects hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Projects module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProjects(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['projects', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/projects')
      if (!r.ok) throw new Error('Failed to fetch projects')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useTasks(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['tasks', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/tasks')
      if (!r.ok) throw new Error('Failed to fetch tasks')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useTimesheets(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['timesheets', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/timesheets')
      if (!r.ok) throw new Error('Failed to fetch timesheets')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProject(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_project?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId.toString()] }),
  })
}

export function useCreateTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_project_task?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId.toString()] }),
  })
}

export function useCreateTimesheet(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_project_timesheet?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create timesheet')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId.toString()] }),
  })
}

// Re-export cross-domain dependency so callers import from one place
export { useEmployees } from "@/hooks/hr"

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateProjectParams,
  CreateTaskParams,
} from '@lumiere/stdb'
