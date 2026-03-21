"use client"

import { useState, useRef, useEffect } from "react"
import { Plus, ChevronUp, ChevronDown, Copy, Trash2, Lightbulb, ChevronRight, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TenderSection, SectionStatus, WorkspaceAction, AIAnalysis } from "@/lib/proposal-workspace-types"
import { SECTION_TEMPLATES } from "@/lib/proposal-workspace-types"

interface TenderEditorPanelProps {
  sections: TenderSection[]
  dispatch: React.Dispatch<WorkspaceAction>
  analysis: AIAnalysis | null
}

const STATUS_BADGE: Record<SectionStatus, { label: string; variant: "secondary" | "outline" | "default" | "destructive" }> = {
  empty: { label: "Empty", variant: "secondary" },
  draft: { label: "Draft", variant: "outline" },
  complete: { label: "Complete", variant: "default" },
  reviewed: { label: "Reviewed", variant: "default" },
}

function countWords(text: string) {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length
}

function deriveStatus(content: string): SectionStatus {
  if (!content.trim()) return "empty"
  if (countWords(content) < 30) return "draft"
  return "draft"
}

interface SectionCardProps {
  section: TenderSection
  index: number
  total: number
  dispatch: React.Dispatch<WorkspaceAction>
  analysis: AIAnalysis | null
}

function SectionCard({ section, index, total, dispatch, analysis }: SectionCardProps) {
  const [showSuggestion, setShowSuggestion] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [section.content])

  const handleContentChange = (value: string) => {
    dispatch({
      type: "UPDATE_SECTION",
      id: section.id,
      updates: {
        content: value,
        wordCount: countWords(value),
        status: deriveStatus(value),
      },
    })
  }

  const handleTitleChange = (value: string) => {
    dispatch({ type: "UPDATE_SECTION", id: section.id, updates: { title: value } })
  }

  const handleMarkComplete = () => {
    dispatch({
      type: "UPDATE_SECTION",
      id: section.id,
      updates: { status: section.status === "complete" ? "draft" : "complete" },
    })
  }

  // Find relevant suggestion from analysis
  const suggestion = section.aiSuggestion ?? (
    analysis?.keyFindings.find((f) =>
      f.title.toLowerCase().includes(section.title.toLowerCase().split(" ")[0].toLowerCase())
    )?.excerpt ?? null
  )

  const badge = STATUS_BADGE[section.status]

  return (
    <div className={cn(
      "group rounded-lg border transition-colors",
      section.status === "complete"
        ? "border-green-200 bg-green-50/30 dark:border-green-900/40 dark:bg-green-900/10"
        : "border-border bg-card hover:border-primary/30"
    )}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 cursor-grab" />

        {titleEditing ? (
          <input
            autoFocus
            value={section.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onBlur={() => setTitleEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && setTitleEditing(false)}
            className="flex-1 text-xs font-semibold bg-transparent border-0 outline-none ring-1 ring-primary rounded px-1 text-foreground"
          />
        ) : (
          <button
            onClick={() => setTitleEditing(true)}
            className="flex-1 text-left text-xs font-semibold text-foreground hover:text-primary truncate"
          >
            {section.title}
          </button>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-muted-foreground">{section.wordCount}w</span>
          <button onClick={handleMarkComplete}>
            <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-80">
              {badge.label}
            </Badge>
          </button>
          {suggestion && (
            <button
              onClick={() => setShowSuggestion(!showSuggestion)}
              className={cn("p-0.5 rounded transition-colors", showSuggestion ? "text-amber-500" : "text-muted-foreground hover:text-amber-500")}
              title="AI suggestion"
            >
              <Lightbulb className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => dispatch({ type: "MOVE_SECTION", id: section.id, direction: "up" })}
            disabled={index === 0}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => dispatch({ type: "MOVE_SECTION", id: section.id, direction: "down" })}
            disabled={index === total - 1}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => dispatch({ type: "DUPLICATE_SECTION", id: section.id })}
            className="p-0.5 text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => dispatch({ type: "REMOVE_SECTION", id: section.id })}
            className="p-0.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* AI suggestion strip */}
      {showSuggestion && suggestion && (
        <div className="px-3 py-2 bg-amber-50/60 dark:bg-amber-900/10 border-b border-amber-200/50 dark:border-amber-900/30">
          <div className="flex items-start gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">AI Suggestion</p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed italic line-clamp-3">"{suggestion}"</p>
            </div>
            <button
              onClick={() => handleContentChange(section.content + (section.content ? "\n\n" : "") + suggestion)}
              className="text-[10px] text-amber-600 hover:underline shrink-0"
            >
              Insert
            </button>
          </div>
        </div>
      )}

      {/* Content textarea */}
      <textarea
        ref={textareaRef}
        value={section.content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder={
          SECTION_TEMPLATES.find((t) => t.title.toLowerCase() === section.title.toLowerCase())?.placeholder
          ?? `Write content for "${section.title}"…`
        }
        className="w-full resize-none p-3 text-xs leading-relaxed text-foreground bg-transparent outline-none min-h-[80px]"
        rows={3}
      />
    </div>
  )
}

function AddSectionMenu({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2 text-xs border-dashed"
        onClick={() => setOpen(!open)}
      >
        <Plus className="h-3.5 w-3.5" />
        Add Section
        <ChevronRight className={cn("h-3.5 w-3.5 ml-auto transition-transform", open && "rotate-90")} />
      </Button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 right-0 z-10 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="p-1.5 grid grid-cols-1 gap-0.5 max-h-52 overflow-y-auto">
            {SECTION_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => { onAdd(t.title); setOpen(false) }}
                className="flex items-center gap-2 px-2.5 py-2 rounded text-xs text-left hover:bg-muted transition-colors text-foreground"
              >
                {t.title}
              </button>
            ))}
            <div className="border-t border-border my-0.5" />
            <button
              onClick={() => { onAdd("Custom Section"); setOpen(false) }}
              className="flex items-center gap-2 px-2.5 py-2 rounded text-xs text-left hover:bg-muted transition-colors text-muted-foreground"
            >
              <Plus className="h-3 w-3" />
              Custom section…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TenderEditorPanel({ sections, dispatch, analysis }: TenderEditorPanelProps) {
  const totalWords = sections.reduce((sum, s) => sum + s.wordCount, 0)
  const completedCount = sections.filter((s) => s.status === "complete" || s.status === "reviewed").length

  const handleAddSection = (title: string) => {
    const newSection: TenderSection = {
      id: `sec-${Date.now()}`,
      title,
      content: "",
      status: "empty",
      aiSuggestion: null,
      order: sections.length,
      wordCount: 0,
    }
    dispatch({ type: "ADD_SECTION", section: newSection })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tender Draft</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sections.length === 0
              ? "No sections yet"
              : `${sections.length} sections · ${completedCount} complete · ${totalWords.toLocaleString()} words`}
          </p>
        </div>
        {sections.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{Math.round((completedCount / sections.length) * 100)}%</span>
            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(completedCount / sections.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sections list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No sections yet</p>
            <p className="text-xs text-muted-foreground">
              Add a section below, or run AI analysis and click "Apply Structure to Draft"
            </p>
          </div>
        ) : (
          sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              index={index}
              total={sections.length}
              dispatch={dispatch}
              analysis={analysis}
            />
          ))
        )}
      </div>

      {/* Add section footer */}
      <div className="px-3 pb-3 shrink-0">
        <AddSectionMenu onAdd={handleAddSection} />
      </div>
    </div>
  )
}
