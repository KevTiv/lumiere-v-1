"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { browserWorkScope, readBrowserNotebooks, saveBrowserNotebook, deleteBrowserNotebook, importBrowserNotebook } from "./browser-notebooks"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Play,
  Plus,
  Save,
  Download,
  RotateCcw,
  Code,
  FileText,
  X,
  FolderOpen,
  File,
  Clock,
  Cpu,
  Database,
  BarChart3,
  BookOpen,
  Maximize2,
  Minimize2,
  Terminal,
  Settings,
  Layers,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotebookCellComponent } from "./notebook-cell"
import type { Notebook, NotebookCell, KernelState } from "@/lib/notebook-types"
import { mlSnippets, reportTemplates } from "@/lib/notebook-types"
import { downloadTextFile } from "@/lib/ui-exports"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"

interface NotebookPanelProps {
  open: boolean
  onClose: () => void
  onAIChat?: (message: string) => void
  dataContext?: {
    sales?: unknown[]
    inventory?: unknown[]
    customers?: unknown[]
  }
}

// Generate unique IDs
const generateId = () => Math.random().toString(36).slice(2, 11)

// Create a new empty cell
const createCell = (type: "code" | "markdown"): NotebookCell => ({
  id: generateId(),
  type,
  content: "",
  outputs: [],
  status: "idle",
  createdAt: new Date(),
  updatedAt: new Date(),
})

function newNotebook(): Notebook {
  return { id: generateId(), title: "Untitled Notebook", cells: [createCell("markdown"), createCell("code")],
    metadata: { category: "analysis" }, createdAt: new Date(), updatedAt: new Date() }
}

export function NotebookPanel(props: NotebookPanelProps) {
  const scope = browserWorkScope(useErpSession())
  return <ScopedNotebookPanel key={scope ?? "no-scope"} {...props} scope={scope} />
}

