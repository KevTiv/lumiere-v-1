"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Sparkles, AlertCircle, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  AIAnalysis,
  Finding,
  Requirement,
  EvaluationCriterion,
  FindingRelevance,
} from "@/lib/proposal-workspace-types"

interface AIPanelProps {
  analysis: AIAnalysis | null
  isAnalyzing: boolean
  analyzeError: string | null
  onApplyStructure: () => void
  collapsed: boolean
  onToggleCollapse: () => void
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
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
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

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="px-3 py-2 hover:bg-muted/20">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-medium text-foreground leading-snug">{finding.title}</p>
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0", relevanceBadgeClass(finding.relevance))}>
          {finding.relevance}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed italic line-clamp-2">"{finding.excerpt}"</p>
    </div>
  )
}

function RequirementRow({ req, onToggle }: { req: Requirement; onToggle: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/20 group">
      <button onClick={onToggle} className="mt-0.5 shrink-0">
        {req.addressed
          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          : <Circle className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("text-xs leading-snug", req.addressed && "line-through text-muted-foreground")}>
          {req.text}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-muted-foreground">{req.category}</span>
          {req.mandatory && (
            <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded">Required</span>
          )}
        </div>
      </div>
    </div>
  )
}

function CriterionRow({ criterion }: { criterion: EvaluationCriterion }) {
  return (
    <div className="px-3 py-2 hover:bg-muted/20">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{criterion.name}</span>
        <span className="text-xs text-muted-foreground font-mono">{criterion.weight}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1">
        <div className="bg-primary h-1 rounded-full" style={{ width: `${criterion.weight}%` }} />
      </div>
      {criterion.description && (
        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{criterion.description}</p>
      )}
    </div>
  )
}

export function AIPanel({ analysis, isAnalyzing, analyzeError, onApplyStructure, collapsed, onToggleCollapse }: AIPanelProps) {
  const [requirements, setRequirements] = useState<Requirement[]>(analysis?.requirements ?? [])

  // sync requirements when analysis changes
  if (analysis && requirements.length === 0 && analysis.requirements.length > 0) {
    setRequirements(analysis.requirements)
  }

  const toggleRequirement = (id: string) => {
    setRequirements((prev) => prev.map((r) => r.id === id ? { ...r, addressed: !r.addressed } : r))
  }

  const addressedCount = requirements.filter((r) => r.addressed).length

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 border-l border-border bg-muted/20 w-10 shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Expand AI panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        {analysis && (
          <div className="flex flex-col items-center gap-1 mt-1">
            <span className="text-[10px] text-muted-foreground writing-vertical-lr rotate-180 tracking-wider" style={{ writingMode: "vertical-lr" }}>
              AI Analysis
            </span>
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-72 shrink-0 border-l border-border flex flex-col overflow-hidden bg-background">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">AI Analysis</span>
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Collapse panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Sparkles className="h-6 w-6 text-primary animate-pulse" />
            <p className="text-xs text-muted-foreground text-center px-4">Analysing document content...</p>
          </div>
        )}

        {analyzeError && !isAnalyzing && (
          <div className="m-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{analyzeError}</p>
          </div>
        )}

        {!analysis && !isAnalyzing && !analyzeError && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 px-4">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground text-center">
              Upload an appel d&apos;offre and click Analyze to extract requirements and structure.
            </p>
          </div>
        )}

        {analysis && !isAnalyzing && (
          <div className="p-3 space-y-3">
            {/* Summary */}
            <div className="rounded-lg bg-muted/40 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-foreground">{analysis.summary}</p>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Analysed {analysis.analyzedAt instanceof Date ? analysis.analyzedAt.toLocaleDateString() : ""}
              </p>
            </div>

            {/* Apply structure */}
            {analysis.suggestedSections.length > 0 && (
              <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs" onClick={onApplyStructure}>
                <Sparkles className="h-3 w-3" />
                Apply suggested structure ({analysis.suggestedSections.length} sections)
              </Button>
            )}

            {/* Requirements checklist */}
            {requirements.length > 0 && (
              <SectionToggle
                title={`Requirements (${addressedCount}/${requirements.length})`}
                count={requirements.length}
              >
                {requirements.map((req) => (
                  <RequirementRow
                    key={req.id}
                    req={req}
                    onToggle={() => toggleRequirement(req.id)}
                  />
                ))}
              </SectionToggle>
            )}

            {/* Key findings */}
            {analysis.keyFindings.length > 0 && (
              <SectionToggle title="Key Findings" count={analysis.keyFindings.length}>
                {analysis.keyFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </SectionToggle>
            )}

            {/* Evaluation criteria */}
            {analysis.evaluationCriteria.length > 0 && (
              <SectionToggle title="Evaluation Criteria" count={analysis.evaluationCriteria.length}>
                {analysis.evaluationCriteria.map((c) => (
                  <CriterionRow key={c.id} criterion={c} />
                ))}
              </SectionToggle>
            )}

            {/* Concepts */}
            {analysis.concepts.length > 0 && (
              <SectionToggle title="Key Concepts" count={analysis.concepts.length}>
                {analysis.concepts.map((c) => (
                  <div key={c.id} className="px-3 py-2 hover:bg-muted/20">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium">{c.term}</span>
                      <span className="text-[10px] text-muted-foreground">&times;{c.frequency}</span>
                    </div>
                    {c.definition && <p className="text-[10px] text-muted-foreground line-clamp-2">{c.definition}</p>}
                  </div>
                ))}
              </SectionToggle>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
