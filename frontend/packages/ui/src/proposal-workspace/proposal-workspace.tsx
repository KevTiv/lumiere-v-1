"use client"

import { useReducer, useCallback, useRef } from "react"
import { ArrowLeft, Download, ChevronDown } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  WorkspaceState,
  WorkspaceAction,
  AIAnalysis,
  TenderSection,
  ProposalVersion,
  VersionDiff,
  SectionDiff,
  ProposalStatus,
} from "@/lib/proposal-workspace-types"
import { SECTION_TEMPLATES } from "@/lib/proposal-workspace-types"
import { DocumentInputPanel } from "./document-input-panel"
import { AIAnalysisPanel } from "./ai-analysis-panel"
import { TenderEditorPanel } from "./tender-editor-panel"
import { VersionHistoryBar, SaveVersionButton } from "./version-history-bar"

// ─── Reducer ──────────────────────────────────────────────────────────────────

function countWords(text: string) {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length
}

function buildDiff(prev: TenderSection[], next: TenderSection[]): VersionDiff {
  const sectionDiffs: SectionDiff[] = []
  let totalAdded = 0
  let totalRemoved = 0

  for (const prevSec of prev) {
    const nextSec = next.find((s) => s.id === prevSec.id)
    const oldLines = prevSec.content.split("\n")
    const newLines = nextSec?.content.split("\n") ?? []
    const lines = simpleLineDiff(oldLines, newLines)
    const added = lines.filter((l) => l.type === "added").length
    const removed = lines.filter((l) => l.type === "removed").length
    totalAdded += added
    totalRemoved += removed
    sectionDiffs.push({ sectionId: prevSec.id, sectionTitle: prevSec.title, lines, hasChanges: added > 0 || removed > 0 })
  }

  const sectionsAdded = next.filter((s) => !prev.find((p) => p.id === s.id)).map((s) => s.title)
  const sectionsRemoved = prev.filter((s) => !next.find((n) => n.id === s.id)).map((s) => s.title)
  totalAdded += sectionsAdded.length
  totalRemoved += sectionsRemoved.length

  return { sectionDiffs, sectionsAdded, sectionsRemoved, totalLinesAdded: totalAdded, totalLinesRemoved: totalRemoved }
}

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

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "ADD_SOURCE":
      return { ...state, sources: [...state.sources, action.source], isDirty: true }
    case "REMOVE_SOURCE":
      return { ...state, sources: state.sources.filter((s) => s.id !== action.id), isDirty: true }
    case "UPDATE_SOURCE_CONTENT": {
      const words = countWords(action.content)
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id ? { ...s, content: action.content, wordCount: words } : s
        ),
        isDirty: true,
      }
    }
    case "SET_ANALYZING":
      return { ...state, isAnalyzing: action.value, analyzeError: null }
    case "SET_ANALYSIS":
      return { ...state, analysis: action.analysis, isAnalyzing: false }
    case "SET_ANALYZE_ERROR":
      return { ...state, analyzeError: action.error, isAnalyzing: false }
    case "SET_SECTIONS":
      return { ...state, sections: action.sections, isDirty: true }
    case "UPDATE_SECTION":
      return {
        ...state,
        sections: state.sections.map((s) => (s.id === action.id ? { ...s, ...action.updates } : s)),
        isDirty: true,
      }
    case "ADD_SECTION":
      return { ...state, sections: [...state.sections, action.section], isDirty: true }
    case "REMOVE_SECTION":
      return { ...state, sections: state.sections.filter((s) => s.id !== action.id), isDirty: true }
    case "MOVE_SECTION": {
      const idx = state.sections.findIndex((s) => s.id === action.id)
      if (idx < 0) return state
      const newSections = [...state.sections]
      const target = action.direction === "up" ? idx - 1 : idx + 1
      if (target < 0 || target >= newSections.length) return state;
      [newSections[idx], newSections[target]] = [newSections[target], newSections[idx]]
      return { ...state, sections: newSections.map((s, i) => ({ ...s, order: i })), isDirty: true }
    }
    case "DUPLICATE_SECTION": {
      const sec = state.sections.find((s) => s.id === action.id)
      if (!sec) return state
      const copy: TenderSection = { ...sec, id: `sec-${Date.now()}`, title: `${sec.title} (copy)`, order: state.sections.length }
      return { ...state, sections: [...state.sections, copy], isDirty: true }
    }
    case "SAVE_VERSION": {
      const prev = state.versions.length > 0 ? state.versions[state.versions.length - 1].sections : []
      const diff = buildDiff(prev, state.sections)
      const version: ProposalVersion = {
        id: `v-${Date.now()}`,
        versionNumber: state.versions.length + 1,
        message: action.message,
        author: action.author,
        createdAt: new Date(),
        sections: state.sections.map((s) => ({ ...s })),
        diff: state.versions.length > 0 ? diff : null,
      }
      return { ...state, versions: [...state.versions, version], isDirty: false }
    }
    case "RESTORE_VERSION": {
      const version = state.versions.find((v) => v.id === action.versionId)
      if (!version) return state
      return { ...state, sections: version.sections.map((s) => ({ ...s })), isDirty: true, activeVersionId: null }
    }
    case "SET_ACTIVE_VERSION":
      return { ...state, activeVersionId: action.id }
    case "SET_STATUS":
      return { ...state, status: action.status }
    case "SET_DIRTY":
      return { ...state, isDirty: action.value }
    default:
      return state
  }
}

const STATUS_OPTIONS: { value: ProposalStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "In Review" },
  { value: "submitted", label: "Submitted" },
  { value: "awarded", label: "Awarded" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
]

