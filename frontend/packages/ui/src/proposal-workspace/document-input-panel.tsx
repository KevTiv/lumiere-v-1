"use client"

import { useState, useCallback, useRef } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Plus, Clipboard, X, FileText, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import type { SourceDocument, WorkspaceAction } from "@/lib/proposal-workspace-types"

interface DocumentInputPanelProps {
  sources: SourceDocument[]
  dispatch: React.Dispatch<WorkspaceAction>
  onAnalyze: () => void
  isAnalyzing: boolean
  onRenameSource: (source: SourceDocument, name: string) => void
  onSaveSource: (source: SourceDocument) => void
  savingSourceId: string | null
  dirtySourceIds: string[]
  saveError: string | null
}

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length
}

export function DocumentInputPanel({
  sources, dispatch, onAnalyze, isAnalyzing, onRenameSource, onSaveSource,
  savingSourceId, dirtySourceIds, saveError,
}: DocumentInputPanelProps) {
  const { t } = useTranslation()
  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    sources.length > 0 ? sources[0].id : null
  )
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null
  const isSavingActiveSource = savingSourceId !== null && savingSourceId === activeSourceId

  const addBlankSource = () => {
    const id = `src-${crypto.randomUUID()}`
    const newSource: SourceDocument = {
      id,
      name: t("proposalWorkspace.documentInputPanel.documentName", { count: sources.length + 1 }),
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
        const id = `src-${crypto.randomUUID()}`
        dispatch({
          type: "ADD_SOURCE",
          source: { id, name: t("proposalWorkspace.documentInputPanel.documentName", { count: sources.length + 1 }), content: text, type: "pasted", wordCount: countWords(text), addedAt: new Date() },
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
        const id = `src-${crypto.randomUUID()}`
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
      const id = `src-${crypto.randomUUID()}`
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
    <div className="flex min-w-0 flex-col rounded-md border border-border">
      {/* Panel header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t("proposalWorkspace.documentInputPanel.sourceDocuments")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sources.length === 0
              ? t("proposalWorkspace.documentInputPanel.pasteOrUploadRfp")
              : (sources.length === 1
                ? t("proposalWorkspace.documentInputPanel.docCount", { count: sources.length, words: totalWords.toLocaleString() })
                : t("proposalWorkspace.documentInputPanel.docCountPlural", { count: sources.length, words: totalWords.toLocaleString() }))}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={addBlankSource} className="h-7 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          {t("proposalWorkspace.documentInputPanel.addDoc")}
        </Button>
      </div>

      {/* Document tabs */}
      {sources.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30 overflow-x-auto shrink-0">
          {sources.map((src) => (
            <div
              key={src.id}
              className={cn(
                "flex shrink-0 items-center rounded text-xs font-medium transition-colors",
                activeSourceId === src.id
                  ? "bg-background border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              )}
            >
              <button
                type="button"
                aria-pressed={activeSourceId === src.id}
                onClick={() => setActiveSourceId(src.id)}
                className="flex min-h-9 items-center gap-1.5 rounded px-2"
              >
                <FileText className="h-3 w-3" aria-hidden="true" />
                <span className="max-w-28 truncate">{src.name}</span>
              </button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${t("common.delete")} ${src.name}`}
                onClick={() => handleRemoveSource(src.id)}
                disabled={savingSourceId === src.id}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
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
              "m-3 flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-3 transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"
            )}
          >
            <div className="space-y-2 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">{t("proposalWorkspace.documentInputPanel.pasteOrDropDocument")}</p>
              <p className="text-xs text-muted-foreground">
                {t("proposalWorkspace.documentInputPanel.supportedFormats")}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={handlePasteFromClipboard} className="h-auto min-h-8 max-w-full gap-1.5 whitespace-normal text-xs">
                <Clipboard className="h-3.5 w-3.5" />
                {t("proposalWorkspace.documentInputPanel.pasteFromClipboard")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="h-auto min-h-8 max-w-full gap-1.5 whitespace-normal text-xs">
                <Plus className="h-3.5 w-3.5" />
                {t("proposalWorkspace.documentInputPanel.uploadFile")}
              </Button>
            </div>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.csv" className="hidden" onChange={handleFileInput} />
          </div>
        ) : (
          /* Active document editor */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Doc name + word count */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <input
                value={activeSource.name}
                onChange={(e) => onRenameSource(activeSource, e.target.value)}
                disabled={isSavingActiveSource}
                className="min-w-0 flex-1 border-0 bg-transparent text-xs font-medium text-foreground outline-none"
              />
              <span className="text-xs text-muted-foreground shrink-0">
                {t("proposalWorkspace.documentInputPanel.wordCount", { count: activeSource.wordCount })}
              </span>
              <Button size="sm" variant="ghost" disabled={isSavingActiveSource} onClick={handlePasteFromClipboard} className="h-6 w-6 p-0" title={t("proposalWorkspace.documentInputPanel.pasteFromClipboard")}>
                <Clipboard className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea variant="plain"
              value={activeSource.content}
              disabled={isSavingActiveSource}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={t("proposalWorkspace.documentInputPanel.pasteRfp")}
              className="field-sizing-fixed min-h-32 flex-1 resize-none rounded-none border-0 p-3 font-mono text-xs leading-relaxed text-foreground shadow-none focus-visible:ring-0 md:text-xs"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {saveError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{saveError}</p>}

      {/* Saving a draft and analysing its contents are separate actions. */}
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-background px-4 py-3">
        {activeSource && (
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-8 w-full whitespace-normal"
            disabled={savingSourceId !== null || !dirtySourceIds.includes(activeSource.id)}
            onClick={() => onSaveSource(activeSource)}
          >
            {isSavingActiveSource ? t("common.saving") : t("common.save")}
          </Button>
        )}
        <Button
          className="h-auto min-h-8 w-full gap-2 whitespace-normal"
          size="sm"
          onClick={onAnalyze}
          disabled={isAnalyzing || sources.every((s) => s.content.trim() === "")}
        >
          {isAnalyzing ? (
            <>
              <ChevronDown className="h-4 w-4 animate-bounce" />
              {t("proposalWorkspace.documentInputPanel.analysing")}
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              {t("proposalWorkspace.documentInputPanel.analyseWithAI")}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
