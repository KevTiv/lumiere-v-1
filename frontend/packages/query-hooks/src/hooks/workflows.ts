"use client"

/**
 * Workflows hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Workflows module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import type {
  AddWorkflowActivityParams,
  AddWorkflowTransitionParams,
  CreateWorkflowParams,
} from '@lumiere/stdb/generated/types'

const wfKeys = (organizationId: bigint) => organizationId.toString()

function invalidateAllWorkflowQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const o = wfKeys(organizationId)
  void qc.invalidateQueries({ queryKey: ['workflows', o] })
  void qc.invalidateQueries({ queryKey: ['workflow-activities', o] })
  void qc.invalidateQueries({ queryKey: ['workflow-instances', o] })
  void qc.invalidateQueries({ queryKey: ['workflow-transitions', o] })
  void qc.invalidateQueries({ queryKey: ['workflow-workitems', o] })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useWorkflows(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['workflows', wfKeys(organizationId)],
    queryFn: () => fetchQueryList('/api/query/workflows', 'Failed to fetch workflows'),
    staleTime: 30_000,
    initialData,
  })
}

export function useWorkflowActivities(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['workflow-activities', wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/workflow-activities', 'Failed to fetch workflow activities'),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowInstances(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['workflow-instances', wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/workflow-instances', 'Failed to fetch workflow instances'),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowTransitions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['workflow-transitions', wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/workflow-transitions', 'Failed to fetch workflow transitions'),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

export function useWorkflowWorkitems(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['workflow-workitems', wfKeys(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/workflow-workitems', 'Failed to fetch workflow work items'),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateWorkflowParams>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), null, params]),
      })
      if (!r.ok) throw new Error('Failed to create workflow')
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useAddWorkflowActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      workflowId: bigint | number | string
      params: AddWorkflowActivityParams
    }) => {
      const r = await apiFetch('/api/call/add_workflow_activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.workflowId.toString(),
          params.params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to add workflow activity')
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useAddWorkflowTransition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      workflowId: bigint | number | string
      activityFrom: bigint | number | string
      activityTo: bigint | number | string
      params: AddWorkflowTransitionParams
    }) => {
      const r = await apiFetch('/api/call/add_workflow_transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.workflowId.toString(),
          params.activityFrom.toString(),
          params.activityTo.toString(),
          params.params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to add workflow transition')
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useImportWorkflowCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await apiFetch('/api/call/import_workflow_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!r.ok) throw new Error('Failed to import workflows')
    },
    onSuccess: () => invalidateAllWorkflowQueries(qc, organizationId),
  })
}

export function useSetWorkflowActive(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { workflowId: bigint | number | string; isActive: boolean }) => {
      const r = await apiFetch('/api/call/set_workflow_active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.workflowId.toString(),
          params.isActive,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update workflow active state')
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useStartWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      workflowId: bigint | number | string
      resId: bigint | number | string
      resType: string
    }) => {
      const r = await apiFetch('/api/call/start_workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.workflowId.toString(),
          params.resId.toString(),
          params.resType,
        ]),
      })
      if (!r.ok) throw new Error('Failed to start workflow')
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useSignalWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      instanceId: bigint | number | string
      signal: string
    }) => {
      const r = await apiFetch('/api/call/signal_workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.instanceId.toString(),
          params.signal,
        ]),
      })
      if (!r.ok) throw new Error('Failed to signal workflow')
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useCancelWorkflowInstance(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: bigint | number | string) => {
      const r = await apiFetch('/api/call/cancel_workflow_instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), instanceId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel workflow instance')
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export function useSetWorkitemException(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workitemId: bigint | number | string) => {
      const r = await apiFetch('/api/call/set_workitem_exception', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workitemId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to set workitem exception')
    },
    onSuccess: async () => {
      invalidateAllWorkflowQueries(qc, organizationId)
    },
  })
}

export type { CreateWorkflowParams } from '@lumiere/stdb/generated/types'
