"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Proposals hooks — SpacetimeDB API (org + company scoped mutators).
 */


import { encodeOptionalU64, stdbParamsToJson } from "@lumiere/stdb/stdb-params-json"
import { scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import type {
  Proposal,
  ProposalBidDecision,
  ProposalClarification,
  ProposalComment,
  ProposalComplianceRequirement,
  ProposalIntegrationIntent,
  ProposalLineItem,
  ProposalPresence,
  ProposalProcurementScore,
  ProposalSection,
  ProposalSourceDoc,
  ProposalTemplate,
  ProposalVersion,
} from "@lumiere/stdb/types"

/** Coerce optional id fields; empty string → null. */
function optionalScalarU64(
  v: bigint | number | string | null | undefined,
): bigint | null {
  if (v == null || String(v) === "") return null
  return toScalarU64(v)
}

function requireCompany(companyId: bigint | undefined): bigint {
  if (companyId == null || companyId <= 0n) {
    throw new Error("Operating company is required for this proposal action")
  }
  return companyId
}

function deadlineToTimestamp(
  deadline: Date | string | null | undefined,
): { microsSinceUnixEpoch: bigint } | null {
  if (deadline == null || deadline === "") return null
  const d = deadline instanceof Date ? deadline : new Date(String(deadline))
  if (Number.isNaN(d.getTime())) return null
  return { microsSinceUnixEpoch: BigInt(d.getTime()) * 1000n }
}

function invalidateProposalQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["proposals"] })
  void qc.invalidateQueries({ queryKey: ["proposal-line-items"] })
  void qc.invalidateQueries({ queryKey: ["proposal-sections"] })
  void qc.invalidateQueries({ queryKey: ["proposal-comments"] })
  void qc.invalidateQueries({ queryKey: ["proposal-versions"] })
  void qc.invalidateQueries({ queryKey: ["proposal-source-docs"] })
  void qc.invalidateQueries({ queryKey: ["proposal-presence"] })
  void qc.invalidateQueries({ queryKey: ["proposal-bid-decisions"] })
  void qc.invalidateQueries({ queryKey: ["proposal-templates"] })
  void qc.invalidateQueries({ queryKey: ["proposal-clauses"] })
  void qc.invalidateQueries({ queryKey: ["proposal-compliance-requirements"] })
  void qc.invalidateQueries({ queryKey: ["proposal-analyses"] })
  void qc.invalidateQueries({ queryKey: ["proposal-procurement-scores"] })
  void qc.invalidateQueries({ queryKey: ["proposal-integration-intents"] })
  void qc.invalidateQueries({ queryKey: ["proposal-clarifications"] })
}

// ── Local param types (generated reducer bindings may lag the new API) ───────

export type CreateProposalParams = {
  title: string
  clientName: string
  currencyId: bigint | number
  value: number
  deadline?: Date | string | null
  description?: string | null
  templateId?: bigint | number | string | null
  partnerId?: bigint | number | string | null
  documentFolderId?: bigint | number | string | null
  metadata?: string | null
}

export type UpdateProposalParams = {
  title?: string | null
  clientName?: string | null
  currencyId?: bigint | number | null
  value?: number | null
  deadline?: Date | string | null
  description?: string | null
  templateId?: bigint | number | string | null
  partnerId?: bigint | number | string | null
  documentFolderId?: bigint | number | string | null
  metadata?: string | null
}

export type UpsertProposalSectionParams = {
  title: string
  content: string
  status: string
  sequence: number
  aiSuggestion?: string | null
}

export type AddProposalLineItemParams = {
  sectionId?: bigint | number | string | null
  productId: bigint | number | string
  productName: string
  productVariantId?: bigint | number | string | null
  description?: string | null
  quantity: number
  priceUnit: number
  discount: number
  notes?: string | null
}

export type UpdateProposalLineItemParams = {
  quantity?: number | null
  priceUnit?: number | null
  discount?: number | null
  notes?: string | null
  description?: string | null
}

