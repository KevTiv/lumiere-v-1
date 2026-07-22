"use client"

/**
 * CRM hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the CRM module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, coalesceQueryInitialData, rqBigIntKey, type QueryRows } from "../http"
import { invalidateResourceQueries, useSubscriptionAwareQuery } from "../subscription-query"
import { crmBffPost } from "@lumiere/stdb/commands"
import type {
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreateActivityParams,
  CreateAssignmentRuleParams,
  CreateContactSegmentParams,
  CreateContactTagParams,
  CreateContactParams,
  CreateContactRelationshipParams,
  CreateCrmForecastSnapshotParams,
  AppendCrmConversationMessageParams,
  OpenCrmConversationParams,
  SetContactSegmentRulesParams,
  UpdateCrmConversationParams,
  CreateLeadParams,
  CreateLeadLostReasonParams,
  CreateLeadSourceParams,
  CreateOpportunityLineParams,
  CreateOpportunityParams,
  CreateOpportunityStageParams,
  UpdateAssignmentRuleParams,
  UpdateContactAddressParams,
  UpdateContactBusinessParams,
  UpdateContactDetailsParams,
  UpdateContactCoreParams,
  UpdateLeadAddressParams,
  UpdateLeadDetailsParams,
  UpdateLeadLostReasonParams,
  UpdateLeadRevenueParams,
  UpdateLeadSourceParams,
  UpdateOpportunityParams,
  UpdateOpportunityStageParams,
  MergeContactsParams,
  AssignContactRoleParams,
  CreateContactIdentityParams,
  EndContactRoleParams,
  UpdateContactIdentityParams,
  ContactVerificationState,
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
  return useSubscriptionAwareQuery('leads', organizationId, { initialData })
}

export function useOpportunities(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useSubscriptionAwareQuery('opportunities', organizationId, { initialData })
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
  return useSubscriptionAwareQuery('opportunity-stages', organizationId, {
    initialData,
    staleTime: 60_000,
  })
}

export function useContacts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useSubscriptionAwareQuery('contacts', organizationId, { initialData })
}

/** Phone, WhatsApp, and mobile-money identities for CRM contacts. */
export function useContactPhoneIdentities(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useSubscriptionAwareQuery("contact-phone-identities", organizationId, {
    initialData,
  })
}

/** Explicit commercial and operational roles assigned to CRM contacts. */
export function useContactRoleAssignments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useSubscriptionAwareQuery("contact-role-assignments", organizationId, {
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
  return useSubscriptionAwareQuery('activities', organizationId, { initialData })
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['leads']),
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
        stdbParamsToJson(finalizeUpdateOpportunityParams(params), "UpdateOpportunityParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update opportunity")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ['opportunities']),
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
        stdbParamsToJson(scoped as object, "CreateOpportunityParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create opportunity')
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ['opportunities']),
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
  })
}

export function useCreateContactIdentity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateContactIdentityParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("create_contact_identity", [
        organizationId,
        stdbParamsToJson(params, "CreateContactIdentityParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallErrorCrm(response))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-phone-identities"]),
  })
}

export function useUpdateContactIdentity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { identityId: ScalarId; params: UpdateContactIdentityParams }
  >({
    mutationFn: async ({ identityId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_identity", [
        organizationId,
        toScalarU64(identityId),
        stdbParamsToJson(params, "UpdateContactIdentityParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallErrorCrm(response))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-phone-identities"]),
  })
}

export function useVerifyContactIdentity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { identityId: ScalarId; state: ContactVerificationState }
  >({
    mutationFn: async ({ identityId, state }) => {
      const { urlPath, init } = crmBffPost("verify_contact_identity", [
        organizationId,
        toScalarU64(identityId),
        state,
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallErrorCrm(response))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-phone-identities"]),
  })
}

export function useArchiveContactIdentity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (identityId) => {
      const { urlPath, init } = crmBffPost("archive_contact_identity", [
        organizationId,
        toScalarU64(identityId),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallErrorCrm(response))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-phone-identities"]),
  })
}

