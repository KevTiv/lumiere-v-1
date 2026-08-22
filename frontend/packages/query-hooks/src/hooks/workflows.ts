"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Workflows hooks — versioned definitions + runtime (Wave 5 cutover).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CancelWorkflowParams,
  CancelWorkflowOutboxParams,
  CancelWorkflowTimerParams,
  CreateWorkflowMigrationPlanParams,
  CreateWorkflowParams,
  FireWorkflowTimerParams,
  MigrateWorkflowInstanceParams,
  PreflightWorkflowMigrationParams,
  SignalWorkflowParams,
  SimulateWorkflowParams,
  StartWorkflowParams,
  Workflow,
  WorkflowInstance,
} from "@lumiere/stdb/types"

const wfKeys = (organizationId: bigint) => rqBigIntKey(organizationId)

function invalidateAllWorkflowQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const o = wfKeys(organizationId)
  void qc.invalidateQueries({ queryKey: ["workflows", o] })
  void qc.invalidateQueries({ queryKey: ["workflow-versions", o] })
  void qc.invalidateQueries({ queryKey: ["workflow-nodes", o] })
  void qc.invalidateQueries({ queryKey: ["workflow-edges", o] })
  void qc.invalidateQueries({ queryKey: ["workflow-instances", o] })
  void qc.invalidateQueries({ queryKey: ["workflow-human-tasks-inbox"] })
  void qc.invalidateQueries({ queryKey: ["workflow-timers-late"] })
  void qc.invalidateQueries({ queryKey: ["workflow-outbox-dead"] })
  void qc.invalidateQueries({ queryKey: ["workflow-decision-events"] })
  void qc.invalidateQueries({ queryKey: ["workflow-migration-plans"] })
  void qc.invalidateQueries({ queryKey: ["workflow-migration-preflights"] })
  void qc.invalidateQueries({ queryKey: ["workflow-migration-results"] })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useWorkflows(organizationId: bigint, initialData?: Workflow[]) {
  return useQuery<Workflow[]>({
    queryKey: ["workflows", wfKeys(organizationId)],
    queryFn: () => fetchQueryList("/api/query/workflows", "Failed to fetch workflows"),
    staleTime: 30_000,
    initialData,
  })
}

