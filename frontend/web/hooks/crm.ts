/**
 * CRM hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the CRM module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useLeads(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['leads', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/leads')
      if (!r.ok) throw new Error('Failed to fetch leads')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useOpportunities(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['opportunities', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/opportunities')
      if (!r.ok) throw new Error('Failed to fetch opportunities')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useContacts(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['contacts', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/contacts')
      if (!r.ok) throw new Error('Failed to fetch contacts')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useActivities(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['activities', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/calendar-events')
      if (!r.ok) throw new Error('Failed to fetch activities')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateLead(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create lead')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', organizationId.toString()] }),
  })
}

export function useCreateOpportunity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create opportunity')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['opportunities', organizationId.toString()] }),
  })
}

export function useCreateContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateLeadParams,
  CreateOpportunityParams,
  CreateContactParams,
} from '@lumiere/stdb'
