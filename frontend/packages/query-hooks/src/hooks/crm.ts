"use client"

/**
 * CRM hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the CRM module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

type ScalarId = string | number | bigint

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

/** Shallow merge: `overrides` entries with value `undefined` are skipped. */
function mergeReducerParams(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

const CREATE_LEAD_DEFAULTS: Record<string, unknown> = {
  priority: "Medium",
  state: "new",
  tagIds: [],
}

const CREATE_OPPORTUNITY_DEFAULTS: Record<string, unknown> = {
  isWon: false,
  isLost: false,
  tagIds: [],
}

const CREATE_CONTACT_DEFAULTS: Record<string, unknown> = {
  isVendor: false,
  isEmployee: false,
  isProspect: true,
  isPartner: false,
  customerRank: 0,
  supplierRank: 0,
}

const CREATE_ACTIVITY_DEFAULTS: Record<string, unknown> = {
  activityType: "todo",
  priority: "normal",
  state: "planned",
  auto: false,
  isSystem: false,
  isDone: false,
}

type ContactUpdate = { contactId: ScalarId; params: Record<string, unknown> }
type LeadUpdate = { leadId: ScalarId; params: Record<string, unknown> }

// ── Reads ────────────────────────────────────────────────────────────────────

export function useLeads(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['leads', rqBigIntKey(organizationId)],
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
    queryKey: ['opportunities', rqBigIntKey(organizationId)],
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
    queryKey: ['opportunity-stages', rqBigIntKey(organizationId)],
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
    queryKey: ['contacts', rqBigIntKey(organizationId)],
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
    queryKey: ['activities', rqBigIntKey(organizationId)],
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
    queryKey: ['users', rqBigIntKey(organizationId)],
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
      const merged = mergeReducerParams(CREATE_LEAD_DEFAULTS, params)
      const r = await apiFetch('/api/call/create_lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(merged as object)]),
      })
      if (!r.ok) throw new Error('Failed to create lead')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateOpportunity(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_OPPORTUNITY_DEFAULTS, params)
      const scoped = withCompanyScope(merged, scopedCompanyId)
      const r = await apiFetch('/api/call/create_opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(scoped as object)]),
      })
      if (!r.ok) throw new Error('Failed to create opportunity')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['opportunities', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateContact(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_CONTACT_DEFAULTS, params)
      const scoped = withCompanyScope(merged, scopedCompanyId)
      const r = await apiFetch('/api/call/create_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(scoped as object)]),
      })
      if (!r.ok) throw new Error('Failed to create contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_ACTIVITY_DEFAULTS, params)
      const r = await apiFetch('/api/call/create_activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(merged as object)]),
      })
      if (!r.ok) throw new Error('Failed to create activity')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await apiFetch('/api/call/update_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(contactId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContactAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await apiFetch('/api/call/update_contact_address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(contactId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update contact address')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContactBusiness(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await apiFetch('/api/call/update_contact_business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(contactId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update contact business')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContactDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactUpdate>({
    mutationFn: async ({ contactId, params }) => {
      const r = await apiFetch('/api/call/update_contact_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(contactId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update contact details')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeadDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadUpdate>({
    mutationFn: async ({ leadId, params }) => {
      const r = await apiFetch('/api/call/update_lead_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(leadId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update lead details')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeadAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadUpdate>({
    mutationFn: async ({ leadId, params }) => {
      const r = await apiFetch('/api/call/update_lead_address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(leadId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update lead address')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeadRevenue(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadUpdate>({
    mutationFn: async ({ leadId, params }) => {
      const r = await apiFetch('/api/call/update_lead_revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(leadId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update lead revenue')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateContactTag(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_contact_tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error('Failed to create contact tag')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateContactSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_contact_segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error('Failed to create contact segment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useConvertLeadToCustomer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leadId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ leadId, params }) => {
      const r = await apiFetch('/api/call/convert_lead_to_customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(leadId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to convert lead')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['opportunities', rqBigIntKey(organizationId)] })
    },
  })
}

export function useConvertOpportunityToSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { opportunityId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ opportunityId, params }) => {
      const r = await apiFetch('/api/call/convert_opportunity_to_sale_order?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          toScalarU64(opportunityId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to convert opportunity to sale order')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opportunities', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
    },
  })
}

export function useDeleteContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (contactId) => {
      const r = await apiFetch('/api/call/delete_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(contactId)]),
      })
      if (!r.ok) throw new Error('Failed to delete contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useAssignTagToContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contactId: ScalarId; tagId: ScalarId; metadata?: string | null }>({
    mutationFn: async ({ contactId, tagId, metadata }) => {
      const r = await apiFetch('/api/call/assign_tag_to_contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(contactId),
          toScalarU64(tagId),
          metadata ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to assign tag')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useAddContactToSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { segmentId: ScalarId; contactId: ScalarId }>({
    mutationFn: async ({ segmentId, contactId }) => {
      const r = await apiFetch('/api/call/add_contact_to_segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(segmentId),
          toScalarU64(contactId),
        ]),
      })
      if (!r.ok) throw new Error('Failed to add contact to segment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useCompleteActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (activityId) => {
      const r = await apiFetch('/api/call/complete_activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(activityId)]),
      })
      if (!r.ok) throw new Error('Failed to complete activity')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities', rqBigIntKey(organizationId)] }),
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
      const res = await apiFetch('/api/call/import_contact_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useImportLeadCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_lead_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useImportOpportunityCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_opportunity_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['opportunities', rqBigIntKey(organizationId)] }),
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
} from '@lumiere/stdb/generated/types'