export function useWorkflowVersions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-versions", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-versions", "Failed to fetch workflow versions"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowNodes(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-nodes", wfKeys(organizationId)],
    queryFn: () => fetchQueryList("/api/query/workflow-nodes", "Failed to fetch workflow nodes"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowEdges(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-edges", wfKeys(organizationId)],
    queryFn: () => fetchQueryList("/api/query/workflow-edges", "Failed to fetch workflow edges"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowInstances(organizationId: bigint, initialData?: WorkflowInstance[]) {
  return useQuery<WorkflowInstance[]>({
    queryKey: ["workflow-instances", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-instances", "Failed to fetch workflow instances"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowTimersLate(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-timers-late", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-timers-late", "Failed to fetch late workflow timers"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowOutboxDead(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-outbox-dead", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-outbox-dead", "Failed to fetch dead-letter outbox"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowDecisionEvents(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-decision-events", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/workflow-decision-events",
        "Failed to fetch workflow decision events",
      ),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowMigrationPlans(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-migration-plans", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-migration-plans", "Failed to fetch migration plans"),
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowMigrationPreflights(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-migration-preflights", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/workflow-migration-preflights",
        "Failed to fetch migration preflights",
      ),
    staleTime: 15_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

export function useWorkflowMigrationResults(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-migration-results", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/workflow-migration-results",
        "Failed to fetch migration results",
      ),
    staleTime: 15_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

/** @deprecated Removed with Wave 3 graph model — returns empty. */
export function useWorkflowActivities(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-activities", wfKeys(organizationId)],
    queryFn: async () => [],
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

/** @deprecated */
export function useWorkflowTransitions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-transitions", wfKeys(organizationId)],
    queryFn: async () => [],
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

/** @deprecated */
export function useWorkflowWorkitems(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-workitems", wfKeys(organizationId)],
    queryFn: async () => [],
    staleTime: 30_000,
    ...(initialData != null ? { initialData } : {}),
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

function optionalCompanyArg(companyId?: number | null): { some: number } | { none: [] } {
  return companyId != null && companyId > 0 ? { some: companyId } : { none: [] }
}

export function useCreateWorkflow(organizationId: bigint, companyId?: number | null) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateWorkflowParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_workflow", { companyId: optionalCompanyArg(companyId), params: stdbParamsToJson(params as object, "CreateWorkflowParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create workflow")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function usePublishWorkflowVersion(organizationId: bigint, _companyId?: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      workflowVersionId: bigint | number | string
      expectedDraftRevision: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost("publish_workflow_version", { workflowVersionId: input.workflowVersionId, expectedRevision: input.expectedDraftRevision })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to publish workflow version")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useCloneWorkflowVersionToDraft(
  organizationId: bigint,
  _companyId?: number | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      workflowVersionId: bigint | number | string
      expectedDraftRevision: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost("clone_workflow_version_to_draft", { sourceWorkflowVersionId: input.workflowVersionId, expectedRevision: input.expectedDraftRevision })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to clone workflow version")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useRetireWorkflowVersion(organizationId: bigint, _companyId?: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      workflowVersionId: bigint | number | string
      expectedDraftRevision: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost("retire_workflow_version", { workflowVersionId: input.workflowVersionId, expectedRevision: input.expectedDraftRevision })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to retire workflow version")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useImportWorkflowCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_workflow_csv", { csvData: csvData })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to import workflows")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useStartWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: StartWorkflowParams) => {
      const { urlPath, init } = stdbBffCommandPost("start_workflow", { params: stdbParamsToJson(params as object, "StartWorkflowParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to start workflow")
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useSignalWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: SignalWorkflowParams) => {
      const { urlPath, init } = stdbBffCommandPost("signal_workflow", { params: stdbParamsToJson(params as object, "SignalWorkflowParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to signal workflow")
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useCancelWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CancelWorkflowParams) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_workflow", { params: stdbParamsToJson(params as object, "CancelWorkflowParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to cancel workflow")
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useSimulateWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      workflowVersionId: bigint | number | string
      params: SimulateWorkflowParams
    }) => {
      const { urlPath, init } = stdbBffCommandPost("simulate_workflow", { workflowVersionId: input.workflowVersionId, params: stdbParamsToJson(input.params as object, "SimulateWorkflowParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to simulate workflow")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useCreateWorkflowMigrationPlan(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateWorkflowMigrationPlanParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_workflow_migration_plan", { params: stdbParamsToJson(params as object, "CreateWorkflowMigrationPlanParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create migration plan")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useSetWorkflowMigrationPlanActive(
  organizationId: bigint,
  companyId?: number | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { planId: bigint | number | string; active: boolean }) => {
      if (companyId == null) throw new Error("companyId is required")
      const { urlPath, init } = stdbBffCommandPost("set_workflow_migration_plan_active", {
        companyId,
        planId: input.planId,
        active: input.active,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update migration plan")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function usePreflightWorkflowMigration(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: PreflightWorkflowMigrationParams) => {
      const { urlPath, init } = stdbBffCommandPost("preflight_workflow_migration", { params: stdbParamsToJson(params as object, "PreflightWorkflowMigrationParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to preflight migration")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useMigrateWorkflowInstance(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: MigrateWorkflowInstanceParams) => {
      const { urlPath, init } = stdbBffCommandPost("migrate_workflow_instance", { params: stdbParamsToJson(params as object, "MigrateWorkflowInstanceParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to migrate workflow instance")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useFireWorkflowTimer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: FireWorkflowTimerParams) => {
      const { urlPath, init } = stdbBffCommandPost("fire_workflow_timer", { params: stdbParamsToJson(params as object, "FireWorkflowTimerParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to fire workflow timer")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useCancelWorkflowTimer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CancelWorkflowTimerParams) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_workflow_timer", { params: stdbParamsToJson(params as object, "CancelWorkflowTimerParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to cancel workflow timer")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useCancelWorkflowOutbox(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CancelWorkflowOutboxParams) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_workflow_outbox", { params: stdbParamsToJson(params as object, "CancelWorkflowOutboxParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to cancel workflow outbox")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

/** @deprecated Use useCancelWorkflow */
export function useCancelWorkflowInstance(organizationId: bigint) {
  return useCancelWorkflow(organizationId)
}

/** @deprecated Removed — use publish_workflow_version */
export function useSetWorkflowActive(organizationId: bigint) {
  return useMutation({
    mutationFn: async () => {
      throw new Error("set_workflow_active was removed; publish or retire a workflow version")
    },
    onSuccess: () => undefined,
  })
}

/** @deprecated */
export function useAddWorkflowActivity(organizationId: bigint) {
  return useMutation({
    mutationFn: async () => {
      throw new Error("add_workflow_activity was removed; use upsert_workflow_node")
    },
  })
}

/** @deprecated */
export function useAddWorkflowTransition(organizationId: bigint) {
  return useMutation({
    mutationFn: async () => {
      throw new Error("add_workflow_transition was removed; use upsert_workflow_edge")
    },
  })
}

/** @deprecated */
export function useSetWorkitemException(organizationId: bigint) {
  return useMutation({
    mutationFn: async () => {
      throw new Error("set_workitem_exception was removed with the workitem model")
    },
  })
}

export type {
  CreateWorkflowParams,
  StartWorkflowParams,
  SignalWorkflowParams,
  CancelWorkflowParams,
  SimulateWorkflowParams,
  CreateWorkflowMigrationPlanParams,
  PreflightWorkflowMigrationParams,
  MigrateWorkflowInstanceParams,
  FireWorkflowTimerParams,
  CancelWorkflowTimerParams,
  CancelWorkflowOutboxParams,
  Workflow,
  WorkflowInstance,
} from "@lumiere/stdb/types"
