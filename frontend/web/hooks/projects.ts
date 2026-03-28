/**
 * Projects hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Projects module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProjects(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['projects', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/projects', 'Failed to fetch projects'),
    staleTime: 30_000,
    initialData,
  })
}

export function useTasks(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['tasks', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/tasks', 'Failed to fetch tasks'),
    staleTime: 30_000,
    initialData,
  })
}

export function useTimesheets(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['timesheets', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/timesheets', 'Failed to fetch timesheets'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProject(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId.toString()] }),
  })
}

export function useCreateTask(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId.toString()] }),
  })
}

export function useCreateTimesheet(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/log_timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create timesheet')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId.toString()] }),
  })
}

export function useUpdateProject(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      params,
    }: {
      projectId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const r = await fetch('/api/call/update_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          projectId.toString(),
          withCompanyScope(params, companyId),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId.toString()] }),
  })
}

export function useUpdateTask(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      params,
    }: {
      taskId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const r = await fetch('/api/call/update_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          taskId.toString(),
          withCompanyScope(params, companyId),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId.toString()] }),
  })
}

export function useUpdateTaskState(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      state,
    }: {
      taskId: string | number | bigint
      state: unknown
    }) => {
      const r = await fetch('/api/call/update_task_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), taskId.toString(), state]),
      })
      if (!r.ok) throw new Error('Failed to update task state')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId.toString()] }),
  })
}

export function useStartTimesheetTimer(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/start_timesheet_timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to start timesheet timer')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId.toString()] }),
  })
}

export function useStopTimesheetTimer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (timesheetId: string | number | bigint) => {
      const r = await fetch('/api/call/stop_timesheet_timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), timesheetId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to stop timesheet timer')
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
