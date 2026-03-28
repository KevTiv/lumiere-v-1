/**
 * Workflows hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Workflows module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useWorkflows(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['workflows', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/workflows', 'Failed to fetch workflows'),
    staleTime: 30_000,
    initialData,
  })
}

export function useWorkflowInstances(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['workflow-instances', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/workflow-instances', 'Failed to fetch workflow instances'),
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create workflow')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', organizationId.toString()] }),
  })
}

export function useSetWorkflowActive(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { workflowId: bigint | number | string; isActive: boolean }) => {
      const r = await fetch('/api/call/set_workflow_active', {
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
      await qc.invalidateQueries({ queryKey: ['workflows', organizationId.toString()] })
      await qc.invalidateQueries({ queryKey: ['workflow-instances', organizationId.toString()] })
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
      const r = await fetch('/api/call/start_workflow', {
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
      await qc.invalidateQueries({ queryKey: ['workflow-instances', organizationId.toString()] })
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
      const r = await fetch('/api/call/signal_workflow', {
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
      await qc.invalidateQueries({ queryKey: ['workflow-instances', organizationId.toString()] })
    },
  })
}

export function useCancelWorkflowInstance(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: bigint | number | string) => {
      const r = await fetch('/api/call/cancel_workflow_instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), instanceId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel workflow instance')
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workflow-instances', organizationId.toString()] })
    },
  })
}

export function useSetWorkitemException(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workitemId: bigint | number | string) => {
      const r = await fetch('/api/call/set_workitem_exception', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workitemId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to set workitem exception')
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workflow-instances', organizationId.toString()] })
    },
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateWorkflowParams } from '@lumiere/stdb'
