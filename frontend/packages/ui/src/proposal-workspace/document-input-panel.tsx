"use client"

import { useState, useCallback, useRef } from "react"
import { Plus, Clipboard, X, FileText, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SourceDocument, WorkspaceAction } from "@/lib/proposal-workspace-types"

interface DocumentInputPanelProps {
  sources: SourceDocument[]
  dispatch: React.Dispatch<WorkspaceAction>
  onAnalyze: () => void
  isAnalyzing: boolean
}

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length
}

export function DocumentInputPanel({ sources, dispatch, onAnalyze, isAnalyzing }: DocumentInputPanelProps) {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    sources.length > 0 ? sources[0].id : null
  )
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null

  const addBlankSource = () => {
    const id = `src-${Date.now()}`
    const newSource: SourceDocument = {
      id,
      name: `Document ${sources.length + 1}`,
      content: "",
      type: "pasted",
      wordCount: 0,
      addedAt: new Date(),
    }
    dispatch({ type: "ADD_SOURCE", source: newSource })
    setActiveSourceId(id)
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!activeSourceId) {
        const id = `src-${Date.now()}`
        dispatch({
          type: "ADD_SOURCE",
          source: { id, name: `Document ${sources.length + 1}`, content: text, type: "pasted", wordCount: countWords(text), addedAt: new Date() },
        })
        setActiveSourceId(id)
      } else {
        dispatch({ type: "UPDATE_SOURCE_CONTENT", id: activeSourceId, content: text })
      }
    } catch {
      // clipboard read failed; user can paste manually
    }
  }

  const handleContentChange = (value: string) => {
    if (!activeSourceId) return
    dispatch({ type: "UPDATE_SOURCE_CONTENT", id: activeSourceId, content: value })
  }

  const handleRemoveSource = (id: string) => {
    dispatch({ type: "REMOVE_SOURCE", id })
    if (activeSourceId === id) {
      const remaining = sources.filter((s) => s.id !== id)
      setActiveSourceId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const content = ev.target?.result as string
        const id = `src-${Date.now()}`
        dispatch({
          type: "ADD_SOURCE",
          source: { id, name: file.name, content, type: "uploaded", wordCount: countWords(content), addedAt: new Date() },
        })
        setActiveSourceId(id)
      }
      reader.readAsText(file)
    },
    [dispatch]
  )

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      const id = `src-${Date.now()}`
      dispatch({
        type: "ADD_SOURCE",
        source: { id, name: file.name, content, type: "uploaded", wordCount: countWords(content), addedAt: new Date() },
      })
      setActiveSourceId(id)
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const totalWords = sources.reduce((sum, s) => sum + s.wordCount, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Source Documents</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sources.length === 0
              ? "Paste or upload your RFP / brief"
              : `${sources.length} doc${sources.length > 1 ? "s" : ""} · ${totalWords.toLocaleString()} words`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={addBlankSource} className="h-7 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add Doc
        </Button>
      </div>

      {/* Document tabs */}
      {sources.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30 overflow-x-auto shrink-0">
          {sources.map((src) => (
            <button
              key={src.id}
              onClick={() => setActiveSourceId(src.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium shrink-0 transition-colors",
                activeSourceId === src.id
                  ? "bg-background border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              )}
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[80px] truncate">{src.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveSource(src.id) }}
                className="ml-0.5 rounded hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* Document content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {sources.length === 0 || !activeSource ? (
          /* Empty / drop zone state */
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-4 m-4 rounded-lg border-2 border-dashed transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"
            )}
          >
            <div className="text-center space-y-2 px-6">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Paste or drop your document</p>
              <p className="text-xs text-muted-foreground">
                Supports .txt, .md files or paste plain text — PDFs and Word docs: extract text first
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handlePasteFromClipboard} className="gap-1.5 text-xs">
                <Clipboard className="h-3.5 w-3.5" />
                Paste from clipboard
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" />
                Upload file
              </Button>
            </div>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.csv" className="hidden" onChange={handleFileInput} />
          </div>
        ) : (
          /* Active document editor */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Doc name + word count */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
              <input
                value={activeSource.name}
                onChange={(e) => {
                  const updated = { ...activeSource, name: e.target.value }
                  dispatch({ type: "UPDATE_SOURCE_CONTENT", id: activeSource.id, content: activeSource.content })
                  // Update name via a workaround — re-add with same id
                  dispatch({ type: "REMOVE_SOURCE", id: activeSource.id })
                  dispatch({ type: "ADD_SOURCE", source: { ...updated, name: e.target.value } })
                  setActiveSourceId(activeSource.id)
                }}
                className="flex-1 text-xs font-medium bg-transparent border-0 outline-none text-foreground"
              />
              <span className="text-xs text-muted-foreground shrink-0">
                {activeSource.wordCount.toLocaleString()} words
              </span>
              <Button size="sm" variant="ghost" onClick={handlePasteFromClipboard} className="h-6 w-6 p-0" title="Paste from clipboard">
                <Clipboard className="h-3.5 w-3.5" />
              </Button>
            </div>
            <textarea
              value={activeSource.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Paste your RFP, tender brief, or source document here…"
              className="flex-1 resize-none p-3 text-xs leading-relaxed text-foreground bg-background outline-none font-mono"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {/* Analyze button */}
      <div className="px-4 py-3 border-t border-border bg-background shrink-0">
        <Button
          className="w-full gap-2"
          size="sm"
          onClick={onAnalyze}
          disabled={isAnalyzing || sources.every((s) => s.content.trim() === "")}
        >
          {isAnalyzing ? (
            <>
              <ChevronDown className="h-4 w-4 animate-bounce" />
              Analysing…
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Analyse with AI
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