function ScopedNotebookPanel({ open, onClose, onAIChat, scope }: NotebookPanelProps & { scope: string | null }) {
  const { t } = useTranslation()
  const [notebook, setNotebook] = useState<Notebook>(newNotebook)

  const [selectedCellId, setSelectedCellId] = useState<string | null>(notebook.cells[0]?.id || null)
  const [kernel, setKernel] = useState<KernelState>({
    status: "idle",
    executionCount: 0,
    variables: {},
    imports: [],
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeTab, setActiveTab] = useState<"notebook" | "files" | "variables">("notebook")
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [savedNotebook, setSavedNotebook] = useState<Notebook | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [savedNotebooks, setSavedNotebooks] = useState<Notebook[]>([])
  const [storageReady, setStorageReady] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<Notebook | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const translate = useRef(t)
  translate.current = t
  useEffect(() => {
    if (!scope) { setStorageReady(true); return }
    try {
      const catalog = readBrowserNotebooks(window.localStorage, scope)
      setSavedNotebooks(catalog.notebooks)
      const active = catalog.notebooks.find((item) => item.id === catalog.activeId)
      if (active) { setNotebook(active); setSavedNotebook(active); setSelectedCellId(active.cells[0]?.id ?? null) }
    } catch {
      setSaveError(translate.current("ui.notebook.restoreError", { defaultValue: "Saved notebooks could not be read. Your browser data was left unchanged. Export current work before repairing browser storage." }))
    } finally { setStorageReady(true) }
  }, [scope])

  const unsaved = savedNotebook !== notebook && (!!savedNotebook || notebook.title !== "Untitled Notebook" || notebook.cells.some((cell) => cell.content.trim()))
  const navigationGuard = useUnsavedChangesGuard(unsaved)
  const openNotebook = (next: Notebook) => {
    setNotebook(next); setSavedNotebook(savedNotebooks.find((item) => item.id === next.id) === next ? next : null)
    setSelectedCellId(next.cells[0]?.id ?? null); setPendingOpen(null); setActiveTab("notebook"); setSaveError(null)
  }
  const requestOpen = (next: Notebook) => {
    if (unsaved) setPendingOpen(next)
    else openNotebook(next)
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error("File too large")
      const imported = importBrowserNotebook(await file.text())
      // Imports are new local work, never silent replacements of an existing notebook.
      requestOpen({ ...imported, id: generateId(), updatedAt: new Date() })
    } catch {
      setSaveError(t("ui.notebook.importError", { defaultValue: "This file is not a supported notebook (maximum 2 MB and 100 code or markdown cells). Your current notebook is unchanged." }))
    }
  }

  const handleSave = () => {
    setSaveError(null)
    try {
      if (!scope || !storageReady) throw new Error("Select an authorized company first")
      const snapshot = { ...notebook, updatedAt: new Date() }
      const catalog = saveBrowserNotebook(window.localStorage, scope, snapshot, savedNotebook)
      setSavedNotebooks(catalog.notebooks)
      setNotebook(snapshot)
      setSavedNotebook(snapshot)
    } catch {
      setSaveError(t("ui.notebook.saveError", { defaultValue: "Could not save in this browser. Your notebook is still open. Export a copy, or free browser storage and try again." }))
    }
  }

  const deleteSaved = () => {
    if (!scope || !pendingDelete) return
    try {
      const catalog = deleteBrowserNotebook(window.localStorage, scope, pendingDelete)
      setSavedNotebooks(catalog.notebooks)
      if (pendingDelete === notebook.id) setSavedNotebook(null)
      setPendingDelete(null); setSaveError(null)
    } catch {
      setSaveError(t("ui.notebook.deleteError", { defaultValue: "The saved copy could not be deleted. Your open notebook is unchanged." }))
    }
  }

  const handleExport = () => {
    const name = notebook.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "notebook"
    downloadTextFile(`${name}.json`, JSON.stringify(notebook, null, 2), "application/json")
  }
  const titleInputRef = useRef<HTMLInputElement>(null)

  const updateCell = useCallback((cellId: string, updates: Partial<NotebookCell>) => {
    setNotebook((prev) => ({
      ...prev,
      cells: prev.cells.map((c) => (c.id === cellId ? { ...c, ...updates, updatedAt: new Date() } : c)),
      updatedAt: new Date(),
    }))
  }, [])

  const addCell = useCallback((type: "code" | "markdown", afterId?: string) => {
    const newCell = createCell(type)
    setNotebook((prev) => {
      const index = afterId ? prev.cells.findIndex((c) => c.id === afterId) + 1 : prev.cells.length
      const newCells = [...prev.cells]
      newCells.splice(index, 0, newCell)
      return { ...prev, cells: newCells, updatedAt: new Date() }
    })
    setSelectedCellId(newCell.id)
  }, [])

  const deleteCell = useCallback((cellId: string) => {
    setNotebook((prev) => {
      if (prev.cells.length <= 1) return prev
      const newCells = prev.cells.filter((c) => c.id !== cellId)
      if (selectedCellId === cellId) {
        setSelectedCellId(newCells[0]?.id || null)
      }
      return { ...prev, cells: newCells, updatedAt: new Date() }
    })
  }, [selectedCellId])

  const moveCell = useCallback((cellId: string, direction: "up" | "down") => {
    setNotebook((prev) => {
      const index = prev.cells.findIndex((c) => c.id === cellId)
      if (index === -1) return prev
      if (direction === "up" && index === 0) return prev
      if (direction === "down" && index === prev.cells.length - 1) return prev
      
      const newCells = [...prev.cells]
      const newIndex = direction === "up" ? index - 1 : index + 1
      ;[newCells[index], newCells[newIndex]] = [newCells[newIndex], newCells[index]]
      return { ...prev, cells: newCells, updatedAt: new Date() }
    })
  }, [])

  const runCell = useCallback((_cellId: string) => {
    setSaveError(t("ui.notebook.executionUnavailable", { defaultValue: "Code execution is unavailable in this notebook. No code was run and no ERP data was read. Export your code to an appropriate runtime." }))
  }, [t])

  const runAllCells = () => runCell("")

  const clearAllOutputs = useCallback(() => {
    setNotebook((prev) => ({
      ...prev,
      cells: prev.cells.map((c) => ({ ...c, outputs: [], status: "idle" as const })),
    }))
    setKernel((prev) => ({ ...prev, executionCount: 0 }))
  }, [])

  const loadTemplate = (templateId: string) => {
    const template = reportTemplates.find((t) => t.id === templateId)
    if (!template) return

    const cells: NotebookCell[] = template.cells.map((c) => ({
      ...createCell(c.type as "code" | "markdown"),
      content: c.content || "",
    }))

    requestOpen({ ...newNotebook(), title: template.name, cells,
      metadata: { category: template.category }, updatedAt: new Date() })
  }

  const insertSnippet = useCallback((snippetKey: keyof typeof mlSnippets) => {
    if (!selectedCellId) return
    const cell = notebook.cells.find((c) => c.id === selectedCellId)
    if (!cell || cell.type !== "code") return
    
    updateCell(selectedCellId, {
      content: cell.content ? `${cell.content}\n\n${mlSnippets[snippetKey]}` : mlSnippets[snippetKey],
    })
  }, [selectedCellId, notebook.cells, updateCell])

  const handleAIAssist = useCallback((content: string) => {
    if (onAIChat) {
      onAIChat(`Help me with this Python code:\n\`\`\`python\n${content}\n\`\`\``)
    }
  }, [onAIChat])

  if (!open) return navigationGuard

  return (
    <div
      role="region"
      aria-label={t("ui.notebook.title", { defaultValue: "Notebook" })}
      data-testid="notebook-panel"
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-background border-l border-border",
        isFullscreen
          ? "fixed inset-0 z-50"
          : "fixed inset-0 z-50 h-dvh w-full sm:relative sm:inset-auto sm:h-screen sm:w-[32vw] sm:min-w-[400px] sm:shrink-0"
      )}
    >
      {navigationGuard}
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <BookOpen className="h-3.5 w-3.5 text-white" />
          </div>
          {isEditingTitle ? (
            <Input
              ref={titleInputRef}
              aria-label={t("ui.notebook.titleField", { defaultValue: "Notebook title" })}
              value={notebook.title}
              onChange={(e) => setNotebook((prev) => ({ ...prev, title: e.target.value }))}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
              className="h-7 w-48 text-sm"
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="min-w-0 truncate text-left text-sm font-medium hover:text-primary"
              aria-label={t("ui.notebook.rename", { defaultValue: "Rename notebook" })}
              onClick={() => setIsEditingTitle(true)}
            >
              {notebook.title}
            </button>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] h-4",
              kernel.status === "busy" && "bg-info/20 text-info border-info/50",
              kernel.status === "idle" && "bg-success/20 text-success border-success/50"
            )}
          >
            <Cpu className="h-2.5 w-2.5 mr-1" />
            {t("ui.notebook.editorOnly", { defaultValue: "Editor only" })}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled onClick={runAllCells} title="Code execution unavailable" aria-label="Code execution unavailable">
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearAllOutputs} title="Clear Outputs">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave} disabled={!scope || !storageReady} title={t("ui.notebook.save", { defaultValue: "Save notebook in this browser" })} aria-label={t("ui.notebook.save", { defaultValue: "Save notebook in this browser" })}>
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport} title="Export notebook" aria-label="Export notebook">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">{t("ui.notebook.browserHint", { defaultValue: "Saved notebooks stay in this browser for this company and user. They do not sync to your account." })}</p>
      {!scope ? <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">{t("ui.notebook.scopeRequired", { defaultValue: "Select an authorized operating company to save and reopen browser notebooks. You can still export this work." })}</p> : null}
      <p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">{t("ui.notebook.executionHint", { defaultValue: "Code editing only. No Python runtime or live ERP data connection is available here." })}</p>
      {pendingDelete ? <div role="alert" className="shrink-0 space-y-2 border-b p-3 text-sm">
        <p>{t("ui.notebook.deleteConfirm", { defaultValue: "Delete this saved browser copy? It cannot be recovered here. Your currently open edits stay available for export." })}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPendingDelete(null)}>{t("common.cancel", { defaultValue: "Cancel" })}</Button><Button size="sm" variant="destructive" onClick={deleteSaved}>{t("ui.notebook.deleteSaved", { defaultValue: "Delete saved copy" })}</Button></div>
      </div> : null}
      {pendingOpen ? <div role="alert" className="shrink-0 space-y-2 border-b p-3 text-sm">
        <p>{t("ui.notebook.replaceUnsaved", { defaultValue: "Opening another notebook replaces your unsaved edits. Save or export them first, or confirm discard." })}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPendingOpen(null)}>{t("ui.notebook.keepEditing", { defaultValue: "Keep editing" })}</Button><Button size="sm" variant="destructive" onClick={() => openNotebook(pendingOpen)}>{t("ui.notebook.discardAndOpen", { defaultValue: "Discard edits and open" })}</Button></div>
      </div> : null}
      {saveError ? <p role="alert" className="shrink-0 break-words px-3 py-2 text-sm text-destructive">{saveError}</p> : null}
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-1.5 border-b border-border bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => addCell("code", selectedCellId || undefined)}
        >
          <Plus className="h-3 w-3" />
          <Code className="h-3 w-3" />
          Code
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => addCell("markdown", selectedCellId || undefined)}
        >
          <Plus className="h-3 w-3" />
          <FileText className="h-3 w-3" />
          Markdown
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Layers className="h-3 w-3" />
              Templates
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {reportTemplates.map((template) => (
              <DropdownMenuItem key={template.id} onClick={() => loadTemplate(template.id)}>
                <BarChart3 className="h-3.5 w-3.5 mr-2" />
                <div>
                  <p className="text-xs font-medium">{template.name}</p>
                  <p className="text-[10px] text-muted-foreground">{template.description}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Terminal className="h-3 w-3" />
              Snippets
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => insertSnippet("imports")}>Import Libraries</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("loadData")}>Load Data</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("basicStats")}>Basic Statistics</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => insertSnippet("linearRegression")}>Linear Regression</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("forecast")}>Forecasting</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => insertSnippet("visualization")}>Visualization</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertSnippet("reportSummary")}>Report Summary</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <Badge variant="outline" className="text-[9px] h-5">
          <Database className="h-2.5 w-2.5 mr-1" />
          {t("ui.notebook.noDataConnection", { defaultValue: "No live data connection" })}
        </Badge>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-10 border-r border-border bg-muted/20 flex flex-col items-center py-2 gap-1">
          <Button
            variant={activeTab === "notebook" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTab("notebook")}
            title="Notebook"
          >
            <BookOpen className="h-4 w-4" />
          </Button>
          <Button
            variant={activeTab === "files" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTab("files")}
            title="Files"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button
            variant={activeTab === "variables" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTab("variables")}
            title="Variables"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === "notebook" && (
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3 max-w-4xl mx-auto">
                {notebook.cells.map((cell, index) => (
                  <NotebookCellComponent
                    key={cell.id}
                    cell={cell}
                    index={index}
                    isSelected={selectedCellId === cell.id}
                    onSelect={() => setSelectedCellId(cell.id)}
                    onUpdate={(updated) => updateCell(cell.id, updated)}
                    onDelete={() => deleteCell(cell.id)}
                    onMoveUp={() => moveCell(cell.id, "up")}
                    onMoveDown={() => moveCell(cell.id, "down")}
                    onRun={() => runCell(cell.id)}
                    executionAvailable={false}
                    onAIAssist={handleAIAssist}
                    canMoveUp={index > 0}
                    canMoveDown={index < notebook.cells.length - 1}
                  />
                ))}

                {/* Add cell button at bottom */}
                <div className="flex items-center justify-center gap-2 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => addCell("code")}
                  >
                    <Plus className="h-3 w-3" />
                    <Code className="h-3 w-3" />
                    Code
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => addCell("markdown")}
                  >
                    <Plus className="h-3 w-3" />
                    <FileText className="h-3 w-3" />
                    Markdown
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}

          {activeTab === "files" && (
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">{t("ui.notebook.savedNotebooks", { defaultValue: "Notebooks saved in this browser for this company and user" })}</p>
                <Button size="sm" variant="outline" onClick={() => requestOpen(newNotebook())}>{t("ui.notebook.new", { defaultValue: "New notebook" })}</Button>
                <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>{t("ui.notebook.import", { defaultValue: "Import notebook JSON" })}</Button>
                <input ref={importRef} type="file" accept=".json,application/json" className="sr-only" aria-label={t("ui.notebook.importFile", { defaultValue: "Notebook JSON file" })} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file) }} />
                {savedNotebooks.length === 0 ? <p className="text-xs text-muted-foreground">{t("ui.notebook.noSavedNotebooks", { defaultValue: "No saved notebooks in this scope. Save a notebook to reopen it here." })}</p> : savedNotebooks.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded border p-2">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:text-primary" onClick={() => requestOpen(item)}><File className="size-4 shrink-0" /><span className="min-w-0 break-words">{item.title || "Untitled Notebook"}</span></button>
                    <Button size="sm" variant="ghost" aria-label={`Delete saved notebook ${item.title}`} onClick={() => setPendingDelete(item.id)}>{t("common.delete", { defaultValue: "Delete" })}</Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {activeTab === "variables" && (
            <div className="p-4 text-sm text-muted-foreground">{t("ui.notebook.noRuntime", { defaultValue: "No runtime is connected. Variables and execution results are unavailable." })}</div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <div className={cn("w-1.5 h-1.5 rounded-full", kernel.status === "idle" ? "bg-success" : "bg-info")} />
            {t("ui.notebook.editorMode", { defaultValue: "Local notebook editor" })}
          </span>
          <span>{notebook.cells.length} cells</span>
        </div>
        <div className="flex items-center gap-3">
          <span role="status" data-testid="notebook-save-status" className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {saveError ? t("ui.notebook.saveFailed", { defaultValue: "Save failed" }) : savedNotebook === notebook ? t("ui.notebook.savedLocally", { defaultValue: "Saved in this browser" }) : savedNotebook ? t("ui.notebook.unsavedChanges", { defaultValue: "Unsaved changes" }) : t("ui.notebook.notSaved", { defaultValue: "Not saved" })}
          </span>
        </div>
      </div>
    </div>
  )
}
