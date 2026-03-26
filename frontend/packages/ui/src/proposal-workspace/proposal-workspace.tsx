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
} from "@/lib/proposal-workspace-types"
import { SECTION_TEMPLATES } from "@/lib/proposal-workspace-types"
import {
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
  useSaveProposalVersion,
  useUpdateProposalStatus,
  useAddProposalLineItem,
  useUpdateProposalLineItem,
  useDeleteProposalLineItem,
  useUpdateProposalPresence,
  useClearProposalPresence,
  useAddProposalComment,
  useResolveProposalComment,
} from "@lumiere/stdb"
import { SectionSidebar } from "./section-sidebar"
import { SectionEditor } from "./section-editor"
import { AIPanel } from "./ai-panel"
import { VersionHistoryBar, SaveVersionButton } from "./version-history-bar"
import { PresenceBar } from "./presence-bar"
import { DocumentInputPanel } from "./document-input-panel"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length
}

// Keep diff utilities for version history
function simpleLineDiff(
  oldLines: string[],
  newLines: string[]
): import("@/lib/proposal-workspace-types").VersionLine[] {
  const result: import("@/lib/proposal-workspace-types").VersionLine[] = []
  const m = oldLines.length, n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProposalWorkspaceProps {
  proposalId: string
  proposalTitle: string
  organizationId: bigint
  initialStatus?: ProposalStatus
  currentUserId?: string
  currentUserName?: string
  onAnalyze: (text: string) => Promise<AIAnalysis>
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

  // ── STDB data ───────────────────────────────────────────────────────────────
  const { data: sections = [] } = useProposalSections(organizationId)
  const { data: sourceDocs = [] } = useProposalSourceDocs(organizationId)
  const { data: versions = [] } = useProposalVersions(organizationId)
  const { data: lineItems = [] } = useProposalLineItems(organizationId, proposalIdBig)
  const { data: presenceRows = [] } = useProposalPresence(organizationId, proposalIdBig)
  const { data: comments = [] } = useProposalComments(organizationId, proposalIdBig)
  const { data: products = [] } = useProducts(organizationId)

  // Filter to this proposal
  const proposalSections = sections
    .filter((s) => String(s.proposalId) === proposalId)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))

  const proposalSourceDocs = sourceDocs.filter((d) => String(d.proposalId) === proposalId)
  const proposalVersions = versions.filter((v) => String(v.proposalId) === proposalId)
  const proposalComments = comments.filter((c) => String(c.proposalId) === proposalId)
  const proposalPresence = presenceRows.filter((p) => String(p.proposalId) === proposalId)

  // Active section data
  const activeSection = activeSectionId
    ? proposalSections.find((s) => s.id === activeSectionId) ?? null
    : proposalSections[0] ?? null

  const effectiveActiveSectionId = activeSection?.id ?? null

  const activeSectionLineItems = lineItems.filter(
    (item) => effectiveActiveSectionId && String(item.sectionId) === String(effectiveActiveSectionId)
  )

  const activeSectionComments = proposalComments.filter(
    (c) => effectiveActiveSectionId && String(c.sectionId) === String(effectiveActiveSectionId)
  )

  // Presence by section (for sidebar)
  const presenceBySection = useMemo(() => {
    const map = new Map<string, typeof proposalPresence>()
    for (const p of proposalPresence) {
      if (p.sectionId) {
        const key = String(p.sectionId)
        const arr = map.get(key) ?? []
        arr.push(p)
        map.set(key, arr)
      }
    }
    return map
  }, [proposalPresence])

  // Total proposal value from all line items
  const totalValue = lineItems.reduce((sum, item) => {
    return sum + (item.quantity ?? 1) * (item.priceUnit ?? 0) * (1 - (item.discount ?? 0) / 100)
  }, 0)

  // ── Mutations ───────────────────────────────────────────────────────────────
  const upsertSection = useUpsertProposalSection()
  const deleteSection = useDeleteProposalSection()
  const addSourceDoc = useAddProposalSourceDoc()
  const deleteSourceDoc = useDeleteProposalSourceDoc()
  const saveVersion = useSaveProposalVersion()
  const updateStatus = useUpdateProposalStatus()
  const addLineItem = useAddProposalLineItem()
  const updateLineItem = useUpdateProposalLineItem()
  const deleteLineItem = useDeleteProposalLineItem()
  const updatePresence = useUpdateProposalPresence()
  const clearPresence = useClearProposalPresence()
  const addComment = useAddProposalComment()
  const resolveComment = useResolveProposalComment()

  // ── Presence cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearPresence.mutate(proposalIdBig)
      if (presenceDebounceRef.current) clearTimeout(presenceDebounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        sectionId: BigInt(String(effectiveActiveSectionId)),
        userName: effectiveUserName,
      })
    }, 500)
  }, [proposalIdBig, effectiveActiveSectionId, effectiveUserName, updatePresence])

  const handleAddSection = useCallback((title: string) => {
    const sequence = proposalSections.length > 0
      ? (proposalSections[proposalSections.length - 1].sequence ?? 0) + 10
      : 10
    upsertSection.mutate({
      proposalId: proposalIdBig,
      sectionId: BigInt(0),
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
        sectionId: BigInt(String(effectiveActiveSectionId)),
        title: activeSection?.title ?? "",
        content,
        status: sectionStatus,
        sequence: activeSection?.sequence ?? 0,
        aiSuggestion: activeSection?.aiSuggestion ?? undefined,
      },
      { onSettled: () => setIsSaving(false) }
    )
    void wordCount // used server-side
  }, [proposalIdBig, effectiveActiveSectionId, activeSection, upsertSection])

  const handleSaveTitle = useCallback((title: string) => {
    if (!effectiveActiveSectionId) return
    upsertSection.mutate({
      proposalId: proposalIdBig,
      sectionId: BigInt(String(effectiveActiveSectionId)),
      title,
      content: activeSection?.content ?? "",
      status: (activeSection?.status as string)?.toLowerCase() ?? "draft",
      sequence: activeSection?.sequence ?? 0,
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
        sectionId: BigInt(0),
        title,
        content: "",
        status: "empty",
        sequence: (idx + 1) * 10,
        aiSuggestion: analysis.keyFindings[idx]?.excerpt ?? undefined,
      })
    })
  }, [analysis, proposalIdBig, upsertSection])

  const handleAnalyze = useCallback(async () => {
    const combinedText = proposalSourceDocs.map((d) => d.content).join("\n\n---\n\n")
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
  }, [proposalSourceDocs, onAnalyze])

  const handleStatusChange = useCallback((newStatus: ProposalStatus) => {
    setStatus(newStatus)
    updateStatus.mutate({ proposalId: proposalIdBig, status: newStatus })
  }, [proposalIdBig, updateStatus])

  const handleSaveVersion = useCallback((message: string) => {
    const sectionsJson = JSON.stringify(
      proposalSections.map((s) => ({
        id: String(s.id),
        title: s.title,
        content: s.content,
        status: s.status,
        sequence: s.sequence,
        wordCount: s.wordCount,
      }))
    )
    saveVersion.mutate({ proposalId: proposalIdBig, message, sectionsJson })
  }, [proposalIdBig, proposalSections, saveVersion])

  const handleExportMarkdown = () => {
    const md = proposalSections.map((s) => `## ${s.title}\n\n${s.content}`).join("\n\n---\n\n")
    const blob = new Blob([`# ${proposalTitle}\n\n${md}`], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url
    a.download = `${proposalTitle.replace(/\s+/g, "-").toLowerCase()}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportText = () => {
    const text = proposalSections
      .map((s) => `${s.title.toUpperCase()}\n${"=".repeat(s.title.length)}\n\n${s.content}`)
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
    try { parsedSections = JSON.parse(v.sectionsJson ?? "[]") } catch { /* ignore */ }
    return {
      id: String(v.id),
      versionNumber: v.versionNumber ?? 0,
      message: v.message ?? "",
      author: String(v.authorId ?? ""),
      createdAt: new Date(Number(v.createDate ?? 0) / 1000),
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
          <div key={String(s.id)}>
            <h2>{s.title}</h2>
            {String(s.content ?? "").split("\n").map((line, i) => <p key={i}>{line}</p>)}
          </div>
        ))}
      </div>

      <div className="flex flex-col h-full bg-background no-print">
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background shrink-0 z-10">
          <Link href="/proposals" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">{proposalTitle}</h1>
          </div>

          {/* Presence avatars */}
          <PresenceBar
            presenceRows={proposalPresence}
            sections={proposalSections}
            currentUserId={currentUserId}
          />

          {/* Status selector */}
          <div className="relative group">
            <button className="flex items-center gap-1.5">
              <Badge variant={STATUS_VARIANT[status]} className="text-xs cursor-pointer">
                {getStatusOptions(t).find((o) => o.value === status)?.label ?? status}
              </Badge>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>

            <div className="absolute top-full right-0 mt-1 z-20 rounded-lg border border-border bg-popover shadow-lg hidden group-hover:block min-w-[130px]">
              {getStatusOptions(t).map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
                    status === opt.value && "font-semibold text-primary"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Save version */}
          <SaveVersionButton
            onSave={handleSaveVersion}
            isDirty={true}
            versionCount={localVersions.length}
          />

          {/* Export menu */}
          <div className="relative group">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              {t("proposalWorkspace.export")}
              <ChevronDown className="h-3 w-3" />
            </Button>
            <div className="absolute top-full right-0 mt-1 z-20 rounded-lg border border-border bg-popover shadow-lg hidden group-hover:block min-w-[160px]">
              <button type="button" onClick={() => window.print()} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors">{t("proposalWorkspace.exportPdf")}</button>
              <button type="button" onClick={handleExportMarkdown} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors">{t("proposalWorkspace.exportMarkdown")}</button>
              <button type="button" onClick={handleExportText} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors">{t("proposalWorkspace.exportText")}</button>
            </div>
          </div>
        </header>

        {/* ── Main workspace ──────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Section sidebar (w-56) */}
          <div className="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
            <SectionSidebar
              sections={proposalSections}
              sourceDocs={proposalSourceDocs}
              activeSectionId={effectiveActiveSectionId}
              presenceBySection={presenceBySection}
              totalValue={totalValue}
              onSelectSection={handleSelectSection}
              onAddSection={handleAddSection}
              onDeleteSection={(id) => deleteSection.mutate(id)}
              onAddSourceDoc={() => setShowDocInput(true)}
              onDeleteSourceDoc={(id) => deleteSourceDoc.mutate(id)}
            />
          </div>

          {/* Middle: Section editor (flex-1) */}
          <SectionEditor
            section={activeSection}
            lineItems={activeSectionLineItems}
            comments={activeSectionComments}
            products={products}
            currentUserId={currentUserId}
            isSaving={isSaving}
            onSaveContent={handleSaveContent}
            onSaveTitle={handleSaveTitle}
            onAddLineItem={(productId, productName, priceUnit) => {
              addLineItem.mutate({
                proposalId: proposalIdBig,
                sectionId: effectiveActiveSectionId ? BigInt(String(effectiveActiveSectionId)) : undefined,
                productId,
                productName,
                quantity: 1,
                priceUnit,
                discount: 0,
              })
            }}
            onUpdateLineItem={(id, quantity, priceUnit, discount, notes) => {
              updateLineItem.mutate({ lineItemId: id, quantity, priceUnit, discount, notes })
            }}
            onDeleteLineItem={(id) => deleteLineItem.mutate(id)}
            onAddComment={(content, parentId) => {
              if (!effectiveActiveSectionId) return
              addComment.mutate({
                proposalId: proposalIdBig,
                sectionId: BigInt(String(effectiveActiveSectionId)),
                content,
                parentId,
                authorName: effectiveUserName,
              })
            }}
            onResolveComment={(id) => resolveComment.mutate(id)}
            onFocus={handleEditorFocus}
          />

          {/* Right: AI panel (collapsible) */}
          <AIPanel
            analysis={analysis}
            isAnalyzing={isAnalyzing}
            analyzeError={analyzeError}
            onApplyStructure={handleApplyStructure}
            collapsed={aiPanelCollapsed}
            onToggleCollapse={() => setAiPanelCollapsed((v) => !v)}
          />
        </div>

        {/* ── Document input modal (for source docs) ──────────────────────── */}
        {showDocInput && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">{t("proposalWorkspace.addSourceDocument")}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDocInput(false)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DocumentInputPanel
                  sources={proposalSourceDocs.map((d) => ({
                    id: String(d.id),
                    name: String(d.name ?? ""),
                    content: String(d.content ?? ""),
                    type: (d.docType as "pasted" | "uploaded") ?? "pasted",
                    wordCount: Number(d.wordCount ?? 0),
                    addedAt: new Date(Number(d.addedAt ?? 0) / 1000),
                  }))}
                  dispatch={(action) => {
                    if (action.type === "ADD_SOURCE") {
                      addSourceDoc.mutate({
                        proposalId: proposalIdBig,
                        name: action.source.name,
                        content: action.source.content,
                        docType: action.source.type,
                        wordCount: action.source.wordCount,
                      })
                      setShowDocInput(false)
                    } else if (action.type === "REMOVE_SOURCE") {
                      const doc = proposalSourceDocs.find((d) => String(d.id) === action.id)
                      if (doc) deleteSourceDoc.mutate(doc.id)
                    }
                  }}
                  onAnalyze={async () => { setShowDocInput(false); await handleAnalyze() }}
                  isAnalyzing={isAnalyzing}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Version history footer ──────────────────────────────────────── */}
        <VersionHistoryBar
          versions={localVersions}
          activeVersionId={null}
          currentSections={proposalSections.map((s) => ({
            id: String(s.id),
            title: s.title ?? "",
            content: s.content ?? "",
            status: ((s.status as string)?.toLowerCase() as import("@/lib/proposal-workspace-types").SectionStatus) ?? "draft",
            aiSuggestion: s.aiSuggestion ?? null,
            order: s.sequence ?? 0,
            wordCount: s.wordCount ?? 0,
          }))}
          onRestoreVersion={(versionId) => {
            const version = localVersions.find((v) => v.id === versionId)
            if (!version) return
            // Restore: upsert all sections from snapshot
            version.sections.forEach((sec, idx) => {
              upsertSection.mutate({
                proposalId: proposalIdBig,
                sectionId: BigInt(0), // creates new (simplest restore approach)
                title: sec.title,
                content: sec.content,
                status: sec.status,
                sequence: (idx + 1) * 10,
              })
            })
          }}
        />
      </div>
    </>
  )
}