export type UpdateProposalSourceDocParams = {
  name?: string | null
  content?: string | null
  docType?: string | null
  wordCount?: number | null
  documentId?: bigint | number | string | null
}

export type RecordProposalBidDecisionParams = {
  decision: string
  rationale: string
}

export type ConvertProposalToSaleOrderParams = {
  warehouseId: bigint | number | string
  pricelistId: bigint | number | string
}

export type ConvertProposalToProjectParams = {
  billType: string
  pricingType: string
}

export type CreateProposalTemplateParams = {
  name: string
  category: string
  locale: string
  countryPackKey?: string | null
  sectionsJson: string
  isActive: boolean
  metadata?: string | null
}

export type UpsertProposalComplianceRequirementParams = {
  requirementKey: string
  title: string
  description?: string | null
  isRequired: boolean
  isComplete: boolean
  isWaived: boolean
  waiverRationale?: string | null
  evidenceDocumentId?: bigint | number | string | null
  sequence: number
}

export type ApplyProposalAnalysisParams = {
  source: string
  isMock: boolean
  findingsJson: string
  requirementsJson: string
  evaluationCriteriaJson: string
  suggestedSectionsJson: string
  scoreJson?: string | null
  materializeCompliance: boolean
}

export type CreateProposalIntegrationIntentParams = {
  proposalVersionId?: bigint | number | string | null
  intentType: string
  idempotencyKey: string
  payload: string
  metadata?: string | null
}