const STATUS_VARIANT: Record<ProposalStatus, "secondary" | "outline" | "default" | "destructive"> = {
  draft: "secondary",
  review: "outline",
  submitted: "default",
  awarded: "default",
  rejected: "destructive",
  archived: "secondary",
}

interface ProposalWorkspaceProps {
  proposalId: string
  proposalTitle: string
  initialStatus?: ProposalStatus
  onAnalyze: (text: string) => Promise<AIAnalysis>
}

export function ProposalWorkspace({ proposalId, proposalTitle, initialStatus = "draft", onAnalyze }: ProposalWorkspaceProps) {
  const [state, dispatch] = useReducer(workspaceReducer, {
    proposalId,
    proposalTitle,
    status: initialStatus,
    sources: [],
    analysis: null,
    isAnalyzing: false,
    analyzeError: null,
    sections: [],
    versions: [],
    activeVersionId: null,
    isDirty: false,
  } satisfies WorkspaceState)

  const printRef = useRef<HTMLDivElement>(null)

  const handleAnalyze = useCallback(async () => {
    const combinedText = state.sources.map((s) => s.content).join("\n\n---\n\n")
    if (!combinedText.trim()) return
    dispatch({ type: "SET_ANALYZING", value: true })
    try {
      const analysis = await onAnalyze(combinedText)
      dispatch({ type: "SET_ANALYSIS", analysis })
    } catch (err) {
      dispatch({ type: "SET_ANALYZE_ERROR", error: err instanceof Error ? err.message : "Analysis failed" })
    }
  }, [state.sources, onAnalyze])

  const handleApplyStructure = useCallback(() => {
    if (!state.analysis) return
    const suggested = state.analysis.suggestedSections.length > 0
      ? state.analysis.suggestedSections
      : SECTION_TEMPLATES.slice(0, 5).map((t) => t.title)

    const newSections: TenderSection[] = suggested.map((title, idx) => ({
      id: `sec-${Date.now()}-${idx}`,
      title,
      content: "",
      status: "empty" as const,
      aiSuggestion: state.analysis!.keyFindings[idx]?.excerpt ?? null,
      order: idx,
      wordCount: 0,
    }))
    dispatch({ type: "SET_SECTIONS", sections: newSections })
  }, [state.analysis])

  const handleExportMarkdown = () => {
    const md = state.sections
      .map((s) => `## ${s.title}\n\n${s.content}`)
      .join("\n\n---\n\n")
    const blob = new Blob([`# ${state.proposalTitle}\n\n${md}`], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${state.proposalTitle.replace(/\s+/g, "-").toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPDF = () => {
    window.print()
  }

  const handleExportText = () => {
    const text = state.sections.map((s) => `${s.title.toUpperCase()}\n${"=".repeat(s.title.length)}\n\n${s.content}`).join("\n\n\n")
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${state.proposalTitle.replace(/\s+/g, "-").toLowerCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {/* Print styles — hidden in UI, shown when printing */}
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
        <h1>{state.proposalTitle}</h1>
        {state.sections.map((s) => (
          <div key={s.id}>
            <h2>{s.title}</h2>
            {s.content.split("\n").map((line, i) => <p key={i}>{line}</p>)}
          </div>
        ))}
      </div>

      <div ref={printRef} className="flex flex-col h-full bg-background no-print">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background shrink-0 z-10">
          <Link href="/proposals" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">{state.proposalTitle}</h1>
          </div>

          {/* Status selector */}
          <div className="relative group">
            <button className="flex items-center gap-1.5">
              <Badge variant={STATUS_VARIANT[state.status]} className="text-xs cursor-pointer">
                {STATUS_OPTIONS.find((o) => o.value === state.status)?.label ?? state.status}
              </Badge>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            <div className="absolute top-full right-0 mt-1 z-20 rounded-lg border border-border bg-popover shadow-lg hidden group-hover:block min-w-[120px]">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => dispatch({ type: "SET_STATUS", status: opt.value })}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
                    state.status === opt.value && "font-semibold text-primary"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <SaveVersionButton
            dispatch={dispatch}
            isDirty={state.isDirty}
            versionCount={state.versions.length}
          />

          {/* Export menu */}
          <div className="relative group">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3 w-3" />
            </Button>
            <div className="absolute top-full right-0 mt-1 z-20 rounded-lg border border-border bg-popover shadow-lg hidden group-hover:block min-w-[160px]">
              <button onClick={handleExportPDF} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors">
                Export as PDF
              </button>
              <button onClick={handleExportMarkdown} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors">
                Export as Markdown
              </button>
              <button onClick={handleExportText} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors">
                Copy as Plain Text
              </button>
            </div>
          </div>
        </header>

        {/* 3-column workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Source documents */}
          <div className="w-[300px] shrink-0 border-r border-border flex flex-col overflow-hidden">
            <DocumentInputPanel
              sources={state.sources}
              dispatch={dispatch}
              onAnalyze={handleAnalyze}
              isAnalyzing={state.isAnalyzing}
            />
          </div>

          {/* Middle: AI analysis */}
          <div className="w-[300px] shrink-0 border-r border-border flex flex-col overflow-hidden">
            <AIAnalysisPanel
              analysis={state.analysis}
              isAnalyzing={state.isAnalyzing}
              analyzeError={state.analyzeError}
              dispatch={dispatch}
              onApplyStructure={handleApplyStructure}
            />
          </div>

          {/* Right: Tender editor (flexible) */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <TenderEditorPanel
              sections={state.sections}
              dispatch={dispatch}
              analysis={state.analysis}
            />
          </div>
        </div>

        {/* Version history footer */}
        <VersionHistoryBar
          versions={state.versions}
          activeVersionId={state.activeVersionId}
          currentSections={state.sections}
          dispatch={dispatch}
        />
      </div>
    </>
  )
}
