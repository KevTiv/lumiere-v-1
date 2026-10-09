"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { ArrowLeft, Download, ChevronDown, Upload } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  AIAnalysis,
  TenderSection,
  SectionStatus,
  ProposalStatus,
  SourceDocument,
  WorkspaceAction,
} from "@/lib/proposal-workspace-types"
import type { ProposalPresence, ProposalSourceDoc } from "@lumiere/stdb/proposal-row-types"
import { SECTION_TEMPLATES } from "@/lib/proposal-workspace-types"
import { SectionSidebar } from "./section-sidebar"
import { SectionEditor } from "./section-editor"
import { AIPanel } from "./ai-panel"
import { VersionHistoryBar, SaveVersionButton } from "./version-history-bar"
import { PresenceBar } from "./presence-bar"
import { DocumentInputPanel } from "./document-input-panel"
import { ComplianceChecklist } from "./compliance-checklist"
import { parseBidDecisionInput } from "./bid-decision"
import { parseProcurementScoreInput, procurementScoresForProposal, type ProcurementScoreView } from "./procurement-score"
import { moveLineItemOrder, proposalLineItemsInOrder, type LineItemMoveDirection } from "./line-item-order"
import {
  DEFAULT_TEMPLATE_CATEGORY,
  DEFAULT_TEMPLATE_LOCALE,
  parseSectionTemplateInput,
} from "./section-template"
import { ProcurementScoresPanel } from "./procurement-scores-panel"
import { PROJECT_BILL_TYPES, PROJECT_PRICING_TYPES, parseProjectConversionInput } from "./project-conversion"
import { useFormDialog } from "../forms/use-form-dialog"
import { showWorkflowToast } from "../lib/workflow-toast"
import { rowBool, rowNumber, rowString } from "./row-field-utils"
import {
  readSectionConflictError,
  updateConflictDraft,
  type SectionConflict,
  type SectionDraft,
} from "./section-conflict"

/** Stable fallback when query hooks return undefined — inline `= []` creates a new ref each render. */
const EMPTY_QUERY_ROWS: Record<string, unknown>[] = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length
}

function mapSourceDocRow(d: unknown): SourceDocument {
  const row = d as ProposalSourceDoc
  return {
    id: String(row.id),
    name: rowString(row.name),
    content: rowString(row.content),
    type: rowString(row.docType) === "uploaded" ? "uploaded" : "pasted",
    wordCount: rowNumber(row.wordCount),
    addedAt: new Date(rowNumber(row.addedAt, 0) / 1000),
  }
}

function rowField(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

// Keep diff utilities for version history
function _simpleLineDiff(
  oldLines: string[],
  newLines: string[]
): import("@/lib/proposal-workspace-types").VersionLine[] {
  const result: import("@/lib/proposal-workspace-types").VersionLine[] = []
  const m = oldLines.length, n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j])
  let i = m, j = n
  const ops: import("@/lib/proposal-workspace-types").VersionLine[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) { ops.push({ type: "unchanged", text: oldLines[i - 1] }); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.push({ type: "added", text: newLines[j - 1] }); j-- }
    else { ops.push({ type: "removed", text: oldLines[i - 1] }); i-- }
  }
  ops.reverse()
  result.push(...ops)
  return result
}

// ─── Constants ────────────────────────────────────────────────────────────────

function getStatusOptions(t: (key: string) => string): { value: ProposalStatus; label: string }[] {
  return [
    { value: "draft", label: t("proposalWorkspace.status.draft") },
    { value: "review", label: t("proposalWorkspace.status.review") },
    { value: "submitted", label: t("proposalWorkspace.status.submitted") },
    { value: "awarded", label: t("proposalWorkspace.status.awarded") },
    { value: "rejected", label: t("proposalWorkspace.status.rejected") },
    { value: "archived", label: t("proposalWorkspace.status.archived") },
  ]
}

const STATUS_VARIANT: Record<ProposalStatus, "secondary" | "outline" | "default" | "destructive"> = {
  draft: "secondary",
  review: "outline",
  submitted: "default",
  awarded: "default",
  rejected: "destructive",
  archived: "secondary",
}

// ─── Hook Types ───────────────────────────────────────────────────────────────

/** Subset of React Query shape — workspace only reads `data` (with `?? []`). */
export type QueryResult<T = unknown> = { data: T[] | undefined }
export type UseQueryHook<T = unknown> = (
  organizationId: bigint,
  initialData?: Record<string, unknown>[]
) => QueryResult<T>
export type UseQueryHookWithId<T = unknown> = (
  organizationId: bigint,
  id?: bigint,
  initialData?: Record<string, unknown>[]
) => QueryResult<T>

export type MutationResult<T> = {
  mutate: (params: T, options?: { onSettled?: () => void; onError?: (error: unknown) => void }) => void
  isPending?: boolean
}

/** A mutation the caller awaits, so the workspace can report success or failure itself. */
export type AsyncMutationResult<T> = {
  mutateAsync: (params: T) => Promise<unknown>
  isPending?: boolean
}

export interface ProposalWorkspaceHooks {
  // Query hooks
  useProposalSections: UseQueryHook<unknown>
  useProposalSourceDocs: UseQueryHook<unknown>
  useProposalVersions: UseQueryHook<unknown>
  useProposalLineItems: UseQueryHookWithId<unknown>
  useProposalPresence: UseQueryHookWithId<unknown>
  useProposalComments: UseQueryHookWithId<unknown>
  useProducts: UseQueryHook<unknown>

