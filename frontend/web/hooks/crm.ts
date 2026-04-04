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
    queryFn: () => fetchQueryList('/api/query/activities', 'Failed to fetch activities'),
    staleTime: 30_000,
    initialData,
  })
}

export function useUsers(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['users', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/users', 'Failed to fetch users'),
    staleTime: 60_000,
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

export function useConvertLeadToCustomer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leadId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ leadId, params }) => {
      const r = await fetch('/api/call/convert_lead_to_customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), leadId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to convert lead')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads', organizationId.toString()] })
      void qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] })
      void qc.invalidateQueries({ queryKey: ['opportunities', organizationId.toString()] })
    },
  })
}

export function useConvertOpportunityToSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { opportunityId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ opportunityId, params }) => {
      const r = await fetch('/api/call/convert_opportunity_to_sale_order?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([opportunityId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to convert opportunity to sale order')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opportunities', organizationId.toString()] })
      void qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] })
    },
  })
}

export function useDeleteContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (contactId) => {
      const r = await fetch('/api/call/delete_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contactId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to delete contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useAssignTagToContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contactId: ScalarId; tagId: ScalarId; metadata?: string | null }>({
    mutationFn: async ({ contactId, tagId, metadata }) => {
      const r = await fetch('/api/call/assign_tag_to_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), contactId.toString(), tagId.toString(), metadata ?? null]),
      })
      if (!r.ok) throw new Error('Failed to assign tag')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useAddContactToSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { segmentId: ScalarId; contactId: ScalarId }>({
    mutationFn: async ({ segmentId, contactId }) => {
      const r = await fetch('/api/call/add_contact_to_segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), segmentId.toString(), contactId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to add contact to segment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useCompleteActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (activityId) => {
      const r = await fetch('/api/call/complete_activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), activityId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to complete activity')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities', organizationId.toString()] }),
  })
}

// ── CSV imports (organization_id + csv_data) ─────────────────────────────────

async function parseCallErrorCrm(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

export function useImportContactCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await fetch('/api/call/import_contact_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['contacts', organizationId.toString()] }),
  })
}

export function useImportLeadCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await fetch('/api/call/import_lead_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['leads', organizationId.toString()] }),
  })
}

export function useImportOpportunityCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await fetch('/api/call/import_opportunity_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['opportunities', organizationId.toString()] }),
  })
}

export function useCrmCsvImportMutations(organizationId: bigint) {
  return {
    importContact: useImportContactCsv(organizationId),
    importLead: useImportLeadCsv(organizationId),
    importOpportunity: useImportOpportunityCsv(organizationId),
  }
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateLeadParams,
  CreateOpportunityParams,
  CreateContactParams,
  CreateActivityParams,
  ConvertLeadParams,
  ConvertOpportunityParams,
} from '@lumiere/stdb'
