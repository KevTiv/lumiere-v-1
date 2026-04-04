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
      const r = await fetch('/api/call/set_project_active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), projectId.toString(), active]),
      })
      if (!r.ok) throw new Error('Failed to set project active state')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId.toString()] }),
  })
}

export function useToggleProjectFavorite(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (projectId: string | number | bigint) => {
      const r = await fetch('/api/call/toggle_project_favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), projectId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to toggle project favorite')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', organizationId.toString()] }),
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
      const r = await fetch('/api/call/set_task_parent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), taskId.toString(), parentId?.toString() ?? null]),
      })
      if (!r.ok) throw new Error('Failed to set task parent')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId.toString()] }),
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
      const r = await fetch('/api/call/assign_task_users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), taskId.toString(), userIds.map((id) => id.toString())]),
      })
      if (!r.ok) throw new Error('Failed to assign task users')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', organizationId.toString()] }),
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
      const r = await fetch('/api/call/validate_timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), timesheetIds.map((id) => id.toString()), validated]),
      })
      if (!r.ok) throw new Error('Failed to validate timesheets')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', organizationId.toString()] }),
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
      const r = await fetch('/api/call/bill_timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), timesheetIds.map((id) => id.toString()), partnerId?.toString() ?? null]),
      })
      if (!r.ok) throw new Error('Failed to bill timesheets')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] })
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
      const res = await fetch('/api/call/import_project_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['projects', companyId.toString()] }),
  })
}

export function useImportTaskCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await fetch('/api/call/import_task_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['tasks', companyId.toString()] }),
  })
}

export function useImportTimesheetCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await fetch('/api/call/import_timesheet_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['timesheets', companyId.toString()] }),
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
export { useEmployees } from "@/hooks/hr"

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateProjectParams,
  CreateTaskParams,
} from '@lumiere/stdb'
