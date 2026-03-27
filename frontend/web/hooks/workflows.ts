/**
 * Workflows hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Workflows module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useWorkflows(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['workflows', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/workflows')
      if (!r.ok) throw new Error('Failed to fetch workflows')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useWorkflowInstances(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['workflow-instances', organizationId.toString()],
    queryFn: async () => {
      // TODO: serverQueryWorkflowInstances exists but no dedicated route yet
      // For now reuse the workflows query to avoid a 404
      const r = await fetch('/api/query/workflows')
      if (!r.ok) throw new Error('Failed to fetch workflow instances')
      // Return empty array — instances are a separate concept from workflow definitions
      return [] as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateWorkflow(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
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

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateWorkflowParams } from '@lumiere/stdb'
