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
import { rowNumber, rowString } from "./row-field-utils"

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
  mutate: (params: T, options?: { onSettled?: () => void }) => void
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
  }>
  useSaveProposalVersion: () => MutationResult<{
    proposalId: bigint | number | string
    message: string
    sectionsJson: string
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
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProposalWorkspaceProps {
  proposalId: string
  proposalTitle: string
  organizationId: bigint
  initialStatus?: ProposalStatus
  currentUserId?: string
  currentUserName?: string
  onAnalyze: (text: string) => Promise<AIAnalysis>
  hooks: ProposalWorkspaceHooks
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProposalWorkspace({
  proposalId,
  proposalTitle,
  organizationId,
  initialStatus = "draft",
  currentUserId,
  currentUserName,
  onAnalyze,
  hooks,
}: ProposalWorkspaceProps) {
  const { t } = useTranslation()
  const effectiveUserName = currentUserName ?? t("proposalWorkspace.you")
  const proposalIdBig = BigInt(proposalId)

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
    useUpdateProposalStatus,
    useAddProposalLineItem,
    useUpdateProposalLineItem,
    useDeleteProposalLineItem,
    useUpdateProposalPresence,
    useClearProposalPresence,
    useAddProposalComment,
    useResolveProposalComment,
  } = hooks

  // ── Data queries ──────────────────────────────────────────────────────────────
  const { data: sections = [] } = useProposalSections(organizationId)
  const { data: sourceDocs = [] } = useProposalSourceDocs(organizationId)
  const { data: versions = [] } = useProposalVersions(organizationId)
  const { data: lineItems = [] } = useProposalLineItems(organizationId, proposalIdBig)
  const { data: presenceRows = [] } = useProposalPresence(organizationId, proposalIdBig)
  const { data: comments = [] } = useProposalComments(organizationId, proposalIdBig)
  const { data: products = [] } = useProducts(organizationId)

  // Filter to this proposal
  const proposalSections = sections
    .filter((s) => String((s as { proposalId?: unknown }).proposalId) === proposalId)
    .sort((a, b) => ((a as { sequence?: number }).sequence ?? 0) - ((b as { sequence?: number }).sequence ?? 0))

  const proposalSourceDocs = sourceDocs.filter((d) => String((d as { proposalId?: unknown }).proposalId) === proposalId)
  const proposalVersions = versions.filter((v) => String((v as { proposalId?: unknown }).proposalId) === proposalId)
  const proposalComments = comments.filter((c) => String((c as { proposalId?: unknown }).proposalId) === proposalId)
  const proposalPresence = presenceRows.filter((p) => String((p as { proposalId?: unknown }).proposalId) === proposalId)

  const [draftSources, setDraftSources] = useState<SourceDocument[]>([])

  useEffect(() => {
    setDraftSources(proposalSourceDocs.map(mapSourceDocRow))
  }, [proposalSourceDocs])

  // Active section data
  const activeSection = activeSectionId
    ? proposalSections.find((s) => String((s as { id?: unknown }).id) === String(activeSectionId)) ?? null
    : proposalSections[0] ?? null

  const effectiveActiveSectionId = (activeSection as { id?: bigint } | null)?.id ?? null

  const activeSectionLineItems = lineItems.filter(
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
  const totalValue = lineItems.reduce((sum: number, item) => {
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
  const updateStatus = useUpdateProposalStatus()
  const addLineItem = useAddProposalLineItem()
  const updateLineItem = useUpdateProposalLineItem()
  const deleteLineItem = useDeleteProposalLineItem()
  const updatePresence = useUpdateProposalPresence()
  const clearPresence = useClearProposalPresence()
  const addComment = useAddProposalComment()
  const resolveComment = useResolveProposalComment()

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
  useEffect(() => {
    return () => {
      clearPresence.mutate(proposalIdBig)
      if (presenceDebounceRef.current) clearTimeout(presenceDebounceRef.current)
    }
     
  }, [proposalId, clearPresence.mutate])

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
      title,
      content: "",
      status: "empty",
      sequence,
      aiSuggestion: undefined,
    })
  }, [proposalIdBig, proposalSections, upsertSection])

  const handleSaveContent = useCallback((content: string, sectionStatus: SectionStatus) => {
    if (!effectiveActiveSectionId) return
    setIsSaving(true)
    const wordCount = countWords(content)
    upsertSection.mutate(
      {
        proposalId: proposalIdBig,
        sectionId: effectiveActiveSectionId,
        title: (activeSection as { title?: string })?.title ?? "",
        content,
        status: sectionStatus,
        sequence: (activeSection as { sequence?: number })?.sequence ?? 0,
        aiSuggestion: (activeSection as { aiSuggestion?: string })?.aiSuggestion ?? undefined,
      },
      { onSettled: () => setIsSaving(false) }
    )
    void wordCount // used server-side
  }, [proposalIdBig, effectiveActiveSectionId, activeSection, upsertSection])

  const handleSaveTitle = useCallback((title: string) => {
    if (!effectiveActiveSectionId) return
    upsertSection.mutate({
      proposalId: proposalIdBig,
      sectionId: effectiveActiveSectionId,
      title,
      content: (activeSection as { content?: string })?.content ?? "",
      status: ((activeSection as { status?: string })?.status as string)?.toLowerCase() ?? "draft",
      sequence: (activeSection as { sequence?: number })?.sequence ?? 0,
    })
  }, [proposalIdBig, effectiveActiveSectionId, activeSection, upsertSection])

  const handleApplyStructure = useCallback(() => {
    if (!analysis) return
    const suggested = analysis.suggestedSections.length > 0
      ? analysis.suggestedSections
      : SECTION_TEMPLATES.slice(0, 5).map((t) => t.title)

    suggested.forEach((title, idx) => {
      upsertSection.mutate({
        proposalId: proposalIdBig,
        sectionId: null,
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

  const handleSaveVersion = useCallback((message: string) => {
    const sectionsJson = JSON.stringify(
      proposalSections.map((s) => ({
        id: String((s as { id?: unknown }).id),
        title: (s as { title?: string }).title,
        content: (s as { content?: string }).content,
        status: (s as { status?: string }).status,
        sequence: (s as { sequence?: number }).sequence,
        wordCount: (s as { wordCount?: number }).wordCount,
      }))
    )
    saveVersion.mutate({ proposalId: proposalIdBig, message, sectionsJson })
  }, [proposalIdBig, proposalSections, saveVersion])

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

  // Convert STDB versions to local version format for VersionHistoryBar
  const localVersions = proposalVersions.map((v) => {
    let parsedSections: TenderSection[] = []
    try { parsedSections = JSON.parse((v as { sectionsJson?: string }).sectionsJson ?? "[]") } catch { /* ignore */ }
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

          <h1 className="text-sm font-medium text-foreground truncate">{proposalTitle}</h1>

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
              <SaveVersionButton
                onSave={handleSaveVersion}
                isDirty={proposalSections.length > 0}
                versionCount={localVersions.length}
              />
            </div>

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
            onSelectSection={handleSelectSection}
            onAddSection={handleAddSection}
            onDeleteSection={(id) => deleteSection.mutate({ sectionId: id })}
            onAddSourceDoc={() => setShowDocInput(true)}
            onDeleteSourceDoc={(id) => deleteSourceDoc.mutate({ docId: id })}
          />

          <div className="flex-1 flex overflow-hidden">
            <SectionEditor
              section={activeSection as unknown as TenderSection | null}
              lineItems={activeSectionLineItems as unknown as { id: string; productName: string; quantity: number; priceUnit: number; discount: number; subtotal: number }[]}
              comments={activeSectionComments as unknown as { id: string; authorName: string; content: string; isResolved: boolean; parentId: string | null }[]}
              products={products as unknown as { id: string; name: string; listPrice: number }[]}
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
            />
          </div>
        </div>
      </div>
    </>
  )
}