export type UpsertProposalProcurementScoreParams = {
  countryPackKey: string
  scoreKind: string
  scoreValue: number
  maxValue: number
  notes?: string | null
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useProposals(
  organizationId: bigint,
  initialData?: Proposal[],
) {
  return useQuery<Proposal[]>({
    queryKey: ["proposals", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList("/api/query/proposals", "Failed to fetch proposals"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalSections(
  organizationId: bigint,
  initialData?: ProposalSection[],
) {
  return useQuery<ProposalSection[]>({
    queryKey: ["proposal-sections", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-sections", "Failed to fetch proposal sections"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalLineItems(
  organizationId: bigint,
  proposalId?: bigint,
  initialData?: ProposalLineItem[],
) {
  return useQuery<ProposalLineItem[]>({
    queryKey: ["proposal-line-items", rqBigIntKey(organizationId), proposalId?.toString()],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-line-items", "Failed to fetch proposal line items"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalVersions(
  organizationId: bigint,
  initialData?: ProposalVersion[],
) {
  return useQuery<ProposalVersion[]>({
    queryKey: ["proposal-versions", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-versions", "Failed to fetch proposal versions"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalSourceDocs(
  organizationId: bigint,
  initialData?: ProposalSourceDoc[],
) {
  return useQuery<ProposalSourceDoc[]>({
    queryKey: ["proposal-source-docs", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-source-docs", "Failed to fetch proposal source docs"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalPresence(
  organizationId: bigint,
  proposalId?: bigint,
  initialData?: ProposalPresence[],
) {
  return useQuery<ProposalPresence[]>({
    queryKey: ["proposal-presence", rqBigIntKey(organizationId), proposalId?.toString()],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-presence", "Failed to fetch proposal presence"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalComments(
  organizationId: bigint,
  proposalId?: bigint,
  initialData?: ProposalComment[],
) {
  return useQuery<ProposalComment[]>({
    queryKey: ["proposal-comments", rqBigIntKey(organizationId), proposalId?.toString()],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-comments", "Failed to fetch proposal comments"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalBidDecisions(
  organizationId: bigint,
  initialData?: ProposalBidDecision[],
) {
  return useQuery<ProposalBidDecision[]>({
    queryKey: ["proposal-bid-decisions", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/proposal-bid-decisions",
        "Failed to fetch proposal bid decisions",
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalTemplates(
  organizationId: bigint,
  initialData?: ProposalTemplate[],
) {
  return useQuery<ProposalTemplate[]>({
    queryKey: ["proposal-templates", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/proposal-templates", "Failed to fetch proposal templates"),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalComplianceRequirements(
  organizationId: bigint,
  initialData?: ProposalComplianceRequirement[],
) {
  return useQuery<ProposalComplianceRequirement[]>({
    queryKey: ["proposal-compliance-requirements", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/proposal-compliance-requirements",
        "Failed to fetch proposal compliance requirements",
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalClarifications(
  organizationId: bigint,
  initialData?: ProposalClarification[],
) {
  return useQuery<ProposalClarification[]>({
    queryKey: ["proposal-clarifications", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/proposal-clarifications",
        "Failed to fetch proposal clarifications",
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalProcurementScores(
  organizationId: bigint,
  initialData?: ProposalProcurementScore[],
) {
  return useQuery<ProposalProcurementScore[]>({
    queryKey: ["proposal-procurement-scores", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/proposal-procurement-scores",
        "Failed to fetch proposal procurement scores",
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalIntegrationIntents(
  organizationId: bigint,
  initialData?: ProposalIntegrationIntent[],
) {
  return useQuery<ProposalIntegrationIntent[]>({
    queryKey: ["proposal-integration-intents", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/proposal-integration-intents",
        "Failed to fetch proposal integration intents",
      ),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useUpsertProposalSection(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId?: bigint | number | string | null
      expectedRevision?: number
      title: string
      content: string
      status: string
      sequence?: number
      aiSuggestion?: string | null
    }) => {
      const company = requireCompany(companyId)
      const sectionId =
        params.sectionId != null && String(params.sectionId) !== ""
          ? toScalarU64(params.sectionId)
          : 0n
      const { urlPath, init } = stdbBffCommandPost("upsert_proposal_section", { companyId: company, proposalId: toScalarU64(params.proposalId), sectionId: sectionId, expectedRevision: params.expectedRevision ?? 0, params: stdbParamsToJson(
          {
            title: params.title,
            content: params.content,
            status: params.status,
            sequence: params.sequence ?? 0,
            aiSuggestion: params.aiSuggestion ?? null,
          },
          "UpsertProposalSectionParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to upsert proposal section")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposal-sections"] }),
  })
}

export function useResolveProposalSectionConflict(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId: bigint | number | string
      title: string
      content: string
      status: string
      sequence?: number
      aiSuggestion?: string | null
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("resolve_proposal_section_conflict", { companyId: company, proposalId: toScalarU64(params.proposalId), sectionId: toScalarU64(params.sectionId), params: stdbParamsToJson(
          {
            title: params.title,
            content: params.content,
            status: params.status,
            sequence: params.sequence ?? 0,
            aiSuggestion: params.aiSuggestion ?? null,
          },
          "UpsertProposalSectionParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to resolve proposal section conflict")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposal-sections"] }),
  })
}

export function useCreateProposal(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateProposalParams>({
    mutationFn: async (params) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("create_proposal", { companyId: company, params: stdbParamsToJson(
          {
            title: params.title,
            clientName: params.clientName,
            currencyId: params.currencyId,
            value: params.value,
            deadline: deadlineToTimestamp(params.deadline),
            description: params.description ?? null,
            templateId:
              params.templateId != null ? toScalarU64(params.templateId) : null,
            partnerId: params.partnerId != null ? toScalarU64(params.partnerId) : null,
            documentFolderId:
              params.documentFolderId != null
                ? toScalarU64(params.documentFolderId)
                : null,
            metadata: params.metadata ?? null,
          },
          "CreateProposalParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create proposal")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpdateProposal(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
    } & UpdateProposalParams) => {
      const company = requireCompany(companyId)
      const { proposalId, ...fields } = params
      const { urlPath, init } = stdbBffCommandPost("update_proposal", { companyId: company, proposalId: toScalarU64(proposalId), params: stdbParamsToJson(
          {
            title: fields.title ?? null,
            clientName: fields.clientName ?? null,
            currencyId: fields.currencyId ?? null,
            value: fields.value ?? null,
            deadline: deadlineToTimestamp(fields.deadline),
            description: fields.description ?? null,
            templateId:
              fields.templateId != null ? toScalarU64(fields.templateId) : null,
            partnerId: fields.partnerId != null ? toScalarU64(fields.partnerId) : null,
            documentFolderId:
              fields.documentFolderId != null
                ? toScalarU64(fields.documentFolderId)
                : null,
            metadata: fields.metadata ?? null,
          },
          "UpdateProposalParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update proposal")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpdateProposalStatus(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      status: string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("update_proposal_status", { companyId: company, proposalId: toScalarU64(params.proposalId), status: params.status })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update proposal status")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useApproveProposal(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (proposalId: bigint | number | string) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("approve_proposal", { companyId: company, proposalId: toScalarU64(proposalId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to approve proposal")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useRecordProposalBidDecision(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      decision: string
      rationale: string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("record_proposal_bid_decision", { companyId: company, proposalId: toScalarU64(params.proposalId), params: stdbParamsToJson(
          {
            decision: params.decision,
            rationale: params.rationale,
          },
          "RecordProposalBidDecisionParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to record proposal bid decision")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useAddProposalLineItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
    } & AddProposalLineItemParams) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("add_proposal_line_item", { companyId: company, proposalId: toScalarU64(params.proposalId), params: stdbParamsToJson(
          {
            sectionId:
              params.sectionId != null ? toScalarU64(params.sectionId) : null,
            productId: toScalarU64(params.productId),
            productName: params.productName,
            productVariantId:
              params.productVariantId != null
                ? toScalarU64(params.productVariantId)
                : null,
            description: params.description ?? null,
            quantity: params.quantity,
            priceUnit: params.priceUnit,
            discount: params.discount,
            notes: params.notes ?? null,
          },
          "AddProposalLineItemParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to add proposal line item")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpdateProposalLineItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      lineItemId: bigint | number | string
    } & UpdateProposalLineItemParams) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("update_proposal_line_item", { companyId: company, lineItemId: toScalarU64(params.lineItemId), params: stdbParamsToJson(
          {
            quantity: params.quantity ?? null,
            priceUnit: params.priceUnit ?? null,
            discount: params.discount ?? null,
            notes: params.notes ?? null,
            description: params.description ?? null,
          },
          "UpdateProposalLineItemParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update proposal line item")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useDeleteProposalLineItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineItemId: bigint | number | string) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("delete_proposal_line_item", { companyId: company, lineItemId: toScalarU64(lineItemId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to delete proposal line item")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useDeleteProposalSection(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sectionId: bigint | number | string) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("delete_proposal_section", { companyId: company, sectionId: toScalarU64(sectionId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to delete proposal section")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useSaveProposalVersion(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      message: string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("save_proposal_version", { companyId: company, proposalId: toScalarU64(params.proposalId), message: params.message })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to save proposal version")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useRestoreProposalVersion(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      versionId: bigint | number | string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("restore_proposal_version", { companyId: company, proposalId: toScalarU64(params.proposalId), versionId: toScalarU64(params.versionId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to restore proposal version")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useAddProposalSourceDoc(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      name: string
      content: string
      docType: string
      wordCount: number
      documentId?: bigint | number | string | null
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("add_proposal_source_doc", { companyId: company, proposalId: toScalarU64(params.proposalId), name: params.name, content: params.content, docType: params.docType, wordCount: params.wordCount, documentId: encodeOptionalU64(
          params.documentId != null ? toScalarU64(params.documentId) : null,
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to add proposal source document")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useDeleteProposalSourceDoc(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (docId: bigint | number | string) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("delete_proposal_source_doc", { companyId: company, docId: toScalarU64(docId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to delete proposal source document")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpdateProposalSourceDoc(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      docId: bigint | number | string
    } & UpdateProposalSourceDocParams) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("update_proposal_source_doc", { companyId: company, docId: toScalarU64(params.docId), params: stdbParamsToJson(
          {
            name: params.name ?? null,
            content: params.content ?? null,
            docType: params.docType ?? null,
            wordCount: params.wordCount ?? null,
            documentId:
              params.documentId != null ? toScalarU64(params.documentId) : null,
          },
          "UpdateProposalSourceDocParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update proposal source document")
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["proposals"] })
      void qc.invalidateQueries({ queryKey: ["proposal-source-docs"] })
    },
  })
}

export function useReorderProposalLineItems(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      orderedIds: Array<bigint | number | string>
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("reorder_proposal_line_items", { companyId: company, proposalId: toScalarU64(params.proposalId), orderedIds: params.orderedIds.map((id) => toScalarU64(id)) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to reorder proposal line items")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpdateProposalPresence(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId?: bigint | number | string | null
      userName: string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("update_proposal_presence", { companyId: company, proposalId: toScalarU64(params.proposalId), sectionId: encodeOptionalU64(
          params.sectionId != null ? toScalarU64(params.sectionId) : null,
        ), userName: params.userName })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update proposal presence")
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["proposal-presence"] })
    },
  })
}

export function useClearProposalPresence(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (proposalId: bigint | number | string) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("clear_proposal_presence", { companyId: company, proposalId: toScalarU64(proposalId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to clear proposal presence")
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["proposal-presence"] })
    },
  })
}

export function useAddProposalComment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId: bigint | number | string
      content: string
      parentId?: bigint | number | string | null
      authorName: string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("add_proposal_comment", { companyId: company, proposalId: toScalarU64(params.proposalId), sectionId: toScalarU64(params.sectionId), content: params.content, parentId: encodeOptionalU64(
          params.parentId != null ? toScalarU64(params.parentId) : null,
        ), authorName: params.authorName })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to add proposal comment")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useResolveProposalComment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (commentId: bigint | number | string) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("resolve_proposal_comment", { companyId: company, commentId: toScalarU64(commentId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to resolve proposal comment")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useConvertProposalToSaleOrder(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      warehouseId: bigint | number | string
      pricelistId: bigint | number | string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("convert_proposal_to_sale_order", { companyId: company, proposalId: toScalarU64(params.proposalId), params: stdbParamsToJson(
          {
            warehouseId: toScalarU64(params.warehouseId),
            pricelistId: toScalarU64(params.pricelistId),
          },
          "ConvertProposalToSaleOrderParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to convert proposal to sale order")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useConvertProposalToProject(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      billType: string
      pricingType: string
    }) => {
      const company = requireCompany(companyId)
      const { urlPath, init } = stdbBffCommandPost("convert_proposal_to_project", { companyId: company, proposalId: toScalarU64(params.proposalId), params: stdbParamsToJson(
          {
            billType: params.billType,
            pricingType: params.pricingType,
          },
          "ConvertProposalToProjectParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to convert proposal to project")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useCreateProposalTemplate(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateProposalTemplateParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_proposal_template", {
        companyId: requireCompany(companyId),
        params: stdbParamsToJson(
          {
            name: params.name,
            category: params.category,
            locale: params.locale,
            countryPackKey: params.countryPackKey ?? null,
            sectionsJson: params.sectionsJson,
            isActive: params.isActive,
            metadata: params.metadata ?? null,
          },
          "CreateProposalTemplateParams",
        ),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create proposal template")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useApplyProposalTemplate(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      templateId: bigint | number | string
    }) => {
      const { urlPath, init } = stdbBffCommandPost("apply_proposal_template", {
        companyId: requireCompany(companyId),
        proposalId: toScalarU64(params.proposalId),
        templateId: toScalarU64(params.templateId),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to apply proposal template")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpsertProposalComplianceRequirement(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      requirementId?: bigint | number | string | null
      requirementKey: string
      title: string
      description?: string | null
      isRequired: boolean
      isComplete: boolean
      isWaived: boolean
      waiverRationale?: string | null
      evidenceDocumentId?: bigint | number | string | null
      sequence: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost(
        "upsert_proposal_compliance_requirement",
        {
          companyId: requireCompany(companyId),
          proposalId: toScalarU64(params.proposalId),
          requirementId: optionalScalarU64(params.requirementId) ?? 0n,
          params: stdbParamsToJson(
            {
              requirementKey: params.requirementKey,
              title: params.title,
              description: params.description ?? null,
              isRequired: params.isRequired,
              isComplete: params.isComplete,
              isWaived: params.isWaived,
              waiverRationale: params.waiverRationale ?? null,
              evidenceDocumentId: optionalScalarU64(params.evidenceDocumentId),
              sequence: params.sequence,
            },
            "UpsertProposalComplianceRequirementParams",
          ),
        },
      )
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to upsert compliance requirement")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useApplyProposalAnalysis(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
    } & ApplyProposalAnalysisParams) => {
      const { urlPath, init } = stdbBffCommandPost("apply_proposal_analysis", {
        companyId: requireCompany(companyId),
        proposalId: toScalarU64(params.proposalId),
        params: stdbParamsToJson(
          {
            source: params.source,
            isMock: params.isMock,
            findingsJson: params.findingsJson,
            requirementsJson: params.requirementsJson,
            evaluationCriteriaJson: params.evaluationCriteriaJson,
            suggestedSectionsJson: params.suggestedSectionsJson,
            scoreJson: params.scoreJson ?? null,
            materializeCompliance: params.materializeCompliance,
          },
          "ApplyProposalAnalysisParams",
        ),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to apply proposal analysis")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useCreateProposalIntegrationIntent(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      params: {
        proposalId: bigint | number | string
      } & CreateProposalIntegrationIntentParams,
    ) => {
      const { urlPath, init } = stdbBffCommandPost(
        "create_proposal_integration_intent",
        {
          companyId: requireCompany(companyId),
          proposalId: toScalarU64(params.proposalId),
          params: stdbParamsToJson(
            {
              proposalVersionId: optionalScalarU64(params.proposalVersionId),
              intentType: params.intentType,
              idempotencyKey: params.idempotencyKey,
              payload: params.payload,
              metadata: params.metadata ?? null,
            },
            "CreateProposalIntegrationIntentParams",
          ),
        },
      )
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create proposal integration intent")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

export function useUpsertProposalProcurementScore(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      params: {
        proposalId: bigint | number | string
      } & UpsertProposalProcurementScoreParams,
    ) => {
      const { urlPath, init } = stdbBffCommandPost(
        "upsert_proposal_procurement_score",
        {
          companyId: requireCompany(companyId),
          proposalId: toScalarU64(params.proposalId),
          params: stdbParamsToJson(
            {
              countryPackKey: params.countryPackKey,
              scoreKind: params.scoreKind,
              scoreValue: params.scoreValue,
              maxValue: params.maxValue,
              notes: params.notes ?? null,
            },
            "UpsertProposalProcurementScoreParams",
          ),
        },
      )
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to upsert procurement score")
    },
    onSuccess: () => invalidateProposalQueries(qc),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  Proposal,
  ProposalBidDecision,
  ProposalClarification,
  ProposalComment,
  ProposalComplianceRequirement,
  ProposalIntegrationIntent,
  ProposalLineItem,
  ProposalPresence,
  ProposalProcurementScore,
  ProposalSection,
  ProposalSourceDoc,
  ProposalTemplate,
  ProposalVersion,
} from "@lumiere/stdb/types"