  // Mutation hooks
  useUpsertProposalSection: () => MutationResult<{
    proposalId: bigint | number | string
    sectionId?: bigint | number | string | null
    expectedRevision?: number
    title: string
    content: string
    status: string
    sequence?: number
    aiSuggestion?: string | null
  }>
  useDeleteProposalSection: () => MutationResult<{ sectionId: bigint | number | string }>
  useAddProposalSourceDoc: () => MutationResult<{
    proposalId: bigint | number | string
    name: string
    content: string
    docType: string
    wordCount: number
  }>
  useDeleteProposalSourceDoc: () => MutationResult<{ docId: bigint | number | string }>
  useUpdateProposalSourceDoc: () => MutationResult<{
    docId: bigint | number | string
    name?: string
    content?: string
    docType?: string
    wordCount?: number
    documentId?: bigint | number | string | null
  }>
  useSaveProposalVersion: () => MutationResult<{
    proposalId: bigint | number | string
    message: string
  }>
  useRestoreProposalVersion: () => MutationResult<{
    proposalId: bigint | number | string
    versionId: bigint | number | string
  }>
  useUpdateProposalStatus: () => MutationResult<{
    proposalId: bigint | number | string
    status: string
  }>
  useAddProposalLineItem: () => MutationResult<{
    proposalId: bigint | number | string
    sectionId?: bigint | number | string | null
    productId: bigint | number | string
    productName: string
    quantity: number
    priceUnit: number
    discount: number
    notes?: string | null
  }>
  useUpdateProposalLineItem: () => MutationResult<{
    lineItemId: bigint | number | string
    quantity: number
    priceUnit: number
    discount: number
    notes?: string | null
  }>
  useDeleteProposalLineItem: () => MutationResult<{ lineItemId: bigint | number | string }>
  useUpdateProposalPresence: () => MutationResult<{
    proposalId: bigint | number | string
    sectionId?: bigint | number | string | null
    userName: string
  }>
  useClearProposalPresence: () => MutationResult<bigint | number | string>
  useAddProposalComment: () => MutationResult<{
    proposalId: bigint | number | string
    sectionId: bigint | number | string
    content: string
    parentId?: bigint | number | string | null
    authorName: string
  }>
  useResolveProposalComment: () => MutationResult<bigint | number | string>
  useProposalTemplates: UseQueryHook<unknown>
  useProposalComplianceRequirements: UseQueryHook<unknown>
  useProposalProcurementScores: UseQueryHook<unknown>
  useApplyProposalTemplate: () => MutationResult<{
    proposalId: bigint | number | string
    templateId: bigint | number | string
  }>
  useUpsertProposalComplianceRequirement: () => MutationResult<{
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
  }>
  useCreateProposalIntegrationIntent: () => MutationResult<{
    proposalId: bigint | number | string
    proposalVersionId?: bigint | number | string | null
    intentType: string
    idempotencyKey: string
    payload: string
    metadata?: string | null
  }>
  useRecordProposalBidDecision: () => AsyncMutationResult<{
    proposalId: bigint | number | string
    decision: string
    rationale: string
  }>
  useConvertProposalToProject: () => AsyncMutationResult<{
    proposalId: bigint | number | string
    billType: string
    pricingType: string
  }>
  useCreateProposalTemplate: () => AsyncMutationResult<{
    name: string
    category: string
    locale: string
    countryPackKey?: string | null
    sectionsJson: string
    isActive: boolean
    metadata?: string | null
  }>
  useReorderProposalLineItems: () => AsyncMutationResult<{
    proposalId: bigint | number | string
    orderedIds: Array<bigint | number | string>
  }>
  useUpsertProposalProcurementScore: () => AsyncMutationResult<{
    proposalId: bigint | number | string
    countryPackKey: string
    scoreKind: string
    scoreValue: number
    maxValue: number
    notes?: string | null
  }>
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProposalWorkspaceProps {
  proposalId: string
  proposalTitle: string
  organizationId: bigint
  companyId: bigint
  initialStatus?: ProposalStatus
  currentUserId?: string
  currentUserName?: string
  onAnalyze: (text: string) => Promise<AIAnalysis>
  /** Shows the bid / no-bid action; the caller passes the user's `proposal:write` permission. */
  canRecordBidDecision?: boolean
  /** Shows the "Convert to project" action; the caller passes the user's `proposal:write` and `project_project:create` permissions. */
  canConvertToProject?: boolean
  /** Enables it: the proposal is Awarded and has no project yet (see `canConvertProposalToProject`). */
  convertToProjectReady?: boolean
  /** Shows the procurement score add / edit actions; the caller passes the user's `proposal:write` permission. */
  canManageProcurementScores?: boolean
  /** Shows the line item move up / down controls; the caller passes the user's `proposal:write` permission. */
  canReorderLineItems?: boolean
  /** Shows "Save as template"; the caller passes the user's `proposal:write` permission. */
  canSaveAsTemplate?: boolean
  hooks: ProposalWorkspaceHooks
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProposalWorkspace({
  proposalId,
  proposalTitle,
  organizationId,
  companyId: _companyId,
  initialStatus = "draft",
  currentUserId,
  currentUserName,
  onAnalyze,
  canRecordBidDecision = false,
  canConvertToProject = false,
  convertToProjectReady = false,
  canManageProcurementScores = false,
  canReorderLineItems = false,
  canSaveAsTemplate = false,
  hooks,
}: ProposalWorkspaceProps) {
  const { t } = useTranslation()
  const effectiveUserName = currentUserName ?? t("proposalWorkspace.you")
  // The proposals list redirect uses a placeholder id (`new-${Date.now()}`) when the reducer
  // returns no id (SpacetimeDB reducers are void). Guard the BigInt conversion so the workspace
  // still renders the title heading from the URL param; use 0n as a sentinel so BigInt-dependent
  // queries return empty results (no proposal has id 0) and the component doesn't crash.
  let proposalIdBig: bigint
  try {
    proposalIdBig = BigInt(proposalId)
  } catch {
    proposalIdBig = 0n
  }

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [activeSectionId, setActiveSectionId] = useState<bigint | null>(null)
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
  const [showDocInput, setShowDocInput] = useState(false)
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [status, setStatus] = useState<ProposalStatus>(initialStatus)
  const [isSaving, setIsSaving] = useState(false)
  const presenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Injected hooks ────────────────────────────────────────────────────────────
  const {
    useProposalSections,
    useProposalSourceDocs,
    useProposalVersions,
    useProposalLineItems,
    useProposalPresence,
    useProposalComments,
    useProducts,
    useUpsertProposalSection,
    useDeleteProposalSection,
    useAddProposalSourceDoc,
    useDeleteProposalSourceDoc,
    useUpdateProposalSourceDoc,
    useSaveProposalVersion,
    useRestoreProposalVersion,
    useUpdateProposalStatus,
    useAddProposalLineItem,
    useUpdateProposalLineItem,
    useDeleteProposalLineItem,
    useUpdateProposalPresence,
    useClearProposalPresence,
    useAddProposalComment,
    useResolveProposalComment,
    useProposalTemplates,
    useProposalComplianceRequirements,
    useApplyProposalTemplate,
    useUpsertProposalComplianceRequirement,
    useCreateProposalIntegrationIntent,
    useRecordProposalBidDecision,
    useConvertProposalToProject,
    useProposalProcurementScores,
    useUpsertProposalProcurementScore,
    useReorderProposalLineItems,
    useCreateProposalTemplate,
  } = hooks

  // ── Data queries ──────────────────────────────────────────────────────────────
  const { data: sections } = useProposalSections(organizationId)
  const { data: sourceDocs } = useProposalSourceDocs(organizationId)
  const { data: versions } = useProposalVersions(organizationId)
  const { data: lineItems } = useProposalLineItems(organizationId, proposalIdBig)
  const { data: presenceRows } = useProposalPresence(organizationId, proposalIdBig)
  const { data: comments } = useProposalComments(organizationId, proposalIdBig)
  const { data: products } = useProducts(organizationId)
  const { data: templates } = useProposalTemplates(organizationId)
  const { data: complianceRows } = useProposalComplianceRequirements(organizationId)
  const { data: procurementScoreRows } = useProposalProcurementScores(organizationId)
  const sectionsList = sections ?? EMPTY_QUERY_ROWS
  const sourceDocsList = sourceDocs ?? EMPTY_QUERY_ROWS
  const versionsList = versions ?? EMPTY_QUERY_ROWS
  const presenceList = presenceRows ?? EMPTY_QUERY_ROWS
  const commentsList = comments ?? EMPTY_QUERY_ROWS
  const productsList = products ?? EMPTY_QUERY_ROWS
  const lineItemsList = lineItems ?? EMPTY_QUERY_ROWS
  const templatesList = templates ?? EMPTY_QUERY_ROWS
  const complianceList = complianceRows ?? EMPTY_QUERY_ROWS
  const procurementScoreList = procurementScoreRows ?? EMPTY_QUERY_ROWS

  // Filter to this proposal (memoized so effect/callback deps stay referentially
  // stable across renders — otherwise fresh arrays each render trigger setState
  // loops, e.g. React error #185 "Maximum update depth exceeded").
  const proposalSections = useMemo(
    () =>
      sectionsList
        .filter((s) => String((s as { proposalId?: unknown }).proposalId) === proposalId)
        .sort((a, b) => ((a as { sequence?: number }).sequence ?? 0) - ((b as { sequence?: number }).sequence ?? 0)),
    [sectionsList, proposalId],
  )

  const proposalSourceDocs = useMemo(
    () => sourceDocsList.filter((d) => String((d as { proposalId?: unknown }).proposalId) === proposalId),
    [sourceDocsList, proposalId],
  )
  const proposalVersions = useMemo(
    () => versionsList.filter((v) => String((v as { proposalId?: unknown }).proposalId) === proposalId),
    [versionsList, proposalId],
  )
  const proposalComments = useMemo(
    () => commentsList.filter((c) => String((c as { proposalId?: unknown }).proposalId) === proposalId),
    [commentsList, proposalId],
  )
  const proposalPresence = useMemo(
    () => presenceList.filter((p) => String((p as { proposalId?: unknown }).proposalId) === proposalId),
    [presenceList, proposalId],
  )
  const proposalCompliance = useMemo(
    () =>
      complianceList.filter(
        (r) =>
          String(
            (r as { proposalId?: unknown }).proposalId ??
              (r as { proposal_id?: unknown }).proposal_id ??
              "",
          ) === proposalId,
      ),
    [complianceList, proposalId],
  )

  const procurementScores = useMemo(
    () => procurementScoresForProposal(procurementScoreList as Record<string, unknown>[], proposalId),
    [procurementScoreList, proposalId],
  )

  const [draftSources, setDraftSources] = useState<SourceDocument[]>([])

  useEffect(() => {
    setDraftSources(proposalSourceDocs.map(mapSourceDocRow))
  }, [proposalSourceDocs])

  // Active section data
  const activeSection = activeSectionId
    ? proposalSections.find((s) => String((s as { id?: unknown }).id) === String(activeSectionId)) ?? null
    : proposalSections[0] ?? null

  const effectiveActiveSectionId = (activeSection as { id?: bigint } | null)?.id ?? null

  // The line items query is org-wide; reorder needs this proposal's complete, ordered set.
  const proposalLineItems = useMemo(
    () => proposalLineItemsInOrder(lineItemsList as Record<string, unknown>[], proposalId),
    [lineItemsList, proposalId],
  )

  const activeSectionLineItems = proposalLineItems.filter(
    (item) => effectiveActiveSectionId && String((item as { sectionId?: unknown }).sectionId) === String(effectiveActiveSectionId)
  )

  const activeSectionComments = proposalComments.filter(
    (c) => effectiveActiveSectionId && String((c as { sectionId?: unknown }).sectionId) === String(effectiveActiveSectionId)
  )

  // Presence by section (for sidebar)
  const presenceBySection = useMemo(() => {
    const map = new Map<string, ProposalPresence[]>()
    const rows = proposalPresence as ProposalPresence[]
    for (const p of rows) {
      const sectionId = p.sectionId
      if (sectionId) {
        const key = String(sectionId)
        const arr = map.get(key) ?? []
        arr.push(p)
        map.set(key, arr)
      }
    }
    return map
  }, [proposalPresence])

  // Total proposal value from all line items
  const totalValue = lineItemsList.reduce((sum: number, item) => {
    const quantity = (item as { quantity?: number }).quantity ?? 1
    const priceUnit = (item as { priceUnit?: number }).priceUnit ?? 0
    const discount = (item as { discount?: number }).discount ?? 0
    return sum + quantity * priceUnit * (1 - discount / 100)
  }, 0)

  // ── Mutations ───────────────────────────────────────────────────────────────
  const upsertSection = useUpsertProposalSection()
  const deleteSection = useDeleteProposalSection()
  const addSourceDoc = useAddProposalSourceDoc()
  const deleteSourceDoc = useDeleteProposalSourceDoc()
  const updateSourceDoc = useUpdateProposalSourceDoc()
  const saveVersion = useSaveProposalVersion()
  const restoreVersion = useRestoreProposalVersion()
  const updateStatus = useUpdateProposalStatus()
  const addLineItem = useAddProposalLineItem()
  const updateLineItem = useUpdateProposalLineItem()
  const deleteLineItem = useDeleteProposalLineItem()
  const updatePresence = useUpdateProposalPresence()
  const clearPresence = useClearProposalPresence()
  const addComment = useAddProposalComment()
  const resolveComment = useResolveProposalComment()
  const applyTemplate = useApplyProposalTemplate()
  const upsertCompliance = useUpsertProposalComplianceRequirement()
  const createIntent = useCreateProposalIntegrationIntent()
  const recordBidDecision = useRecordProposalBidDecision()
  const convertToProject = useConvertProposalToProject()
  const upsertProcurementScore = useUpsertProposalProcurementScore()
  const reorderLineItems = useReorderProposalLineItems()
  const createTemplate = useCreateProposalTemplate()
  const { askForm, formDialog } = useFormDialog()

  // Revision conflict on the active section: the rejected draft is kept ("mine"); the live row is "theirs".
  const [sectionConflict, setSectionConflict] = useState<SectionConflict | null>(null)

  const libraryTemplates = useMemo(
    () =>
      templatesList
        .filter((row) => {
          const company = (row as { companyId?: unknown }).companyId
          return company == null || String(company) === String(_companyId) || _companyId === 0n
        })
        .map((row) => ({
          id: String((row as { id?: unknown }).id),
          name: String((row as { name?: unknown }).name ?? "Template"),
        })),
    [templatesList, _companyId],
  )

  const sourceDispatch = useCallback(
    (action: WorkspaceAction) => {
      switch (action.type) {
        case "ADD_SOURCE":
          addSourceDoc.mutate({
            proposalId: proposalIdBig,
            name: action.source.name,
            content: action.source.content,
            docType: action.source.type,
            wordCount: action.source.wordCount,
          })
          break
        case "REMOVE_SOURCE": {
          const id = action.id
          if (/^\d+$/.test(id)) {
            deleteSourceDoc.mutate({ docId: BigInt(id) })
          }
          break
        }
        case "UPDATE_SOURCE_CONTENT": {
          const id = action.id
          if (/^\d+$/.test(id)) {
            updateSourceDoc.mutate({
              docId: BigInt(id),
              content: action.content,
              wordCount: countWords(action.content),
            })
          }
          break
        }
        default:
          break
      }

      setDraftSources((prev) => {
        switch (action.type) {
          case "ADD_SOURCE":
            return [...prev, action.source]
          case "REMOVE_SOURCE":
            return prev.filter((s) => s.id !== action.id)
          case "UPDATE_SOURCE_CONTENT":
            return prev.map((s) =>
              s.id === action.id
                ? { ...s, content: action.content, wordCount: countWords(action.content) }
                : s,
            )
          default:
            return prev
        }
      })
    },
    [addSourceDoc, deleteSourceDoc, updateSourceDoc, proposalIdBig],
  )

  // ── Presence cleanup on unmount ─────────────────────────────────────────────
  const clearPresenceMutateRef = useRef(clearPresence.mutate)
  clearPresenceMutateRef.current = clearPresence.mutate

  useEffect(() => {
    return () => {
      clearPresenceMutateRef.current(proposalIdBig)
      if (presenceDebounceRef.current) clearTimeout(presenceDebounceRef.current)
    }
  }, [proposalIdBig])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSelectSection = useCallback((id: bigint) => {
    setActiveSectionId(id)
    // Debounced presence update
    if (presenceDebounceRef.current) clearTimeout(presenceDebounceRef.current)
    presenceDebounceRef.current = setTimeout(() => {
      updatePresence.mutate({ proposalId: proposalIdBig, sectionId: id, userName: effectiveUserName })
    }, 500)
  }, [proposalIdBig, effectiveUserName, updatePresence])

  const handleEditorFocus = useCallback(() => {
    if (!effectiveActiveSectionId) return
    if (presenceDebounceRef.current) clearTimeout(presenceDebounceRef.current)
    presenceDebounceRef.current = setTimeout(() => {
      updatePresence.mutate({
        proposalId: proposalIdBig,
        sectionId: effectiveActiveSectionId,
        userName: effectiveUserName,
      })
    }, 500)
  }, [proposalIdBig, effectiveActiveSectionId, effectiveUserName, updatePresence])

  const handleAddSection = useCallback((title: string) => {
    const sequence = proposalSections.length > 0
      ? ((proposalSections[proposalSections.length - 1] as { sequence?: number }).sequence ?? 0) + 10
      : 10
    upsertSection.mutate({
      proposalId: proposalIdBig,
      sectionId: null,
      expectedRevision: 0,
      title,
      content: "",
      status: "empty",
      sequence,
      aiSuggestion: undefined,
    })
  }, [proposalIdBig, proposalSections, upsertSection])

  /** Sends a section save; on a revision conflict keeps the rejected draft instead of dropping it. */
  const saveSectionWithConflictCapture = useCallback(
    (
      sectionId: bigint,
      expectedRevision: number,
      draft: SectionDraft,
      options?: { onSettled?: () => void },
    ) => {
      upsertSection.mutate(
        {
          proposalId: proposalIdBig,
          sectionId,
          expectedRevision,
          title: draft.title,
          content: draft.content,
          status: draft.status,
          sequence: draft.sequence,
          aiSuggestion: draft.aiSuggestion ?? undefined,
        },
        {
          ...options,
          onError: (error) => {
            const revisions = readSectionConflictError(error)
            if (revisions) setSectionConflict({ sectionId: String(sectionId), draft, ...revisions })
          },
        },
      )
    },
    [proposalIdBig, upsertSection],
  )

  const handleSaveContent = useCallback((content: string, sectionStatus: SectionStatus) => {
    if (!effectiveActiveSectionId) return
    if (sectionConflict && String(effectiveActiveSectionId) === sectionConflict.sectionId) {
      // Unresolved conflict: keep the latest edit in the draft rather than sending another stale save.
      setSectionConflict(updateConflictDraft(sectionConflict, { content, status: sectionStatus }))
      return
    }
    setIsSaving(true)
    const wordCount = countWords(content)
    saveSectionWithConflictCapture(
      effectiveActiveSectionId,
      (activeSection as { revision?: number })?.revision ?? 0,
      {
        title: (activeSection as { title?: string })?.title ?? "",
        content,
        status: sectionStatus,
        sequence: (activeSection as { sequence?: number })?.sequence ?? 0,
        aiSuggestion: (activeSection as { aiSuggestion?: string })?.aiSuggestion ?? null,
      },
      { onSettled: () => setIsSaving(false) },
    )
    void wordCount // used server-side
  }, [effectiveActiveSectionId, activeSection, sectionConflict, saveSectionWithConflictCapture])

  const handleSaveTitle = useCallback((title: string) => {
    if (!effectiveActiveSectionId) return
    if (sectionConflict && String(effectiveActiveSectionId) === sectionConflict.sectionId) {
      setSectionConflict(updateConflictDraft(sectionConflict, { title }))
      return
    }
    saveSectionWithConflictCapture(
      effectiveActiveSectionId,
      (activeSection as { revision?: number })?.revision ?? 0,
      {
        title,
        content: (activeSection as { content?: string })?.content ?? "",
        status: ((activeSection as { status?: string })?.status as string)?.toLowerCase() ?? "draft",
        sequence: (activeSection as { sequence?: number })?.sequence ?? 0,
        aiSuggestion: null,
      },
    )
  }, [effectiveActiveSectionId, activeSection, sectionConflict, saveSectionWithConflictCapture])

  const handleApplyStructure = useCallback(() => {
    if (!analysis) return
    const suggested = analysis.suggestedSections.length > 0
      ? analysis.suggestedSections
      : SECTION_TEMPLATES.slice(0, 5).map((t) => t.title)

    suggested.forEach((title, idx) => {
      upsertSection.mutate({
        proposalId: proposalIdBig,
        sectionId: null,
        expectedRevision: 0,
        title,
        content: "",
        status: "empty",
        sequence: (idx + 1) * 10,
        aiSuggestion: analysis.keyFindings[idx]?.excerpt ?? undefined,
      })
    })
  }, [analysis, proposalIdBig, upsertSection])

  const handleAnalyze = useCallback(async () => {
    const combinedText = draftSources.map((d) => d.content).join("\n\n---\n\n")
    if (!combinedText.trim()) return
    setIsAnalyzing(true)
    setAnalyzeError(null)
    try {
      const result = await onAnalyze(combinedText)
      setAnalysis(result)
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : t("proposalWorkspace.analysisFailed"))
    } finally {
      setIsAnalyzing(false)
    }
  }, [draftSources, onAnalyze, t])

  const handleStatusChange = useCallback((newStatus: ProposalStatus) => {
    setStatus(newStatus)
    updateStatus.mutate({ proposalId: proposalIdBig, status: newStatus })
  }, [proposalIdBig, updateStatus])

  const handleRecordBidDecision = useCallback(async () => {
    const title = t("proposalWorkspace.bidDecision.title", { defaultValue: "Record bid decision" })
    const values = await askForm({
      title,
      description: t("proposalWorkspace.bidDecision.description", {
        defaultValue: "A bid decision is required before this proposal can be submitted.",
      }),
      fields: [
        {
          id: "decision",
          name: "decision",
          label: t("proposalWorkspace.bidDecision.decision", { defaultValue: "Decision" }),
          type: "select",
          required: true,
          options: [
            { value: "bid", label: t("proposalWorkspace.bidDecision.bid", { defaultValue: "Bid" }) },
            { value: "no_bid", label: t("proposalWorkspace.bidDecision.noBid", { defaultValue: "No bid" }) },
          ],
        },
        {
          id: "rationale",
          name: "rationale",
          label: t("proposalWorkspace.bidDecision.rationale", { defaultValue: "Rationale" }),
          type: "textarea",
          required: true,
        },
      ],
    })
    if (values == null) return
    const failed = t("proposalWorkspace.bidDecision.failed", { defaultValue: "Record bid decision failed" })
    const input = parseBidDecisionInput(values)
    if (input == null) {
      showWorkflowToast({
        kind: "error",
        title: failed,
        description: t("proposalWorkspace.bidDecision.invalid", {
          defaultValue: "Choose bid or no bid and give a rationale.",
        }),
      })
      return
    }
    try {
      await recordBidDecision.mutateAsync({ proposalId: proposalIdBig, ...input })
      showWorkflowToast({
        kind: "success",
        title: t("proposalWorkspace.bidDecision.done", { defaultValue: "Bid decision recorded" }),
      })
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: failed,
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [askForm, proposalIdBig, recordBidDecision, t])

  const handleConvertToProject = useCallback(async () => {
    const title = t("proposalWorkspace.convertToProject.title", { defaultValue: "Convert to project" })
    const values = await askForm({
      title,
      description: t("proposalWorkspace.convertToProject.description", {
        defaultValue: "Creates a project from this awarded proposal. A proposal can only be converted once.",
      }),
      fields: [
        {
          id: "billType",
          name: "billType",
          label: t("proposalWorkspace.convertToProject.billType", { defaultValue: "Billing" }),
          type: "select",
          required: true,
          defaultValue: "customer_task",
          width: "1/2",
          options: PROJECT_BILL_TYPES.map((value) => ({
            value,
            label: t(`proposalWorkspace.convertToProject.billTypes.${value}`, {
              defaultValue: { customer_task: "Billed by task", customer_project: "Billed by project", no: "Not billable" }[value],
            }),
          })),
        },
        {
          id: "pricingType",
          name: "pricingType",
          label: t("proposalWorkspace.convertToProject.pricingType", { defaultValue: "Pricing" }),
          type: "select",
          required: true,
          defaultValue: "task_rate",
          width: "1/2",
          options: PROJECT_PRICING_TYPES.map((value) => ({
            value,
            label: t(`proposalWorkspace.convertToProject.pricingTypes.${value}`, {
              defaultValue: { task_rate: "Task rate", fixed_rate: "Fixed rate", employee_rate: "Employee rate" }[value],
            }),
          })),
        },
      ],
    })
    if (values == null) return
    const failed = t("proposalWorkspace.convertToProject.failed", { defaultValue: "Convert to project failed" })
    const input = parseProjectConversionInput(values)
    if (input == null) {
      showWorkflowToast({
        kind: "error",
        title: failed,
        description: t("proposalWorkspace.convertToProject.invalid", {
          defaultValue: "Choose a billing type and a pricing type.",
        }),
      })
      return
    }
    try {
      await convertToProject.mutateAsync({ proposalId: proposalIdBig, ...input })
      showWorkflowToast({
        kind: "success",
        title: t("proposalWorkspace.convertToProject.done", { defaultValue: "Project created from proposal" }),
      })
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: failed,
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [askForm, convertToProject, proposalIdBig, t])

  const handleEditProcurementScore = useCallback(
    async (existing?: ProcurementScoreView) => {
      const values = await askForm({
        title: existing
          ? t("proposalWorkspace.procurementScores.editTitle", { defaultValue: "Edit procurement score" })
          : t("proposalWorkspace.procurementScores.addTitle", { defaultValue: "Add procurement score" }),
        description: t("proposalWorkspace.procurementScores.description", {
          defaultValue: "A score is identified by its country pack and score kind; saving an existing pair updates it.",
        }),
        fields: [
          {
            id: "countryPackKey",
            name: "countryPackKey",
            label: t("proposalWorkspace.procurementScores.countryPackKey", { defaultValue: "Country pack key" }),
            type: "text",
            required: true,
            defaultValue: existing?.countryPackKey,
            width: "1/2",
          },
          {
            id: "scoreKind",
            name: "scoreKind",
            label: t("proposalWorkspace.procurementScores.scoreKind", { defaultValue: "Score kind" }),
            type: "text",
            required: true,
            defaultValue: existing?.scoreKind,
            width: "1/2",
          },
          {
            id: "scoreValue",
            name: "scoreValue",
            label: t("proposalWorkspace.procurementScores.scoreValue", { defaultValue: "Score" }),
            type: "number",
            required: true,
            defaultValue: existing?.scoreValue,
            width: "1/2",
          },
          {
            id: "maxValue",
            name: "maxValue",
            label: t("proposalWorkspace.procurementScores.maxValue", { defaultValue: "Maximum" }),
            type: "number",
            required: true,
            defaultValue: existing?.maxValue,
            width: "1/2",
          },
          {
            id: "notes",
            name: "notes",
            label: t("proposalWorkspace.procurementScores.notes", { defaultValue: "Notes" }),
            type: "textarea",
            defaultValue: existing?.notes,
          },
        ],
      })
      if (values == null) return
      const failed = t("proposalWorkspace.procurementScores.failed", { defaultValue: "Save procurement score failed" })
      const parsed = parseProcurementScoreInput(values)
      if (!parsed.ok) {
        showWorkflowToast({
          kind: "error",
          title: failed,
          description:
            parsed.reason === "required"
              ? t("proposalWorkspace.procurementScores.invalidKeys", {
                  defaultValue: "Country pack key and score kind are required.",
                })
              : t("proposalWorkspace.procurementScores.invalidNumbers", {
                  defaultValue: "Score and maximum must be numbers.",
                }),
        })
        return
      }
      try {
        await upsertProcurementScore.mutateAsync({ proposalId: proposalIdBig, ...parsed.value })
        showWorkflowToast({
          kind: "success",
          title: t("proposalWorkspace.procurementScores.done", { defaultValue: "Procurement score saved" }),
        })
      } catch (error) {
        showWorkflowToast({
          kind: "error",
          title: failed,
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [askForm, proposalIdBig, upsertProcurementScore, t],
  )

  const handleSaveAsTemplate = useCallback(async () => {
    const values = await askForm({
      title: t("proposalWorkspace.saveAsTemplate.title", { defaultValue: "Save as template" }),
      description: t("proposalWorkspace.saveAsTemplate.description", {
        defaultValue: "Saves this proposal's sections (titles and content) to the template library.",
      }),
      fields: [
        {
          id: "name",
          name: "name",
          label: t("proposalWorkspace.saveAsTemplate.name", { defaultValue: "Template name" }),
          type: "text",
          required: true,
          defaultValue: proposalTitle,
        },
        {
          id: "category",
          name: "category",
          label: t("proposalWorkspace.saveAsTemplate.category", { defaultValue: "Category" }),
          type: "text",
          required: true,
          defaultValue: DEFAULT_TEMPLATE_CATEGORY,
          width: "1/2",
        },
        {
          id: "locale",
          name: "locale",
          label: t("proposalWorkspace.saveAsTemplate.locale", { defaultValue: "Locale" }),
          type: "text",
          required: true,
          defaultValue: DEFAULT_TEMPLATE_LOCALE,
          width: "1/2",
        },
        {
          id: "countryPackKey",
          name: "countryPackKey",
          label: t("proposalWorkspace.saveAsTemplate.countryPackKey", { defaultValue: "Country pack key (optional)" }),
          type: "text",
        },
      ],
    })
    if (values == null) return
    const failed = t("proposalWorkspace.saveAsTemplate.failed", { defaultValue: "Save as template failed" })
    const parsed = parseSectionTemplateInput(values, proposalSections as Record<string, unknown>[])
    if (!parsed.ok) {
      showWorkflowToast({
        kind: "error",
        title: failed,
        description:
          parsed.reason === "sections"
            ? t("proposalWorkspace.saveAsTemplate.noSections", { defaultValue: "Add at least one section first." })
            : t("proposalWorkspace.saveAsTemplate.invalid", {
                defaultValue: "Template name, category and locale are required.",
              }),
      })
      return
    }
    try {
      await createTemplate.mutateAsync(parsed.value)
      showWorkflowToast({
        kind: "success",
        title: t("proposalWorkspace.saveAsTemplate.done", { defaultValue: "Template saved" }),
      })
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: failed,
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [askForm, createTemplate, proposalSections, proposalTitle, t])

  const handleMoveLineItem = useCallback(
    async (id: bigint, direction: LineItemMoveDirection) => {
      const orderedIds = moveLineItemOrder(
        proposalLineItems,
        activeSectionLineItems.map((item) => String((item as { id?: unknown }).id)),
        String(id),
        direction,
      )
      if (orderedIds == null) return
      try {
        await reorderLineItems.mutateAsync({ proposalId: proposalIdBig, orderedIds })
      } catch (error) {
        showWorkflowToast({
          kind: "error",
          title: t("proposalWorkspace.reorderLineItems.failed", { defaultValue: "Reorder line items failed" }),
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [activeSectionLineItems, proposalIdBig, proposalLineItems, reorderLineItems, t],
  )

  const handleSaveVersion = useCallback((message: string) => {
    saveVersion.mutate({ proposalId: proposalIdBig, message })
  }, [proposalIdBig, saveVersion])

  const handleRestoreVersion = useCallback((versionId: string) => {
    restoreVersion.mutate({ proposalId: proposalIdBig, versionId })
  }, [proposalIdBig, restoreVersion])

  const handleExportMarkdown = () => {
    const md = proposalSections.map((s) => `## ${(s as { title?: string }).title}\n\n${(s as { content?: string }).content}`).join("\n\n---\n\n")
    const blob = new Blob([`# ${proposalTitle}\n\n${md}`], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url
    a.download = `${proposalTitle.replace(/\s+/g, "-").toLowerCase()}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportText = () => {
    const text = proposalSections
      .map((s) => `${(s as { title?: string }).title?.toUpperCase()}\n${"=".repeat((s as { title?: string }).title?.length ?? 0)}\n\n${(s as { content?: string }).content}`)
      .join("\n\n\n")
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url
    a.download = `${proposalTitle.replace(/\s+/g, "-").toLowerCase()}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleRequestPdf = useCallback(() => {
    const latestVersion = proposalVersions[0] as { id?: unknown } | undefined
    createIntent.mutate({
      proposalId: proposalIdBig,
      proposalVersionId: latestVersion?.id != null ? String(latestVersion.id) : null,
      intentType: "pdf_render",
      idempotencyKey: `pdf-${proposalId}-${Date.now()}`,
      payload: JSON.stringify({ format: "a4", title: proposalTitle }),
    })
  }, [createIntent, proposalId, proposalIdBig, proposalTitle, proposalVersions])

  const handleToggleCompliance = useCallback(
    (row: Record<string, unknown>, complete: boolean) => {
      upsertCompliance.mutate({
        proposalId: proposalIdBig,
        requirementId: row.id != null ? String(row.id) : null,
        requirementKey: rowString(rowField(row, "requirementKey", "requirement_key")),
        title: rowString(row.title),
        description: (rowField(row, "description", "description") as string | null | undefined) ?? null,
        isRequired: rowBool(rowField(row, "isRequired", "is_required"), true),
        isComplete: complete,
        isWaived: rowBool(rowField(row, "isWaived", "is_waived")),
        waiverRationale:
          (rowField(row, "waiverRationale", "waiver_rationale") as string | null | undefined) ?? null,
        evidenceDocumentId:
          (rowField(row, "evidenceDocumentId", "evidence_document_id") as string | null | undefined) ??
          null,
        sequence: rowNumber(row.sequence),
      })
    },
    [proposalIdBig, upsertCompliance],
  )

  // Convert STDB versions to local version format for VersionHistoryBar
  const localVersions = proposalVersions.map((v) => {
    let parsedSections: TenderSection[] = []
    try {
      const raw = JSON.parse((v as { sectionsJson?: string }).sectionsJson ?? "[]")
      if (Array.isArray(raw)) {
        parsedSections = raw
      } else if (raw && typeof raw === "object" && Array.isArray(raw.sections)) {
        parsedSections = raw.sections
      }
    } catch { /* ignore */ }
    return {
      id: String((v as { id?: unknown }).id),
      versionNumber: (v as { versionNumber?: number }).versionNumber ?? 0,
      message: (v as { message?: string }).message ?? "",
      author: String((v as { authorId?: unknown }).authorId ?? ""),
      createdAt: new Date(Number((v as { createDate?: number }).createDate ?? 0) / 1000),
      sections: parsedSections,
      diff: null,
    }
  })

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body > *:not(#proposal-print-root) { display: none !important; }
          #proposal-print-root { display: block !important; padding: 2cm; font-family: Georgia, serif; }
          #proposal-print-root h1 { font-size: 24pt; margin-bottom: 12pt; }
          #proposal-print-root h2 { font-size: 16pt; margin-top: 20pt; margin-bottom: 8pt; border-bottom: 1pt solid #ccc; }
          #proposal-print-root p { font-size: 11pt; line-height: 1.6; margin-bottom: 8pt; }
          .no-print { display: none !important; }
        }
      `}</style>

      {formDialog}

      {/* Hidden print target */}
      <div id="proposal-print-root" className="hidden print:block">
        <h1>{proposalTitle}</h1>
        {proposalSections.map((s) => (
          <div key={String((s as { id?: unknown }).id)}>
            <h2>{(s as { title?: string }).title}</h2>
            {String((s as { content?: string }).content ?? "").split("\n").map((line, i) => <p key={i}>{line}</p>)}
          </div>
        ))}
      </div>

      <div className="flex flex-col h-full bg-background no-print">
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background shrink-0 z-10">
          <Link href="/proposals" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <h1 data-testid="proposal-workspace-title" className="text-sm font-medium text-foreground truncate">{proposalTitle}</h1>

          <div className="ml-auto flex items-center gap-2">
            <PresenceBar
              presenceRows={proposalPresence as ProposalPresence[]}
              sections={proposalSections as Record<string, unknown>[]}
              currentUserId={currentUserId}
            />

            <Badge variant={STATUS_VARIANT[status]} className="capitalize text-xs">
              {status}
            </Badge>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleExportMarkdown} title={t("proposalWorkspace.exportMarkdown")}>
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportText} title={t("proposalWorkspace.exportText")}>
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRequestPdf}
                title={t("proposalWorkspace.requestPdf", { defaultValue: "Queue PDF render" })}
              >
                PDF
              </Button>
              <SaveVersionButton
                onSave={handleSaveVersion}
                isDirty={proposalSections.length > 0}
                versionCount={localVersions.length}
              />
            </div>

            {canRecordBidDecision ? (
              <Button
                variant="outline"
                size="sm"
                disabled={recordBidDecision.isPending || proposalIdBig === 0n}
                data-testid="proposal-bid-decision"
                onClick={() => void handleRecordBidDecision()}
              >
                {t("proposalWorkspace.bidDecision.button", { defaultValue: "Bid / no bid" })}
              </Button>
            ) : null}

            {canConvertToProject ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!convertToProjectReady || convertToProject.isPending || proposalIdBig === 0n}
                title={
                  convertToProjectReady
                    ? undefined
                    : t("proposalWorkspace.convertToProject.unavailable", {
                        defaultValue: "Only an awarded proposal without a project can be converted.",
                      })
                }
                data-testid="proposal-convert-to-project"
                onClick={() => void handleConvertToProject()}
              >
                {t("proposalWorkspace.convertToProject.button", { defaultValue: "Convert to project" })}
              </Button>
            ) : null}

            {canSaveAsTemplate ? (
              <Button
                variant="outline"
                size="sm"
                disabled={createTemplate.isPending || proposalSections.length === 0}
                data-testid="proposal-save-as-template"
                onClick={() => void handleSaveAsTemplate()}
              >
                {t("proposalWorkspace.saveAsTemplate.button", { defaultValue: "Save as template" })}
              </Button>
            ) : null}

            <div className="relative group">
              <Button variant="outline" size="sm" className="gap-1">
                {t("proposalWorkspace.status.label")}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                {getStatusOptions(t).map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground first:rounded-t last:rounded-b",
                      status === opt.value && "bg-accent"
                    )}
                    onClick={() => handleStatusChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Button variant="default" size="sm" onClick={() => setAiPanelCollapsed((v) => !v)}>
              {aiPanelCollapsed ? t("proposalWorkspace.showAiPanel") : t("proposalWorkspace.hideAiPanel")}
            </Button>
          </div>
        </header>

        {/* ── Main workspace ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          <SectionSidebar
            sections={proposalSections as Record<string, unknown>[]}
            sourceDocs={proposalSourceDocs as ProposalSourceDoc[]}
            activeSectionId={effectiveActiveSectionId}
            presenceBySection={presenceBySection}
            totalValue={totalValue}
            libraryTemplates={libraryTemplates}
            onSelectSection={handleSelectSection}
            onAddSection={handleAddSection}
            onApplyLibraryTemplate={(templateId) =>
              applyTemplate.mutate({ proposalId: proposalIdBig, templateId })
            }
            onDeleteSection={(id) => deleteSection.mutate({ sectionId: id })}
            onAddSourceDoc={() => setShowDocInput(true)}
            onDeleteSourceDoc={(id) => deleteSourceDoc.mutate({ docId: id })}
            complianceSlot={
              <>
                <ComplianceChecklist
                  rows={proposalCompliance as Record<string, unknown>[]}
                  proposalId={proposalIdBig}
                  onToggleComplete={handleToggleCompliance}
                />
                <ProcurementScoresPanel
                  scores={procurementScores}
                  canEdit={canManageProcurementScores}
                  disabled={upsertProcurementScore.isPending || proposalIdBig === 0n}
                  onAdd={() => void handleEditProcurementScore()}
                  onEdit={(score) => void handleEditProcurementScore(score)}
                />
              </>
            }
          />

          <div className="flex-1 flex overflow-hidden">
            <SectionEditor
              section={activeSection as unknown as TenderSection | null}
              lineItems={activeSectionLineItems as unknown as { id: string; productName: string; quantity: number; priceUnit: number; discount: number; subtotal: number }[]}
              comments={activeSectionComments as unknown as { id: string; authorName: string; content: string; isResolved: boolean; parentId: string | null }[]}
              products={productsList as unknown as { id: string; name: string; listPrice: number }[]}
              isSaving={isSaving}
              onSaveContent={handleSaveContent}
              onSaveTitle={handleSaveTitle}
              onFocus={handleEditorFocus}
              onAddLineItem={(productId, productName, priceUnit) =>
                addLineItem.mutate({
                  proposalId: proposalIdBig,
                  sectionId: effectiveActiveSectionId,
                  productId,
                  productName,
                  quantity: 1,
                  priceUnit,
                  discount: 0,
                  notes: null,
                })
              }
              onUpdateLineItem={(id, quantity, priceUnit, discount, notes) =>
                updateLineItem.mutate({
                  lineItemId: id,
                  quantity,
                  priceUnit,
                  discount,
                  notes: notes ?? null,
                })
              }
              onDeleteLineItem={(id) => deleteLineItem.mutate({ lineItemId: id })}
              onMoveLineItem={canReorderLineItems ? (id, direction) => void handleMoveLineItem(id, direction) : undefined}
              isReorderingLineItems={reorderLineItems.isPending || proposalIdBig === 0n}
              onAddComment={(content) => {
                if (!effectiveActiveSectionId) return
                addComment.mutate({
                  proposalId: proposalIdBig,
                  sectionId: effectiveActiveSectionId,
                  content,
                  authorName: effectiveUserName,
                  parentId: null,
                })
              }}
              onResolveComment={(id) => resolveComment.mutate(id)}
            />

            {aiPanelCollapsed ? null : (
              <div className="w-80 border-l border-border bg-muted/20 flex flex-col">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium">{t("proposalWorkspace.aiPanel.aiAnalysis")}</span>
                  <Button variant="ghost" size="sm" onClick={() => setAiPanelCollapsed(true)}>✕</Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => setShowDocInput((v) => !v)}
                    >
                      <Upload className="h-4 w-4" />
                      {showDocInput ? t("proposalWorkspace.hideSourceDocs") : t("proposalWorkspace.sourceDocs")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleAnalyze}
                      disabled={isAnalyzing || proposalSourceDocs.length === 0}
                    >
                      {isAnalyzing ? t("proposalWorkspace.analyzing") : t("proposalWorkspace.analyze")}
                    </Button>
                  </div>

                  {showDocInput && (
                    <DocumentInputPanel
                      sources={draftSources}
                      dispatch={sourceDispatch}
                      onAnalyze={handleAnalyze}
                      isAnalyzing={isAnalyzing}
                    />
                  )}

                  {analyzeError && (
                    <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                      {analyzeError}
                    </div>
                  )}

                  <AIPanel
                    analysis={analysis}
                    isAnalyzing={isAnalyzing}
                    analyzeError={analyzeError}
                    onApplyStructure={handleApplyStructure}
                    collapsed={false}
                    onToggleCollapse={() => setAiPanelCollapsed(true)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Version history (right sidebar) ───────────────────────────── */}
          <div className="w-64 border-l border-border bg-muted/10 flex flex-col">
            <VersionHistoryBar
              versions={localVersions}
              activeVersionId={null}
              currentSections={proposalSections as unknown as TenderSection[]}
              onRestoreVersion={handleRestoreVersion}
            />
          </div>
        </div>
      </div>
    </>
  )
}
