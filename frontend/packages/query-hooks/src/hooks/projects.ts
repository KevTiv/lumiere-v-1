"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Projects hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Projects module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

function invalidateTimesheetQueues(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const k = rqBigIntKey(organizationId)
  void qc.invalidateQueries({ queryKey: ['timesheets', k] })
  void qc.invalidateQueries({ queryKey: ['timesheets-to-validate', k] })
  void qc.invalidateQueries({ queryKey: ['timesheets-unbilled', k] })
  void qc.invalidateQueries({ queryKey: ['project-margin-by-project', k] })
  void qc.invalidateQueries({ queryKey: ['resource-utilisation-by-employee', k] })
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

/** Server-bounded: draft timesheets not yet invoiced. */
export function useTimesheetsToValidate(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['timesheets-to-validate', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/timesheets-to-validate',
        'Failed to fetch timesheets awaiting validation',
      ),
    staleTime: 30_000,
    initialData,
  })
}

/** Server-bounded: validated billable timesheets with no invoice link. */
export function useTimesheetsUnbilled(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['timesheets-unbilled', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/timesheets-unbilled',
        'Failed to fetch unbilled timesheets',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProjectRateCards(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['project-rate-cards', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/project-rate-cards', 'Failed to fetch project rate cards'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProjectRateCardLines(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['project-rate-card-lines', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/project-rate-card-lines',
        'Failed to fetch project rate card lines',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useResourceAllocations(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['resource-allocations', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/resource-allocations', 'Failed to fetch resource allocations'),
    staleTime: 30_000,
    initialData,
  })
}

/** Materialised remaining capacity (available − leave − allocations − actual). */
export function useResourceCapacityByEmployee(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['resource-capacity-by-employee', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/resource-capacity-by-employee',
        'Failed to fetch resource capacity',
      ),
    staleTime: 30_000,
    initialData,
  })
}

/** Materialised project margin (billed/unbilled revenue, labor, expenses). */
export function useProjectMarginByProject(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['project-margin-by-project', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/project-margin-by-project',
        'Failed to fetch project margin',
      ),
    staleTime: 30_000,
    initialData,
  })
}

/** Materialised utilisation (available vs billable/non-billable). */
export function useResourceUtilisationByEmployee(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['resource-utilisation-by-employee', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/resource-utilisation-by-employee',
        'Failed to fetch resource utilisation',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProjectMilestones(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['project-milestones', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/project-milestones', 'Failed to fetch project milestones'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHrResources(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['hr-resources', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/hr-resources', 'Failed to fetch HR resources'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHrSkills(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['hr-skills', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/hr-skills', 'Failed to fetch HR skills'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHrEmployeeSkills(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['hr-employee-skills', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/hr-employee-skills', 'Failed to fetch employee skills'),
    staleTime: 30_000,
    initialData,
  })
}

export function useCreateResourceAllocation(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for allocations')
      const { urlPath, init } = stdbBffCommandPost("create_resource_allocation", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        throw new Error(body || 'Failed to create resource allocation')
      }
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['resource-allocations', k] })
      void qc.invalidateQueries({ queryKey: ['resource-capacity-by-employee', k] })
    },
  })
}

export function useCreateProjectMilestone(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for milestones')
      const { urlPath, init } = stdbBffCommandPost("create_project_milestone", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create project milestone')
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['project-milestones', rqBigIntKey(organizationId)],
      }),
  })
}

export function useCreateProjectRateCard(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for rate cards')
      const { urlPath, init } = stdbBffCommandPost("create_project_rate_card", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create project rate card')
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['project-rate-cards', rqBigIntKey(organizationId)],
      }),
  })
}

