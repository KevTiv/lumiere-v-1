"use client"

/**
 * Projects hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Projects module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProjects(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['projects', organizationId],
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
    queryKey: ['tasks', organizationId],
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
    queryKey: ['timesheets', organizationId],
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
      const r = await apiFetch('/api/call/create_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId] }),
  })
}

export function useCreateTask(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId] }),
  })
}

export function useCreateTimesheet(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/log_timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create timesheet')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId] }),
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
      const r = await apiFetch('/api/call/update_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          projectId,
          withCompanyScope(params, companyId),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId] }),
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
      const r = await apiFetch('/api/call/update_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          taskId,
          withCompanyScope(params, companyId),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId] }),
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
      const r = await apiFetch('/api/call/update_task_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, taskId, state]),
      })
      if (!r.ok) throw new Error('Failed to update task state')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId] }),
  })
}

export function useStartTimesheetTimer(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/start_timesheet_timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to start timesheet timer')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId] }),
  })
}

export function useStopTimesheetTimer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (timesheetId: string | number | bigint) => {
      const r = await apiFetch('/api/call/stop_timesheet_timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, timesheetId]),
      })
      if (!r.ok) throw new Error('Failed to stop timesheet timer')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId] }),
  })
}

// ── Additional Project Lifecycle Mutations ───────────────────────────────────

export function useSetProjectActive(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      active,
    }: {
      projectId: string | number | bigint
      active: boolean
    }) => {
      const r = await apiFetch('/api/call/set_project_active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, projectId, active]),
      })
      if (!r.ok) throw new Error('Failed to set project active state')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId] }),
  })
}

export function useToggleProjectFavorite(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (projectId: string | number | bigint) => {
      const r = await apiFetch('/api/call/toggle_project_favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, projectId]),
      })
      if (!r.ok) throw new Error('Failed to toggle project favorite')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId] }),
  })
}

export function useSetTaskParent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      parentId,
    }: {
      taskId: string | number | bigint
      parentId: string | number | bigint | null
    }) => {
      const r = await apiFetch('/api/call/set_task_parent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, taskId, parentId ?? null]),
      })
      if (!r.ok) throw new Error('Failed to set task parent')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId] }),
  })
}

export function useAssignTaskUsers(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      userIds,
    }: {
      taskId: string | number | bigint
      userIds: (string | number | bigint)[]
    }) => {
      const r = await apiFetch('/api/call/assign_task_users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, taskId, userIds.map((id) => id)]),
      })
      if (!r.ok) throw new Error('Failed to assign task users')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId] }),
  })
}

export function useValidateTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      timesheetIds,
      validated,
    }: {
      timesheetIds: (string | number | bigint)[]
      validated: boolean
    }) => {
      const r = await apiFetch('/api/call/validate_timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, timesheetIds.map((id) => id), validated]),
      })
      if (!r.ok) throw new Error('Failed to validate timesheets')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId] }),
  })
}

export function useBillTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      timesheetIds,
      partnerId,
    }: {
      timesheetIds: (string | number | bigint)[]
      partnerId?: string | number | bigint | null
    }) => {
      const r = await apiFetch('/api/call/bill_timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, timesheetIds.map((id) => id), partnerId ?? null]),
      })
      if (!r.ok) throw new Error('Failed to bill timesheets')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets', organizationId] })
      qc.invalidateQueries({ queryKey: ['sale-orders', organizationId] })
    },
  })
}

// ── CSV imports (organization_id, company_id, csv_data) ───────────────────────

async function parseCallErrorProjects(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

export function useImportProjectCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_project_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['projects', companyId] }),
  })
}

export function useImportTaskCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_task_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['tasks', companyId] }),
  })
}

export function useImportTimesheetCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_timesheet_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['timesheets', companyId] }),
  })
}

/** Projects / tasks / timesheet CSV import mutations. */
export function useProjectsCsvImportMutations(organizationId: bigint, companyId: bigint) {
  return {
    importProject: useImportProjectCsv(organizationId, companyId),
    importTask: useImportTaskCsv(organizationId, companyId),
    importTimesheet: useImportTimesheetCsv(organizationId, companyId),
  }
}

export type ProjectsCsvImportMutations = ReturnType<typeof useProjectsCsvImportMutations>

// Re-export cross-domain dependency so callers import from one place
export { useEmployees } from "./hr"

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateProjectParams,
  CreateTaskParams,
} from '@lumiere/stdb/generated/types'
