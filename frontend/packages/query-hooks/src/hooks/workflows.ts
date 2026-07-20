"use client"

/**
 * Workflows hooks — versioned definitions + runtime (Wave 5 cutover).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"
import { workflowsBffPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CancelWorkflowParams,
  CreateWorkflowParams,
  SignalWorkflowParams,
  StartWorkflowParams,
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
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useWorkflows(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
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
    initialData: initialData ?? [],
  })
}

export function useWorkflowNodes(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-nodes", wfKeys(organizationId)],
    queryFn: () => fetchQueryList("/api/query/workflow-nodes", "Failed to fetch workflow nodes"),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowEdges(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-edges", wfKeys(organizationId)],
    queryFn: () => fetchQueryList("/api/query/workflow-edges", "Failed to fetch workflow edges"),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowInstances(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-instances", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-instances", "Failed to fetch workflow instances"),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowTimersLate(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-timers-late", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-timers-late", "Failed to fetch late workflow timers"),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowOutboxDead(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-outbox-dead", wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/workflow-outbox-dead", "Failed to fetch dead-letter outbox"),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

/** @deprecated Removed with Wave 3 graph model — returns empty. */
export function useWorkflowActivities(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-activities", wfKeys(organizationId)],
    queryFn: async () => [],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

/** @deprecated */
export function useWorkflowTransitions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-transitions", wfKeys(organizationId)],
    queryFn: async () => [],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

/** @deprecated */
export function useWorkflowWorkitems(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ["workflow-workitems", wfKeys(organizationId)],
    queryFn: async () => [],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateWorkflow(organizationId: bigint, companyId?: number | null) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateWorkflowParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = workflowsBffPost("create_workflow", [
        organizationId,
        companyId ?? null,
        stdbParamsToJson(params as object, "CreateWorkflowParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create workflow")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function usePublishWorkflowVersion(organizationId: bigint, companyId?: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      workflowVersionId: bigint | number | string
      expectedDraftRevision: number
    }) => {
      const { urlPath, init } = workflowsBffPost("publish_workflow_version", [
        organizationId,
        companyId ?? null,
        input.workflowVersionId,
        input.expectedDraftRevision,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to publish workflow version")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useCloneWorkflowVersionToDraft(
  organizationId: bigint,
  companyId?: number | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workflowVersionId: bigint | number | string) => {
      const { urlPath, init } = workflowsBffPost("clone_workflow_version_to_draft", [
        organizationId,
        companyId ?? null,
        workflowVersionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to clone workflow version")
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useRetireWorkflowVersion(organizationId: bigint, companyId?: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workflowVersionId: bigint | number | string) => {
      const { urlPath, init } = workflowsBffPost("retire_workflow_version", [
        organizationId,
        companyId ?? null,
        workflowVersionId,
      ])
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
      const { urlPath, init } = workflowsBffPost("import_workflow_csv", [
        organizationId,
        csvData,
      ])
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
      const { urlPath, init } = workflowsBffPost("start_workflow", [
        organizationId,
        stdbParamsToJson(params as object, "StartWorkflowParams"),
      ])
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
      const { urlPath, init } = workflowsBffPost("signal_workflow", [
        organizationId,
        stdbParamsToJson(params as object, "SignalWorkflowParams"),
      ])
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
      const { urlPath, init } = workflowsBffPost("cancel_workflow", [
        organizationId,
        stdbParamsToJson(params as object, "CancelWorkflowParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to cancel workflow")
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
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

export type { CreateWorkflowParams, StartWorkflowParams, SignalWorkflowParams, CancelWorkflowParams } from "@lumiere/stdb/types"