export function useCreateProjectRateCardLine(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for rate card lines')
      const { urlPath, init } = stdbBffCommandPost("create_project_rate_card_line", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create project rate card line')
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['project-rate-card-lines', rqBigIntKey(organizationId)],
      }),
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProject(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_project", { params: stdbParamsToJson(withCompanyScope(params, companyId)) })

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
      const { urlPath, init } = stdbBffCommandPost("create_task", { params: stdbParamsToJson(withCompanyScope(params, companyId)) })

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
      const { urlPath, init } = stdbBffCommandPost("log_timesheet", { params: stdbParamsToJson(withCompanyScope(params, companyId)) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create timesheet')
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
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
      const { urlPath, init } = stdbBffCommandPost("update_project", { projectId: projectId, params: stdbParamsToJson(withCompanyScope(params, companyId)) })

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
      const { urlPath, init } = stdbBffCommandPost("update_task", { taskId: taskId, params: stdbParamsToJson(withCompanyScope(params, companyId)) })

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
      const tag =
        typeof state === "string"
          ? state
          : state && typeof state === "object" && "tag" in state
            ? String((state as { tag: unknown }).tag)
            : ""
      if (!["Cancelled", "InProgress", "Done", "Approved", "ChangesRequested"].includes(tag)) {
        throw new Error("Invalid task state")
      }
      const { urlPath, init } = stdbBffCommandPost("update_task_state", {
        taskId,
        state: { tag } as {
          tag: "Cancelled" | "InProgress" | "Done" | "Approved" | "ChangesRequested"
        },
      })

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
      const { urlPath, init } = stdbBffCommandPost("start_timesheet_timer", { params: stdbParamsToJson(withCompanyScope(params, companyId)) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start timesheet timer')
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
  })
}

export function useStopTimesheetTimer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (timesheetId: string | number | bigint) => {
      const { urlPath, init } = stdbBffCommandPost("stop_timesheet_timer", { timesheetId: timesheetId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to stop timesheet timer')
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
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
      const { urlPath, init } = stdbBffCommandPost("set_project_active", { projectId: projectId, active: active })

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
      const { urlPath, init } = stdbBffCommandPost("toggle_project_favorite", { projectId: projectId })

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
      const { urlPath, init } = stdbBffCommandPost("set_task_parent", { taskId: taskId, parentId: parentId ?? null })

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
      const { urlPath, init } = stdbBffCommandPost("assign_task_users", { taskId: taskId, userIds: userIds.map((id) => id) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to assign task users')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', rqBigIntKey(organizationId)] }),
  })
}

export type ValidateTimesheetsInput = {
  companyId: bigint | number | string | null
  timesheetIds: (string | number | bigint)[]
  /** Optional WIP JE — only applied when project.allow_wip_je. */
  wipJournalId?: bigint | number | string | null
  wipAccountId?: bigint | number | string | null
  wipLaborAccountId?: bigint | number | string | null
}

export function useValidateTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ValidateTimesheetsInput>({
    mutationFn: async ({
      timesheetIds,
      companyId,
      wipJournalId,
      wipAccountId,
      wipLaborAccountId,
    }) => {
      const { urlPath, init } = stdbBffCommandPost("validate_timesheets", { params: stdbParamsToJson({
          companyId: companyId != null ? toScalarU64(companyId) : null,
          timesheetIds: timesheetIds.map((id) => toScalarU64(id)),
          wipJournalId:
            wipJournalId != null && wipJournalId !== ""
              ? toScalarU64(wipJournalId)
              : null,
          wipAccountId:
            wipAccountId != null && wipAccountId !== ""
              ? toScalarU64(wipAccountId)
              : null,
          wipLaborAccountId:
            wipLaborAccountId != null && wipLaborAccountId !== ""
              ? toScalarU64(wipLaborAccountId)
              : null,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to validate timesheets')
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
  })
}

export type RejectTimesheetsInput = {
  companyId: bigint | number | string | null
  timesheetIds: (string | number | bigint)[]
  reason: string
}

export function useRejectTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, RejectTimesheetsInput>({
    mutationFn: async ({ timesheetIds, companyId, reason }) => {
      const { urlPath, init } = stdbBffCommandPost("reject_timesheets", { params: stdbParamsToJson({
          companyId: companyId != null ? toScalarU64(companyId) : null,
          timesheetIds: timesheetIds.map((id) => toScalarU64(id)),
          reason,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reject timesheets')
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
  })
}

export type ReopenTimesheetsInput = {
  companyId: bigint | number | string | null
  timesheetIds: (string | number | bigint)[]
  reason?: string | null
}

export function useReopenTimesheets(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ReopenTimesheetsInput>({
    mutationFn: async ({ timesheetIds, companyId, reason }) => {
      const { urlPath, init } = stdbBffCommandPost("reopen_timesheets", { params: stdbParamsToJson({
          companyId: companyId != null ? toScalarU64(companyId) : null,
          timesheetIds: timesheetIds.map((id) => toScalarU64(id)),
          reason: reason ?? null,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reopen timesheets')
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
  })
}

export type BillTimesheetsInput = {
  companyId: bigint | number | string
  timesheetIds: (string | number | bigint)[]
  journalId: bigint | number | string
  incomeAccountId: bigint | number | string
  partnerId: bigint | number | string
  invoiceDate: Date | string | number
  /** Optional sale tax IDs; empty lets the server pick company Sale tax (pack GST/VAT). */
  taxIds?: (string | number | bigint)[]
  fiscalPositionId?: bigint | number | string | null
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
      taxIds,
      fiscalPositionId,
    }) => {
      const { urlPath, init } = stdbBffCommandPost("bill_timesheets", { params: stdbParamsToJson({
            companyId: toScalarU64(companyId),
            timesheetIds: timesheetIds.map((id) => toScalarU64(id)),
            journalId: toScalarU64(journalId),
            incomeAccountId: toScalarU64(incomeAccountId),
            partnerId: toScalarU64(partnerId),
            invoiceDate: stbTimestampFromDate(
              invoiceDate instanceof Date ? invoiceDate : new Date(invoiceDate),
            ),
            taxIds: (taxIds ?? []).map((id) => toScalarU64(id)),
            fiscalPositionId:
              fiscalPositionId != null && String(fiscalPositionId).trim() !== ""
                ? toScalarU64(fiscalPositionId)
                : null,
          }) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to bill timesheets')
    },
    onSuccess: () => {
      invalidateTimesheetQueues(qc, organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['account-moves', rqBigIntKey(organizationId)] })
    },
  })
}

// ── CSV imports (organization_id, company_id, csv_data) ───────────────────────

import { responseErrorMessage as parseCallErrorProjects } from "@lumiere/api-client/response-error"

export function useImportProjectCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_project_csv", { companyId: companyId, csvData: csvData })

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
      const { urlPath, init } = stdbBffCommandPost("import_task_csv", { companyId: companyId, csvData: csvData })

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
      const { urlPath, init } = stdbBffCommandPost("import_timesheet_csv", { companyId: companyId, csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorProjects(res))
    },
    onSuccess: () => invalidateTimesheetQueues(qc, organizationId),
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

// ── Wave E reads / mutations ─────────────────────────────────────────────────

export function useCapacityForecastByEmployee(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['capacity-forecast-by-employee', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/capacity-forecast-by-employee',
        'Failed to fetch capacity forecast',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProjectChangeOrders(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['project-change-orders', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/project-change-orders', 'Failed to fetch change orders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProjectEarnedValueByProject(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['project-earned-value-by-project', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/project-earned-value-by-project',
        'Failed to fetch earned value',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProjectIntegrationIntents(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['project-integration-intents', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/project-integration-intents',
        'Failed to fetch project integration intents',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useCreateProjectChangeOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for change orders')
      const { urlPath, init } = stdbBffCommandPost("create_project_change_order", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'Failed to create change order')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['project-change-orders', k] })
    },
  })
}

export function useLinkSubcontractorCost(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for subcontractor link')
      const { urlPath, init } = stdbBffCommandPost("link_subcontractor_cost_to_project", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        throw new Error((await r.text().catch(() => '')) || 'Failed to link subcontractor cost')
      }
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['project-subcontractor-costs', k] })
      void qc.invalidateQueries({ queryKey: ['project-margin-by-project', k] })
      void qc.invalidateQueries({ queryKey: ['project-earned-value-by-project', k] })
    },
  })
}

export function useCreateProjectIntegrationIntent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_project_integration_intent", { params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        throw new Error((await r.text().catch(() => '')) || 'Failed to create integration intent')
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['project-integration-intents', rqBigIntKey(organizationId)],
      })
    },
  })
}

export function useRefreshCapacityForecast(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for forecast refresh')
      const { urlPath, init } = stdbBffCommandPost("refresh_capacity_forecast", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'Failed to refresh forecast')
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['capacity-forecast-by-employee', rqBigIntKey(organizationId)],
      })
    },
  })
}

export function useRefreshProjectEarnedValue(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId is required for EVM refresh')
      const { urlPath, init } = stdbBffCommandPost("refresh_project_earned_value", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'Failed to refresh EVM')
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['project-earned-value-by-project', rqBigIntKey(organizationId)],
      })
    },
  })
}

// Re-export cross-domain dependency so callers import from one place
export { useEmployees } from "./hr"

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateProjectParams,
  CreateTaskParams,
} from '@lumiere/stdb/types'
