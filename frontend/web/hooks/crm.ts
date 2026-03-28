/**
 * CRM hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the CRM module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

type ScalarId = string | number | bigint
type ContactUpdate = { contactId: ScalarId; params: Record<string, unknown> }
type LeadUpdate = { leadId: ScalarId; params: Record<string, unknown> }

// ── Reads ────────────────────────────────────────────────────────────────────

export function useLeads(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['leads', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/leads', 'Failed to fetch leads'),
    staleTime: 30_000,
    initialData,
  })
}

export function useOpportunities(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['opportunities', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/opportunities', 'Failed to fetch opportunities'),
    staleTime: 30_000,
    initialData,
  })
}

export function useOpportunityStages(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['opportunity-stages', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/opportunity-stages', 'Failed to fetch opportunity stages'),
    staleTime: 60_000,
    initialData,
  })
}

export function useContacts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['contacts', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/contacts', 'Failed to fetch contacts'),
    staleTime: 30_000,
    initialData,
  })
}

export function useActivities(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['activities', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/calendar-events', 'Failed to fetch activities'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateLead(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
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
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
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
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
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

export function useCreateActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create activity')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities', organizationId.toString()] }),
  })
}

export function useUpdateContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await fetch('/api/call/update_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contactId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useUpdateContactAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await fetch('/api/call/update_contact_address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contactId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update contact address')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useUpdateContactBusiness(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await fetch('/api/call/update_contact_business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contactId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update contact business')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useUpdateContactDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await fetch('/api/call/update_contact_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contactId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update contact details')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useUpdateLeadDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadUpdate>({
    mutationFn: async ({ leadId, params }) => {
      const r = await fetch('/api/call/update_lead_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leadId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update lead details')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', organizationId.toString()] }),
  })
}

export function useUpdateLeadAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadUpdate>({
    mutationFn: async ({ leadId, params }) => {
      const r = await fetch('/api/call/update_lead_address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leadId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update lead address')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', organizationId.toString()] }),
  })
}

export function useUpdateLeadRevenue(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadUpdate>({
    mutationFn: async ({ leadId, params }) => {
      const r = await fetch('/api/call/update_lead_revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leadId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update lead revenue')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', organizationId.toString()] }),
  })
}

export function useCreateContactTag(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_contact_tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create contact tag')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useCreateContactSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_contact_segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create contact segment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateLeadParams,
  CreateOpportunityParams,
  CreateContactParams,
  CreateActivityParams,
} from '@lumiere/stdb'