export function useAssignContactRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, AssignContactRoleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("assign_contact_role", [
        organizationId,
        stdbParamsToJson(params, "AssignContactRoleParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallErrorCrm(response))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-role-assignments"]),
  })
}

export function useEndContactRole(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { assignmentId: ScalarId; params: EndContactRoleParams }
  >({
    mutationFn: async ({ assignmentId, params }) => {
      const { urlPath, init } = crmBffPost("end_contact_role", [
        organizationId,
        toScalarU64(assignmentId),
        stdbParamsToJson(params, "EndContactRoleParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallErrorCrm(response))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-role-assignments"]),
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['activities']),
  })
}

export function useUpdateContact(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactCoreParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactParams(params), "UpdateContactCoreParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
  })
}

export function useUpdateContactAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactAddressParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_address", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactAddressParams(params), "UpdateContactAddressParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact address')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
  })
}

export function useUpdateContactBusiness(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactBusinessParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_business", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactBusinessParams(params), "UpdateContactBusinessParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact business')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
  })
}

export function useUpdateContactDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ContactPatch<UpdateContactDetailsParams>>({
    mutationFn: async ({ contactId, params }) => {
      const { urlPath, init } = crmBffPost("update_contact_details", [
        organizationId,
        toScalarU64(contactId),
        stdbParamsToJson(finalizeUpdateContactDetailsParams(params), "UpdateContactDetailsParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contact details')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
  })
}

export function useUpdateLeadDetails(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadPatch<UpdateLeadDetailsParams>>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_details", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(finalizeUpdateLeadDetailsParams(params), "UpdateLeadDetailsParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update lead details')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['leads']),
  })
}

export function useUpdateLeadAddress(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadPatch<UpdateLeadAddressParams>>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_address", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(finalizeUpdateLeadAddressParams(params), "UpdateLeadAddressParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update lead address')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['leads']),
  })
}

export function useUpdateLeadRevenue(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, LeadPatch<UpdateLeadRevenueParams>>({
    mutationFn: async ({ leadId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_revenue", [
        organizationId,
        toScalarU64(leadId),
        stdbParamsToJson(finalizeUpdateLeadRevenueParams(params), "UpdateLeadRevenueParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update lead revenue')
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['leads']),
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
      void invalidateResourceQueries(qc, organizationId, ['contact-tags'])
      void invalidateResourceQueries(qc, organizationId, ['contacts'])
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
      void invalidateResourceQueries(qc, organizationId, ['contact-segments'])
      void invalidateResourceQueries(qc, organizationId, ['contacts'])
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
      void invalidateResourceQueries(qc, organizationId, ['leads'])
      void invalidateResourceQueries(qc, organizationId, ['contacts'])
      void invalidateResourceQueries(qc, organizationId, ['opportunities'])
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
      void invalidateResourceQueries(qc, organizationId, ['opportunities'])
      void invalidateResourceQueries(qc, organizationId, ['sale-orders'])
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
      void invalidateResourceQueries(qc, organizationId, ['opportunity-lines'])
      void invalidateResourceQueries(qc, organizationId, ['opportunities'])
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['leads']),
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['contacts']),
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
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ['activities']),
  })
}

// ── CSV imports (organization_id + csv_data) ─────────────────────────────────

import { responseErrorMessage as parseCallErrorCrm } from "@lumiere/api-client/response-error"

export function useImportContactCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = crmBffPost("import_contact_csv", [organizationId, csvData])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorCrm(res))
    },
    onSuccess: () =>
      void invalidateResourceQueries(qc, organizationId, ['contacts']),
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
      void invalidateResourceQueries(qc, organizationId, ['leads']),
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
      void invalidateResourceQueries(qc, organizationId, ['opportunities']),
  })
}

