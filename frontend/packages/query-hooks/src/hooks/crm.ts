"use client"

/**
 * CRM hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the CRM module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"
import { crmBffPost } from "@lumiere/stdb/commands"
import type {
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreateActivityParams,
  CreateContactSegmentParams,
  CreateContactTagParams,
  CreateContactParams,
  CreateLeadParams,
  CreateOpportunityLineParams,
  CreateOpportunityParams,
  UpdateContactAddressParams,
  UpdateContactBusinessParams,
  UpdateContactDetailsParams,
  UpdateContactParams,
  UpdateLeadAddressParams,
  UpdateLeadDetailsParams,
  UpdateLeadRevenueParams,
  UpdateOpportunityParams,
} from "@lumiere/stdb/types"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import {
  finalizeCreateActivityParams,
  finalizeCreateContactParams,
  finalizeCreateContactSegmentParams,
  finalizeCreateContactTagParams,
  finalizeCreateLeadParams,
  finalizeCreateOpportunityParams,
  finalizeUpdateContactAddressParams,
  finalizeUpdateContactBusinessParams,
  finalizeUpdateContactDetailsParams,
  finalizeUpdateContactParams,
  finalizeUpdateLeadAddressParams,
  finalizeUpdateLeadDetailsParams,
  finalizeUpdateLeadRevenueParams,
  finalizeUpdateOpportunityParams,
} from "./crm-params-merge"

type ScalarId = string | number | bigint

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

type ContactPatch<P> = { contactId: ScalarId; params: Partial<P> }
type LeadPatch<P> = { leadId: ScalarId; params: Partial<P> }
type OpportunityPatch<P> = {
  opportunityId: ScalarId
  companyId?: ScalarId
  params: Partial<P>
}

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

export function useOpportunityLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['opportunity-lines', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/opportunity-lines', 'Failed to fetch opportunity lines'),
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

export function useContactTags(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['contact-tags', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/contact-tags', 'Failed to fetch contact tags'),
    staleTime: 30_000,
    initialData,
  })
}

export function useContactSegments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['contact-segments', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/contact-segments', 'Failed to fetch contact segments'),
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
  return useMutation<void, Error, Partial<CreateLeadParams>>({
    mutationFn: async (params) => {
      const merged = finalizeCreateLeadParams(params)
      const { urlPath, init } = crmBffPost("create_lead", [
        organizationId,
        stdbParamsToJson(merged, "CreateLeadParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Failed to create lead")
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateOpportunity(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const defaultCompanyId = options?.companyId
  return useMutation<void, Error, OpportunityPatch<UpdateOpportunityParams>>({
    mutationFn: async ({ opportunityId, companyId, params }) => {
      const scopedCompanyId =
        companyId != null ? toScalarU64(companyId) : defaultCompanyId
      if (scopedCompanyId == null || scopedCompanyId === 0n) {
        throw new Error("Company scope required to update opportunity")
      }
      const { urlPath, init } = crmBffPost("update_opportunity", [
        organizationId,
        scopedCompanyId,
        toScalarU64(opportunityId),
        stdbParamsToJson(finalizeUpdateOpportunityParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update opportunity")
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["opportunities", rqBigIntKey(organizationId)] }),
  })
}

export function useCreateOpportunity(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, Partial<CreateOpportunityParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateOpportunityParams(params)
      const scoped = withCompanyScope(
        finalized as unknown as Record<string, unknown>,
        scopedCompanyId,
      )
      const { urlPath, init } = crmBffPost("create_opportunity", [
        organizationId,
        stdbParamsToJson(scoped as object),
      ])
      const r = await apiFetch(urlPath, init)
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
  return useMutation<void, Error, Partial<CreateContactParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateContactParams(params)
      const scoped = withCompanyScope(
        finalized as unknown as Record<string, unknown>,
        scopedCompanyId,
      )
      const { urlPath, init } = crmBffPost("create_contact", [
        organizationId,
        stdbParamsToJson(scoped as object, "CreateContactParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Failed to create contact")
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateActivityParams>>({
    mutationFn: async (params) => {
      const merged = finalizeCreateActivityParams(params)
      const { urlPath, init } = crmBffPost("create_activity", [
        organizationId,
        stdbParamsToJson(merged, "CreateActivityParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create activity')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContactAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactAddressParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_address", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactAddressParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact address')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContactBusiness(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactBusinessParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_business", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactBusinessParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact business')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateContactDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactDetailsParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_details", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactDetailsParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact details')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeadDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadPatch<UpdateLeadDetailsParams>>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_details", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(finalizeUpdateLeadDetailsParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update lead details')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeadAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadPatch<UpdateLeadAddressParams>>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_address", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(finalizeUpdateLeadAddressParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update lead address')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeadRevenue(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadPatch<UpdateLeadRevenueParams>>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_revenue", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(finalizeUpdateLeadRevenueParams(params)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update lead revenue')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateContactTag(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateContactTagParams>>({
    mutationFn: async (params) => {
      const merged = finalizeCreateContactTagParams(params)
      const { urlPath, init } = crmBffPost("create_contact_tag", [
        organizationId,
        stdbParamsToJson(merged, "CreateContactTagParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create contact tag')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contact-tags', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateContactSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateContactSegmentParams>>({
    mutationFn: async (params) => {
      const merged = finalizeCreateContactSegmentParams(params)
      const { urlPath, init } = crmBffPost("create_contact_segment", [
        organizationId,
        stdbParamsToJson(merged, "CreateContactSegmentParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create contact segment')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contact-segments', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] })
    },
  })
}

export function useConvertLeadToCustomer(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leadId: ScalarId; params: ConvertLeadParams }>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("convert_lead_to_customer", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(params, "ConvertLeadParams"),
      ])
      const r = await apiFetch(urlPath, init)
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
  return useMutation<void, Error, { opportunityId: ScalarId; params: ConvertOpportunityParams }>({
    mutationFn: async ({ opportunityId, params }) => {
      const { urlPath, init } = crmBffPost("convert_opportunity_to_sale_order", [
        toScalarU64(opportunityId),
        stdbParamsToJson(params, "ConvertOpportunityParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to convert opportunity to sale order')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opportunities', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateOpportunityLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { opportunityId: ScalarId; params: CreateOpportunityLineParams }
  >({
    mutationFn: async ({ opportunityId, params }) => {
      const { urlPath, init } = crmBffPost("create_opportunity_line", [
        toScalarU64(opportunityId),
        stdbParamsToJson(params as object, "CreateOpportunityLineParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create opportunity line')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opportunity-lines', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['opportunities', rqBigIntKey(organizationId)] })
    },
  })
}

export function useDeleteLead(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leadId) => {
      const { urlPath, init } = crmBffPost("delete_lead", [
        organizationId,
        toScalarU64(leadId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to delete lead")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads", rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (contactId) => {
      const { urlPath, init } = crmBffPost("delete_contact", [
        organizationId,
        toScalarU64(contactId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete contact')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useAssignTagToContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contactId: ScalarId; tagId: ScalarId; metadata?: string | null }>({
    mutationFn: async ({ contactId, tagId, metadata }) => {
      const { urlPath, init } = crmBffPost("assign_tag_to_contact", [
        organizationId,
        toScalarU64(contactId),
        toScalarU64(tagId),
        metadata ?? null,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to assign tag')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useAddContactToSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { segmentId: ScalarId; contactId: ScalarId }>({
    mutationFn: async ({ segmentId, contactId }) => {
      const { urlPath, init } = crmBffPost("add_contact_to_segment", [
        organizationId,
        toScalarU64(segmentId),
        toScalarU64(contactId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add contact to segment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', rqBigIntKey(organizationId)] }),
  })
}

export function useCompleteActivity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (activityId) => {
      const { urlPath, init } = crmBffPost("complete_activity", [
        organizationId,
        toScalarU64(activityId),
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = crmBffPost("import_contact_csv", [organizationId, csvData])
      const res = await apiFetch(urlPath, init)
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
      const { urlPath, init } = crmBffPost("import_lead_csv", [organizationId, csvData])
      const res = await apiFetch(urlPath, init)
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
      const { urlPath, init } = crmBffPost("import_opportunity_csv", [organizationId, csvData])
      const res = await apiFetch(urlPath, init)
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
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreateActivityParams,
  CreateContactParams,
  CreateContactSegmentParams,
  CreateContactTagParams,
  CreateLeadParams,
  CreateOpportunityLineParams,
  CreateOpportunityParams,
  UpdateContactAddressParams,
  UpdateContactBusinessParams,
  UpdateContactDetailsParams,
  UpdateContactParams,
  UpdateLeadAddressParams,
  UpdateLeadDetailsParams,
  UpdateLeadRevenueParams,
  UpdateOpportunityParams,
} from '@lumiere/stdb/types'
