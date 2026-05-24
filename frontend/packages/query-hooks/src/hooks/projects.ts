"use client"

/**
 * Projects hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Projects module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { projectsBffPost } from "@lumiere/stdb/commands"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProjects(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['projects', rqBigIntKey(organizationId)],
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
    queryKey: ['tasks', rqBigIntKey(organizationId)],
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
    queryKey: ['timesheets', rqBigIntKey(organizationId)],
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
      const { urlPath, init } = projectsBffPost("create_project", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId)),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateTask(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = projectsBffPost("create_task", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId)),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateTimesheet(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = projectsBffPost("log_timesheet", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId)),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create timesheet')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = projectsBffPost("update_project", [
          organizationId,
          projectId,
          stdbParamsToJson(withCompanyScope(params, companyId)),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update project')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = projectsBffPost("update_task", [
          organizationId,
          taskId,
          stdbParamsToJson(withCompanyScope(params, companyId)),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = projectsBffPost("update_task_state", [organizationId, taskId, state])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update task state')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(organizationId)] }),
  })
}

export function useStartTimesheetTimer(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = projectsBffPost("start_timesheet_timer", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId)),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start timesheet timer')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', rqBigIntKey(organizationId)] }),
  })
}

export function useStopTimesheetTimer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (timesheetId: string | number | bigint) => {
      const { urlPath, init } = projectsBffPost("stop_timesheet_timer", [organizationId, timesheetId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to stop timesheet timer')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = projectsBffPost("set_project_active", [organizationId, projectId, active])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to set project active state')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', rqBigIntKey(organizationId)] }),
  })
}

export function useToggleProjectFavorite(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (projectId: string | number | bigint) => {
      const { urlPath, init } = projectsBffPost("toggle_project_favorite", [organizationId, projectId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to toggle project favorite')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = projectsBffPost("set_task_parent", [organizationId, taskId, parentId ?? null])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to set task parent')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = projectsBffPost("assign_task_users", [organizationId, taskId, userIds.map((id) => id)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to assign task users')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(organizationId)] }),
  })
}

export type ValidateTimesheetsInput = {
  companyId: bigint | number | string | null
  timesheetIds: (string | number | bigint)[]
}

export function useValidateTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ValidateTimesheetsInput>({
    mutationFn: async ({ timesheetIds, companyId }) => {
      const { urlPath, init } = projectsBffPost("validate_timesheets", [
        organizationId,
        stdbParamsToJson({
          companyId: companyId != null ? toScalarU64(companyId) : null,
          timesheetIds: timesheetIds.map((id) => toScalarU64(id)),
        }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to validate timesheets')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets', rqBigIntKey(organizationId)] }),
  })
}

export type BillTimesheetsInput = {
  companyId: bigint | number | string | null
  timesheetIds: (string | number | bigint)[]
  journalId: bigint | number | string
  incomeAccountId: bigint | number | string
  partnerId: bigint | number | string
  /** Pass `null` to let the server default the invoice date. */
  invoiceDate: Date | string | number | null
}

export function useBillTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, BillTimesheetsInput>({
    mutationFn: async ({
      timesheetIds,
      companyId,
      journalId,
      incomeAccountId,
      partnerId,
      invoiceDate,
    }) => {
      const { urlPath, init } = projectsBffPost("bill_timesheets", [
          organizationId,
          stdbParamsToJson({
            companyId: companyId != null ? toScalarU64(companyId) : null,
            timesheetIds: timesheetIds.map((id) => toScalarU64(id)),
            journalId: toScalarU64(journalId),
            incomeAccountId: toScalarU64(incomeAccountId),
            partnerId: toScalarU64(partnerId),
            invoiceDate:
              invoiceDate != null
                ? stbTimestampFromDate(
                    invoiceDate instanceof Date ? invoiceDate : new Date(invoiceDate),
                  )
                : null,
          }),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to bill timesheets')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
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
      const { urlPath, init } = projectsBffPost("import_project_csv", [organizationId, companyId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['projects', rqBigIntKey(companyId)] }),
  })
}

export function useImportTaskCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = projectsBffPost("import_task_csv", [organizationId, companyId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(companyId)] }),
  })
}

export function useImportTimesheetCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = projectsBffPost("import_timesheet_csv", [organizationId, companyId, csvData])

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['timesheets', rqBigIntKey(companyId)] }),
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
