"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Sparkles, ArrowRight, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  AIAnalysis,
  Finding,
  Requirement,
  EvaluationCriterion,
  Concept,
  WorkspaceAction,
  FindingRelevance,
} from "@/lib/proposal-workspace-types"

interface AIAnalysisPanelProps {
  analysis: AIAnalysis | null
  isAnalyzing: boolean
  analyzeError: string | null
  dispatch: React.Dispatch<WorkspaceAction>
  onApplyStructure: () => void
}

function relevanceBadgeClass(r: FindingRelevance) {
  if (r === "high") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
  if (r === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
  return "bg-muted text-muted-foreground"
}

function SectionToggle({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{count}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>
      {open && <div className="divide-y divide-border">{children}</div>}
    </div>
  )
}

function FindingCard({ finding, onInsert }: { finding: Finding; onInsert: (text: string) => void }) {
  return (
    <div className="px-3 py-2.5 hover:bg-muted/20 group">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-xs font-medium text-foreground leading-snug">{finding.title}</p>
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0", relevanceBadgeClass(finding.relevance))}>
          {finding.relevance}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed italic line-clamp-3">"{finding.excerpt}"</p>
      <button
        onClick={() => onInsert(finding.excerpt)}
        className="mt-1.5 hidden group-hover:flex items-center gap-1 text-[10px] text-primary hover:underline"
      >
        <ArrowRight className="h-3 w-3" />
        Insert into draft
      </button>
    </div>
  )
}

function RequirementItem({
  req,
  onToggle,
}: {
  req: Requirement
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/20">
      <button onClick={() => onToggle(req.id)} className="mt-0.5 shrink-0">
        {req.addressed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("text-xs leading-snug", req.addressed ? "text-muted-foreground line-through" : "text-foreground")}>
          {req.text}
        </p>
        {req.mandatory && (
          <span className="text-[10px] text-destructive font-medium">Mandatory</span>
        )}
      </div>
    </div>
  )
}

function CriterionBar({ criterion }: { criterion: EvaluationCriterion }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-foreground">{criterion.name}</p>
        <span className="text-xs text-muted-foreground">{criterion.weight}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5">
        <div
          className={cn("h-1.5 rounded-full transition-all", criterion.addressed ? "bg-primary" : "bg-muted-foreground/30")}
          style={{ width: `${criterion.weight}%` }}
        />
      </div>
      {criterion.description && (
        <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{criterion.description}</p>
      )}
    </div>
  )
}

function ConceptPill({ concept }: { concept: Concept }) {
  const [showDef, setShowDef] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setShowDef(!showDef)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs font-medium text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
      >
        {concept.term}
        <span className="text-[10px] text-muted-foreground">×{concept.frequency}</span>
      </button>
      {showDef && concept.definition && (
        <div className="absolute bottom-full left-0 mb-1 z-10 w-56 p-2 rounded-lg border border-border bg-popover shadow-md text-[11px] text-popover-foreground leading-snug">
          {concept.definition}
        </div>
      )}
    </div>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-3 p-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-3/4" />
        </div>
      ))}
    </div>
  )
}

export function AIAnalysisPanel({ analysis, isAnalyzing, analyzeError, dispatch, onApplyStructure }: AIAnalysisPanelProps) {
  const handleToggleRequirement = (id: string) => {
    if (!analysis) return
    const updated = {
      ...analysis,
      requirements: analysis.requirements.map((r) =>
        r.id === id ? { ...r, addressed: !r.addressed } : r
      ),
    }
    dispatch({ type: "SET_ANALYSIS", analysis: updated })
  }

  const handleInsertFinding = (_text: string) => {
    // The tender editor panel handles insertion via a shared callback if needed
    // For now, copy to clipboard as a convenience
    navigator.clipboard.writeText(_text).catch(() => {})
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-background shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">AI Analysis</h3>
          {analysis && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {analysis.keyFindings.length} findings · {analysis.requirements.length} requirements
            </p>
          )}
        </div>
        {analysis && (
          <Badge variant="outline" className="text-[10px]">
            {new Date(analysis.analyzedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isAnalyzing && <AnalysisSkeleton />}

        {analyzeError && !isAnalyzing && (
          <div className="m-4 p-3 rounded-lg border border-destructive/30 bg-destructive/10 flex gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Analysis failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">{analyzeError}</p>
            </div>
          </div>
        )}

        {!isAnalyzing && !analyzeError && !analysis && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-12">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No analysis yet</p>
            <p className="text-xs text-muted-foreground">
              Paste your source document, then click "Analyse with AI" to extract findings, requirements, and concepts.
            </p>
          </div>
        )}

        {analysis && !isAnalyzing && (
          <div className="p-3 space-y-3">
            {/* Summary */}
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1.5">Summary</p>
              <p className="text-xs text-foreground leading-relaxed">{analysis.summary}</p>
            </div>

            {/* Key findings */}
            <SectionToggle title="Key Findings" count={analysis.keyFindings.length}>
              {analysis.keyFindings.map((f) => (
                <FindingCard key={f.id} finding={f} onInsert={handleInsertFinding} />
              ))}
            </SectionToggle>

            {/* Requirements checklist */}
            <SectionToggle title="Requirements" count={analysis.requirements.length}>
              {analysis.requirements.map((r) => (
                <RequirementItem key={r.id} req={r} onToggle={handleToggleRequirement} />
              ))}
            </SectionToggle>

            {/* Evaluation criteria */}
            {analysis.evaluationCriteria.length > 0 && (
              <SectionToggle title="Evaluation Criteria" count={analysis.evaluationCriteria.length}>
                {analysis.evaluationCriteria.map((c) => (
                  <CriterionBar key={c.id} criterion={c} />
                ))}
              </SectionToggle>
            )}

            {/* Concepts */}
            {analysis.concepts.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2.5 bg-muted/30">
                  <p className="text-xs font-semibold text-foreground">Key Concepts</p>
                </div>
                <div className="p-3 flex flex-wrap gap-1.5">
                  {analysis.concepts.map((c) => (
                    <ConceptPill key={c.id} concept={c} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Apply structure button */}
      {analysis && !isAnalyzing && (
        <div className="px-4 py-3 border-t border-border bg-background shrink-0">
          <Button className="w-full gap-2" size="sm" variant="default" onClick={onApplyStructure}>
            <ArrowRight className="h-4 w-4" />
            Apply Structure to Draft
          </Button>
          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            Pre-fills draft with suggested sections based on the analysis
          </p>
        </div>
      )}
    </div>
  )
}