export function useFindDuplicateContacts(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (companyId) => {
      const { urlPath, init } = crmBffPost("find_duplicate_contacts", [
        organizationId,
        toScalarU64(companyId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to scan for duplicate contacts")
    },
    onSuccess: () =>
      void invalidateResourceQueries(qc, organizationId, ['contacts']),
  })
}

export function useMergeContacts(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const defaultCompanyId = options?.companyId
  return useMutation<
    void,
    Error,
    { sourceContactId: ScalarId; targetContactId: ScalarId; companyId?: ScalarId }
  >({
    mutationFn: async ({ sourceContactId, targetContactId, companyId }) => {
      const scopedCompanyId =
        companyId != null ? toScalarU64(companyId) : defaultCompanyId
      if (scopedCompanyId == null || scopedCompanyId === 0n) {
        throw new Error("Company scope required to merge contacts")
      }
      const params: MergeContactsParams = {
        targetContactId: toScalarU64(targetContactId),
      }
      const { urlPath, init } = crmBffPost("merge_contacts", [
        organizationId,
        scopedCompanyId,
        toScalarU64(sourceContactId),
        stdbParamsToJson(params as object, "MergeContactsParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to merge contacts")
    },
    onSuccess: () => {
      void invalidateResourceQueries(qc, organizationId, ['contacts'])
      void invalidateResourceQueries(qc, organizationId, ['leads'])
      void invalidateResourceQueries(qc, organizationId, ['opportunities'])
      void invalidateResourceQueries(qc, organizationId, ['sale-orders'])
    },
  })
}

export function useCrmCsvImportMutations(organizationId: bigint) {
  return {
    importContact: useImportContactCsv(organizationId),
    importLead: useImportLeadCsv(organizationId),
    importOpportunity: useImportOpportunityCsv(organizationId),
  }
}

// ── Wave 1–2 CRM extensions ───────────────────────────────────────────────────

export function usePrivacyConsents(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("privacy-consent", organizationId, { initialData })
}

export function useContactRelationships(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("contact-relationships", organizationId, { initialData })
}

export function useOpportunityPresence(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("opportunity-presence", organizationId, { initialData })
}

export function useCrmForecastSnapshots(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("crm-forecast-snapshots", organizationId, { initialData })
}

export function useAssignmentRules(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("assignment-rules", organizationId, { initialData })
}

export function useCreateContactRelationship(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateContactRelationshipParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("create_contact_relationship", [
        organizationId,
        stdbParamsToJson(params as object, "CreateContactRelationshipParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create contact relationship")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-relationships"]),
  })
}

export function useEndContactRelationship(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (relationshipId) => {
      const { urlPath, init } = crmBffPost("end_contact_relationship", [
        organizationId,
        toScalarU64(relationshipId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to end contact relationship")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-relationships"]),
  })
}

export function useUpdateContactParent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { companyId: ScalarId; contactId: ScalarId; parentId: ScalarId | null }
  >({
    mutationFn: async ({ companyId, contactId, parentId }) => {
      const { urlPath, init } = crmBffPost("update_contact_parent", [
        organizationId,
        toScalarU64(companyId),
        toScalarU64(contactId),
        parentId == null ? null : toScalarU64(parentId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update contact parent")
    },
    onSuccess: () => invalidateResourceQueries(qc, organizationId, ["contacts"]),
  })
}

export function useCreateOpportunityStage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateOpportunityStageParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("create_opportunity_stage", [
        organizationId,
        stdbParamsToJson(params as object, "CreateOpportunityStageParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create opportunity stage")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["opportunity-stages"]),
  })
}

export function useLeadSources(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("lead-sources", organizationId, {
    initialData,
    staleTime: 60_000,
  })
}

export function useLeadLostReasons(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("lead-lost-reasons", organizationId, {
    initialData,
    staleTime: 60_000,
  })
}

export function useCreateLeadSource(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateLeadSourceParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("create_lead_source", [
        organizationId,
        stdbParamsToJson(params as object, "CreateLeadSourceParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create lead source")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["lead-sources"]),
  })
}

export function useUpdateOpportunityStage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { stageId: ScalarId; params: UpdateOpportunityStageParams }
  >({
    mutationFn: async ({ stageId, params }) => {
      const { urlPath, init } = crmBffPost("update_opportunity_stage", [
        organizationId,
        toScalarU64(stageId),
        stdbParamsToJson(params as object, "UpdateOpportunityStageParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update opportunity stage")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["opportunity-stages"]),
  })
}

export function useUpdateLeadSource(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { sourceId: ScalarId; params: UpdateLeadSourceParams }
  >({
    mutationFn: async ({ sourceId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_source", [
        organizationId,
        toScalarU64(sourceId),
        stdbParamsToJson(params as object, "UpdateLeadSourceParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update lead source")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["lead-sources"]),
  })
}

export function useCreateLeadLostReason(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateLeadLostReasonParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("create_lead_lost_reason", [
        organizationId,
        stdbParamsToJson(params as object, "CreateLeadLostReasonParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create lead lost reason")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["lead-lost-reasons"]),
  })
}

export function useUpdateLeadLostReason(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { lostReasonId: ScalarId; params: UpdateLeadLostReasonParams }
  >({
    mutationFn: async ({ lostReasonId, params }) => {
      const { urlPath, init } = crmBffPost("update_lead_lost_reason", [
        organizationId,
        toScalarU64(lostReasonId),
        stdbParamsToJson(params as object, "UpdateLeadLostReasonParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update lead lost reason")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["lead-lost-reasons"]),
  })
}

export function useUpdateAssignmentRule(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { ruleId: ScalarId; params: UpdateAssignmentRuleParams }
  >({
    mutationFn: async ({ ruleId, params }) => {
      const { urlPath, init } = crmBffPost("update_assignment_rule", [
        organizationId,
        toScalarU64(ruleId),
        stdbParamsToJson(params as object, "UpdateAssignmentRuleParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update assignment rule")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["assignment-rules"]),
  })
}

export function useCreateAssignmentRule(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateAssignmentRuleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("create_assignment_rule", [
        organizationId,
        stdbParamsToJson(params as object, "CreateAssignmentRuleParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create assignment rule")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["assignment-rules"]),
  })
}

export function useUpdateOpportunityPresence(organizationId: bigint) {
  return useMutation<
    void,
    Error,
    { opportunityId: ScalarId; userName: string }
  >({
    mutationFn: async ({ opportunityId, userName }) => {
      const { urlPath, init } = crmBffPost("update_opportunity_presence", [
        organizationId,
        toScalarU64(opportunityId),
        userName,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update opportunity presence")
    },
  })
}

export function useClearOpportunityPresence(organizationId: bigint) {
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (opportunityId) => {
      const { urlPath, init } = crmBffPost("clear_opportunity_presence", [
        toScalarU64(opportunityId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to clear opportunity presence")
    },
  })
}

export function useCreateForecastSnapshot(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { companyId: ScalarId; params: CreateCrmForecastSnapshotParams }
  >({
    mutationFn: async ({ companyId, params }) => {
      const { urlPath, init } = crmBffPost("create_forecast_snapshot", [
        organizationId,
        toScalarU64(companyId),
        stdbParamsToJson(params as object, "CreateCrmForecastSnapshotParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create forecast snapshot")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["crm-forecast-snapshots"]),
  })
}

// ── Deferred CRM foundations ──────────────────────────────────────────────────

export function useLeadScores(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("lead-scores", organizationId, { initialData })
}

export function useLeadScoreFactors(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("lead-score-factors", organizationId, { initialData })
}

export function useContactSegmentRules(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("contact-segment-rules", organizationId, { initialData })
}

export function useContactRelationshipInsights(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("contact-relationship-insights", organizationId, {
    initialData,
  })
}

export function useCrmConversations(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("crm-conversations", organizationId, { initialData })
}

export function useCrmConversationMessages(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("crm-conversation-messages", organizationId, {
    initialData,
  })
}

export function useRecomputeLeadScore(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leadId) => {
      const { urlPath, init } = crmBffPost("recompute_lead_score", [
        organizationId,
        toScalarU64(leadId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to recompute lead score")
    },
    onSuccess: () => {
      void invalidateResourceQueries(qc, organizationId, ["lead-scores"])
      void invalidateResourceQueries(qc, organizationId, ["lead-score-factors"])
    },
  })
}

export function useSetContactSegmentRules(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { segmentId: ScalarId; params: SetContactSegmentRulesParams }
  >({
    mutationFn: async ({ segmentId, params }) => {
      const { urlPath, init } = crmBffPost("set_contact_segment_rules", [
        organizationId,
        toScalarU64(segmentId),
        stdbParamsToJson(params as object, "SetContactSegmentRulesParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to set segment rules")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-segment-rules"]),
  })
}

export function useEvaluateDynamicSegment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (segmentId) => {
      const { urlPath, init } = crmBffPost("evaluate_dynamic_segment", [
        organizationId,
        toScalarU64(segmentId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to evaluate dynamic segment")
    },
    onSuccess: () => {
      void invalidateResourceQueries(qc, organizationId, ["contact-segments"])
      void invalidateResourceQueries(qc, organizationId, ["segment-members"])
    },
  })
}

export function useRecomputeRelationshipInsights(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (contactId) => {
      const { urlPath, init } = crmBffPost("recompute_relationship_insights", [
        organizationId,
        toScalarU64(contactId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to recompute relationship insights")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["contact-relationship-insights"]),
  })
}

export function useOpenCrmConversation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, OpenCrmConversationParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = crmBffPost("open_crm_conversation", [
        organizationId,
        stdbParamsToJson(params as object, "OpenCrmConversationParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to open CRM conversation")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["crm-conversations"]),
  })
}

export function useAppendCrmConversationMessage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { conversationId: ScalarId; params: AppendCrmConversationMessageParams }
  >({
    mutationFn: async ({ conversationId, params }) => {
      const { urlPath, init } = crmBffPost("append_crm_conversation_message", [
        organizationId,
        toScalarU64(conversationId),
        stdbParamsToJson(params as object, "AppendCrmConversationMessageParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to append conversation message")
    },
    onSuccess: () => {
      void invalidateResourceQueries(qc, organizationId, ["crm-conversation-messages"])
      void invalidateResourceQueries(qc, organizationId, ["crm-conversations"])
    },
  })
}

export function useUpdateCrmConversation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { conversationId: ScalarId; params: UpdateCrmConversationParams }
  >({
    mutationFn: async ({ conversationId, params }) => {
      const { urlPath, init } = crmBffPost("update_crm_conversation", [
        organizationId,
        toScalarU64(conversationId),
        stdbParamsToJson(params as object, "UpdateCrmConversationParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update CRM conversation")
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, ["crm-conversations"]),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreateActivityParams,
  CreateAssignmentRuleParams,
  CreateContactParams,
  CreateContactIdentityParams,
  CreateContactRelationshipParams,
  CreateContactSegmentParams,
  CreateContactTagParams,
  CreateCrmForecastSnapshotParams,
  AppendCrmConversationMessageParams,
  OpenCrmConversationParams,
  SetContactSegmentRulesParams,
  UpdateCrmConversationParams,
  CreateLeadParams,
  CreateLeadLostReasonParams,
  CreateLeadSourceParams,
  CreateOpportunityLineParams,
  CreateOpportunityParams,
  CreateOpportunityStageParams,
  UpdateAssignmentRuleParams,
  UpdateContactAddressParams,
  UpdateContactBusinessParams,
  UpdateContactDetailsParams,
  UpdateContactCoreParams,
  UpdateContactIdentityParams,
  AssignContactRoleParams,
  EndContactRoleParams,
  UpdateLeadAddressParams,
  UpdateLeadDetailsParams,
  UpdateLeadLostReasonParams,
  UpdateLeadRevenueParams,
  UpdateLeadSourceParams,
  UpdateOpportunityParams,
  UpdateOpportunityStageParams,
} from '@lumiere/stdb/types'
