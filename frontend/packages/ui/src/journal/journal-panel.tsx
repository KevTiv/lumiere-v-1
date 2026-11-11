"use client"

/** Minimal Web Speech API typing (Chrome `webkitSpeechRecognition`). */
interface WebkitSpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: WebkitSpeechRecognitionResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
interface WebkitSpeechRecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type PointerEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { browserWorkScope } from "../notebook/browser-notebooks"
import { readBrowserJournal, writeBrowserJournal } from "./browser-journal"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { useRBAC } from "@/lib/rbac-context"
import {
  X,
  Mic,
  MicOff,
  Send,
  Eye,
  CheckCircle,
  AlertTriangle,
  Lightbulb,
  Users,
  Bell,
  HelpCircle,
  GitBranch,
  Plus,
  Search,
  Filter,
  MoreHorizontal,
  Clock,
  Tag,
  Link2,
  Archive,
  CheckCircle2,
  Circle,
  Trash2,
  StickyNote,
  Move,
  Minus,
  Minimize2,
  Maximize2,
} from "lucide-react"
import {
  workNotesConfigs,
  defaultWorkNotesConfig,
  noteTypeConfig,
  notePriorityConfig,
  noteStatusConfig,
  type WorkNote,
  type NoteType,
  type NotePriority,
  type NoteStatus,
  type WorkNotesConfig,
} from "@/lib/journal-types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"
import { runtimeFormRoleId } from "@/lib/runtime-form-role"

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"

const MIN_WIDTH = 360
const MIN_HEIGHT = 320
const PANEL_MARGIN = 8
const INITIAL_BOUNDS: Bounds = { x: -1, y: -1, width: 480, height: 580 }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function fitBounds(bounds: Bounds, viewport: Bounds): Bounds {
  const width = clamp(bounds.width, 0, viewport.width - PANEL_MARGIN * 2)
  const height = clamp(bounds.height, 0, viewport.height - PANEL_MARGIN * 2)
  const left = viewport.x + PANEL_MARGIN
  const top = viewport.y + PANEL_MARGIN
  const right = viewport.x + viewport.width - PANEL_MARGIN
  const bottom = viewport.y + viewport.height - PANEL_MARGIN
  return {
    x: clamp(bounds.x < 0 ? right - width - 16 : bounds.x, left, right - width),
    y: clamp(bounds.y < 0 ? viewport.y + 80 : bounds.y, top, bottom - height),
    width,
    height,
  }
}

function resizeBounds(bounds: Bounds, viewport: Bounds, edge: ResizeEdge, dx: number, dy: number): Bounds {
  const left = viewport.x + PANEL_MARGIN
  const top = viewport.y + PANEL_MARGIN
  const right = viewport.x + viewport.width - PANEL_MARGIN
  const bottom = viewport.y + viewport.height - PANEL_MARGIN
  let { x, y, width, height } = bounds
  if (edge.includes("w")) {
    x = clamp(x + dx, left, x + width - Math.min(MIN_WIDTH, width))
    width -= x - bounds.x
  }
  if (edge.includes("e")) width = clamp(width + dx, Math.min(MIN_WIDTH, width), right - x)
  if (edge.includes("n")) {
    y = clamp(y + dy, top, y + height - Math.min(MIN_HEIGHT, height))
    height -= y - bounds.y
  }
  if (edge.includes("s")) height = clamp(height + dy, Math.min(MIN_HEIGHT, height), bottom - y)
  return fitBounds({ x, y, width, height }, viewport)
}

interface JournalPanelProps {
  open: boolean
  onClose: () => void
}

const noteTypeIcons: Record<NoteType, React.ReactNode> = {
  observation: <Eye className="h-4 w-4" />,
  "task-update": <CheckCircle className="h-4 w-4" />,
  blocker: <AlertTriangle className="h-4 w-4" />,
  idea: <Lightbulb className="h-4 w-4" />,
  "meeting-note": <Users className="h-4 w-4" />,
  reminder: <Bell className="h-4 w-4" />,
  question: <HelpCircle className="h-4 w-4" />,
  decision: <GitBranch className="h-4 w-4" />,
}

function formatTimeAgo(
  dateString: string,
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return t("ui.journal.time.justNow")
  if (diffMins < 60) return t("ui.journal.time.minutesAgo", { count: diffMins })
  if (diffHours < 24) return t("ui.journal.time.hoursAgo", { count: diffHours })
  if (diffDays < 7) return t("ui.journal.time.daysAgo", { count: diffDays })
  return date.toLocaleDateString(locale)
}

export function JournalPanel(props: JournalPanelProps) {
  const scope = browserWorkScope(useErpSession())
  return <ScopedJournalPanel key={scope ?? "no-scope"} {...props} scope={scope} />
}

function ScopedJournalPanel({ open, onClose, scope }: JournalPanelProps & { scope: string | null }) {
  const { t, i18n } = useTranslation()
  const { currentUser } = useRBAC()
  const [notes, setNotes] = useState<WorkNote[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const translate = useRef(t)
  translate.current = t
  useEffect(() => {
    if (!scope) { setStorageReady(true); return }
    try { setNotes(readBrowserJournal(window.localStorage, scope)) }
    catch { setStorageError(translate.current("ui.journal.restoreError", { defaultValue: "Saved browser notes could not be read. Existing storage was left unchanged." })) }
    finally { setStorageReady(true) }
  }, [scope])
  const saveNotes = (next: WorkNote[]): boolean => {
    try {
      if (!scope || !storageReady) throw new Error("Company context required")
      writeBrowserJournal(window.localStorage, scope, next, notes)
      setNotes(next); setStorageError(null); return true
    } catch {
      setStorageError(t("ui.journal.saveError", { defaultValue: "Notes could not be saved in this browser. Your entries are retained. Copy them before closing or repairing browser storage." }))
      return false
    }
  }
  const [isComposing, setIsComposing] = useState(false)
  const [selectedType, setSelectedType] = useState<NoteType>("observation")
  const [content, setContent] = useState("")
  const navigationGuard = useUnsavedChangesGuard(content.trim().length > 0)
  const [priority, setPriority] = useState<NotePriority>("normal")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [linkedTaskId, setLinkedTaskId] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterType, setFilterType] = useState<NoteType | "all">("all")
  const [filterStatus, setFilterStatus] = useState<NoteStatus | "all">("all")
  const [isRecording, setIsRecording] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<WebkitSpeechRecognitionInstance | null>(null)

  // Floating panel state
  const [preferredBounds, setPreferredBounds] = useState(INITIAL_BOUNDS)
  const [viewport, setViewport] = useState<Bounds | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const gesture = useRef<{ pointerId: number; x: number; y: number; bounds: Bounds; edge?: ResizeEdge } | null>(null)

  // Get role-based config
  const userRoleId = runtimeFormRoleId(currentUser) || "default"
  const config: WorkNotesConfig = workNotesConfigs[userRoleId] || defaultWorkNotesConfig
  const noteTypeLabels: Record<NoteType, string> = {
    observation: t("ui.journal.noteTypes.observation"),
    "task-update": t("ui.journal.noteTypes.taskUpdate"),
    blocker: t("ui.journal.noteTypes.blocker"),
    idea: t("ui.journal.noteTypes.idea"),
    "meeting-note": t("ui.journal.noteTypes.meetingNote"),
    reminder: t("ui.journal.noteTypes.reminder"),
    question: t("ui.journal.noteTypes.question"),
    decision: t("ui.journal.noteTypes.decision"),
  }
  const notePriorityLabels: Record<NotePriority, string> = {
    low: t("ui.journal.priorities.low"),
    normal: t("ui.journal.priorities.normal"),
    high: t("ui.journal.priorities.high"),
    urgent: t("ui.journal.priorities.urgent"),
  }
  const noteStatusLabels: Record<NoteStatus, string> = {
    active: t("ui.journal.statuses.active"),
    resolved: t("ui.journal.statuses.resolved"),
    archived: t("ui.journal.statuses.archived"),
  }
  const quickTemplateLabels: Record<string, string> = {
    "admin-obs": t("ui.journal.quickTemplates.adminObservation.label"),
    "admin-dec": t("ui.journal.quickTemplates.adminDecision.label"),
    "admin-block": t("ui.journal.quickTemplates.adminBlocker.label"),
    "mgr-meeting": t("ui.journal.quickTemplates.managerMeeting.label"),
    "mgr-update": t("ui.journal.quickTemplates.managerUpdate.label"),
    "mgr-decision": t("ui.journal.quickTemplates.managerDecision.label"),
    "sales-obs": t("ui.journal.quickTemplates.salesObservation.label"),
    "sales-update": t("ui.journal.quickTemplates.salesUpdate.label"),
    "sales-remind": t("ui.journal.quickTemplates.salesReminder.label"),
    "wh-obs": t("ui.journal.quickTemplates.warehouseObservation.label"),
    "wh-block": t("ui.journal.quickTemplates.warehouseBlocker.label"),
    "wh-update": t("ui.journal.quickTemplates.warehouseUpdate.label"),
    "view-obs": t("ui.journal.quickTemplates.viewerObservation.label"),
    "view-question": t("ui.journal.quickTemplates.viewerQuestion.label"),
    "view-idea": t("ui.journal.quickTemplates.viewerIdea.label"),
    "def-obs": t("ui.journal.quickTemplates.defaultObservation.label"),
    "def-update": t("ui.journal.quickTemplates.defaultUpdate.label"),
    "def-idea": t("ui.journal.quickTemplates.defaultIdea.label"),
  }
  const quickTemplatePlaceholders: Record<string, string> = {
    "admin-obs": t("ui.journal.quickTemplates.adminObservation.placeholder"),
    "admin-dec": t("ui.journal.quickTemplates.adminDecision.placeholder"),
    "admin-block": t("ui.journal.quickTemplates.adminBlocker.placeholder"),
    "mgr-meeting": t("ui.journal.quickTemplates.managerMeeting.placeholder"),
    "mgr-update": t("ui.journal.quickTemplates.managerUpdate.placeholder"),
    "mgr-decision": t("ui.journal.quickTemplates.managerDecision.placeholder"),
    "sales-obs": t("ui.journal.quickTemplates.salesObservation.placeholder"),
    "sales-update": t("ui.journal.quickTemplates.salesUpdate.placeholder"),
    "sales-remind": t("ui.journal.quickTemplates.salesReminder.placeholder"),
    "wh-obs": t("ui.journal.quickTemplates.warehouseObservation.placeholder"),
    "wh-block": t("ui.journal.quickTemplates.warehouseBlocker.placeholder"),
    "wh-update": t("ui.journal.quickTemplates.warehouseUpdate.placeholder"),
    "view-obs": t("ui.journal.quickTemplates.viewerObservation.placeholder"),
    "view-question": t("ui.journal.quickTemplates.viewerQuestion.placeholder"),
    "view-idea": t("ui.journal.quickTemplates.viewerIdea.placeholder"),
    "def-obs": t("ui.journal.quickTemplates.defaultObservation.placeholder"),
    "def-update": t("ui.journal.quickTemplates.defaultUpdate.placeholder"),
    "def-idea": t("ui.journal.quickTemplates.defaultIdea.placeholder"),
  }

  // Filter notes
  const filteredNotes = notes.filter((note) => {
    if (filterType !== "all" && note.type !== filterType) return false
    if (filterStatus !== "all" && note.status !== filterStatus) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        note.content.toLowerCase().includes(query) ||
        note.tags.some((t) => t.toLowerCase().includes(query))
      )
    }
    return true
  })

  // Clamping the rendered bounds keeps the user's preferred size and position
  // available when the viewport grows again or the panel is restored.
  useEffect(() => {
    if (!open) return
    const visual = window.visualViewport
    const update = () => setViewport({
      x: visual?.offsetLeft ?? 0,
      y: visual?.offsetTop ?? 0,
      width: visual?.width ?? window.innerWidth,
      height: visual?.height ?? window.innerHeight,
    })
    update()
    window.addEventListener("resize", update)
    visual?.addEventListener("resize", update)
    visual?.addEventListener("scroll", update)
    return () => {
      window.removeEventListener("resize", update)
      visual?.removeEventListener("resize", update)
      visual?.removeEventListener("scroll", update)
    }
  }, [open])

  const desiredBounds = viewport && isMaximized
    ? { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }
    : isMinimized ? { ...preferredBounds, width: 320, height: 46 } : preferredBounds
  const bounds = viewport ? fitBounds(desiredBounds, viewport) : desiredBounds

  function startGesture(event: PointerEvent<HTMLElement>, edge?: ResizeEdge) {
    if (!viewport || isMaximized || !event.isPrimary || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, bounds, edge }
    setIsDragging(true)
  }

  function movePanel(start: Bounds, visibleViewport: Bounds, dx: number, dy: number) {
    const next = fitBounds({
      ...start,
      x: Math.max(visibleViewport.x, start.x + dx),
      y: Math.max(visibleViewport.y, start.y + dy),
    }, visibleViewport)
    setPreferredBounds((previous) => ({ ...previous, x: next.x, y: next.y }))
  }

  function moveGesture(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current
    if (!viewport || !current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (current.edge) setPreferredBounds(resizeBounds(current.bounds, viewport, current.edge, dx, dy))
    else movePanel(current.bounds, viewport, dx, dy)
  }

  function endGesture(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null
    setIsDragging(false)
  }

  function handleGeometryKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!viewport || isMaximized) return
    const step = 16
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
    if (!dx && !dy) return
    event.preventDefault()
    if (event.shiftKey) {
      if (!isMinimized) setPreferredBounds(resizeBounds(bounds, viewport, "se", dx, dy))
    } else movePanel(bounds, viewport, dx, dy)
  }

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized)
    setIsMinimized(false)
  }

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized)
    setIsMaximized(false)
  }

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
      const Ctor = (
        window as unknown as {
          webkitSpeechRecognition: new () => WebkitSpeechRecognitionInstance
        }
      ).webkitSpeechRecognition
      recognitionRef.current = new Ctor()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true

      recognitionRef.current.onresult = (event: WebkitSpeechRecognitionResultEvent) => {
        let transcript = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        setContent((prev) => prev + " " + transcript)
      }

      recognitionRef.current.onerror = () => setIsRecording(false)
      recognitionRef.current.onend = () => setIsRecording(false)
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (!recognitionRef.current) return
    if (isRecording) {
      recognitionRef.current.stop()
      setIsRecording(false)
    } else {
      recognitionRef.current.start()
      setIsRecording(true)
    }
  }, [isRecording])

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
    }
    setTagInput("")
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleSubmit = () => {
    if (!content.trim()) return

    const newNote: WorkNote = {
      id: `note-${crypto.randomUUID()}`,
      userId: currentUser?.id || "unknown",
      type: selectedType,
      content: content.trim(),
      priority,
      status: "active",
      linkedTaskId: linkedTaskId || undefined,
      linkedTaskTitle: linkedTaskId ? `Task ${linkedTaskId}` : undefined,
      tags,
      mentions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (saveNotes([newNote, ...notes])) resetForm()
  }

  const resetForm = () => {
    setContent("")
    setPriority(config.defaultPriority)
    setTags([])
    setLinkedTaskId("")
    setIsComposing(false)
  }

  const handleUpdateStatus = (noteId: string, newStatus: NoteStatus) => {
    saveNotes(notes.map((note) => {
      if (note.id === noteId) {
        return {
          ...note,
          status: newStatus,
          updatedAt: new Date().toISOString(),
          resolvedAt: newStatus === "resolved" ? new Date().toISOString() : note.resolvedAt,
        }
      }
      return note
    }))
  }

  const handleDeleteNote = (noteId: string) => {
    saveNotes(notes.filter((note) => note.id !== noteId))
  }

  const handleQuickNote = (type: NoteType) => {
    setSelectedType(type)
    setIsComposing(true)
    setTimeout(() => textareaRef.current?.focus(), 100)
  }

  if (!open) return navigationGuard

  return (
    <div
      role="region"
      aria-label={t("ui.journal.title")}
      data-testid="journal-panel"
      className={cn(
        "fixed bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden",
        "transition-shadow duration-200",
        isDragging && "shadow-2xl shadow-amber-500/20"
      )}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      style={{
        left: viewport ? bounds.x : PANEL_MARGIN,
        top: viewport ? bounds.y : PANEL_MARGIN,
        maxWidth: viewport ? undefined : "calc(100vw - 16px)",
        maxHeight: viewport ? undefined : "calc(100dvh - 16px)",
        width: bounds.width,
        height: bounds.height,
      }}
    >
      {/* Resize handles */}
      {!isMinimized && !isMaximized && (
        <>
          <div className="absolute top-0 left-0 w-3 h-3 touch-none cursor-nw-resize z-10" onPointerDown={(event) => startGesture(event, "nw")} />
          <div className="absolute top-0 right-0 w-3 h-3 touch-none cursor-ne-resize z-10" onPointerDown={(event) => startGesture(event, "ne")} />
          <div className="absolute bottom-0 left-0 w-3 h-3 touch-none cursor-sw-resize z-10" onPointerDown={(event) => startGesture(event, "sw")} />
          <div className="absolute bottom-0 right-0 w-3 h-3 touch-none cursor-se-resize z-10" onPointerDown={(event) => startGesture(event, "se")} />
          <div className="absolute top-0 left-3 right-3 h-1 touch-none cursor-n-resize" onPointerDown={(event) => startGesture(event, "n")} />
          <div className="absolute bottom-0 left-3 right-3 h-1 touch-none cursor-s-resize" onPointerDown={(event) => startGesture(event, "s")} />
          <div className="absolute left-0 top-3 bottom-3 w-1 touch-none cursor-w-resize" onPointerDown={(event) => startGesture(event, "w")} />
          <div className="absolute right-0 top-3 bottom-3 w-1 touch-none cursor-e-resize" onPointerDown={(event) => startGesture(event, "e")} />
        </>
      )}

      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-2 py-2 border-b border-border bg-card/50 select-none shrink-0",
          isMinimized && "border-b-0"
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Drag handle */}
          <button
            type="button"
            disabled={isMaximized}
            title={t("ui.journal.actions.geometryHelp", { defaultValue: "Use arrow keys to move. Hold Shift to resize." })}
            aria-label={t("ui.journal.actions.adjustPosition", { defaultValue: "Move or resize Journal" })}
            aria-description={t("ui.journal.actions.geometryHelp", { defaultValue: "Use arrow keys to move. Hold Shift to resize." })}
            onPointerDown={(event) => startGesture(event)}
            onKeyDown={handleGeometryKey}
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded-md transition-colors shrink-0 touch-none focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50",
              "hover:bg-muted text-muted-foreground hover:text-foreground",
              isDragging ? "bg-primary/10 text-primary cursor-grabbing" : "cursor-grab"
            )}
          >
            <Move className="h-3.5 w-3.5" />
          </button>
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
            <StickyNote className="h-3 w-3 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{t("ui.journal.title")}</h2>
            {!isMinimized && (
              <p className="text-[10px] text-muted-foreground truncate">{t("ui.journal.subtitle")}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={toggleMinimize} className="h-7 w-7" title={t("ui.journal.actions.minimize")} aria-label={t("ui.journal.actions.minimize")}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleMaximize} className="h-7 w-7" title={isMaximized ? t("ui.journal.actions.restore") : t("ui.journal.actions.maximize")} aria-label={isMaximized ? t("ui.journal.actions.restore") : t("ui.journal.actions.maximize")}>
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" title={t("common.close")} aria-label={t("common.close")}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {navigationGuard}
      {/* Panel body — hidden when minimized */}
      {!isMinimized && (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]" data-testid="journal-scroll-body">
          <p className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">{scope
            ? t("ui.journal.browserHint", { defaultValue: "Personal working notes are saved in this browser for this company and user. They do not sync to your account and are not accounting journal entries." })
            : t("ui.journal.scopeRequired", { defaultValue: "Select an authorized operating company to save personal browser notes. These notes are not accounting journal entries." })}</p>
          {storageError ? <p role="alert" className="shrink-0 break-words px-4 py-2 text-xs text-destructive">{storageError}</p> : null}
          {/* Quick action bar */}
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t("ui.journal.quickAdd")}</span>
              <div className="flex flex-wrap gap-1.5">
                {config.quickTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleQuickNote(template.type)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors",
                      noteTypeConfig[template.type].bgColor,
                      "hover:opacity-80"
                    )}
                  >
                    {noteTypeIcons[template.type]}
                    <span>{quickTemplateLabels[template.id] ?? template.label}</span>
                  </button>
                ))}
                <button
                  onClick={() => setIsComposing(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-dashed border-border hover:border-primary/50 hover:bg-muted/50 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  <span>{t("ui.journal.other")}</span>
                </button>
              </div>
            </div>

            {/* Search and filter */}
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("ui.journal.searchPlaceholder")}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter className="h-3 w-3" />
                    {t("ui.journal.filter")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("ui.journal.type")}</div>
                  <DropdownMenuItem onClick={() => setFilterType("all")}>
                    <Circle className={cn("h-3 w-3 mr-2", filterType === "all" && "text-primary")} />
                    {t("ui.journal.allTypes")}
                  </DropdownMenuItem>
                  {Object.entries(noteTypeConfig).map(([type, config]) => (
                    <DropdownMenuItem key={type} onClick={() => setFilterType(type as NoteType)}>
                      <span className={cn("mr-2", config.color)}>{noteTypeIcons[type as NoteType]}</span>
                      {noteTypeLabels[type as NoteType]}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("ui.journal.status")}</div>
                  <DropdownMenuItem onClick={() => setFilterStatus("all")}>
                    <Circle className={cn("h-3 w-3 mr-2", filterStatus === "all" && "text-primary")} />
                    {t("ui.journal.allStatuses")}
                  </DropdownMenuItem>
                  {Object.entries(noteStatusConfig).map(([status, config]) => (
                    <DropdownMenuItem key={status} onClick={() => setFilterStatus(status as NoteStatus)}>
                      <span className={cn("h-3 w-3 mr-2", config.color)}>
                        {status === "active" ? <Circle className="h-3 w-3" /> :
                          status === "resolved" ? <CheckCircle2 className="h-3 w-3" /> :
                            <Archive className="h-3 w-3" />}
                      </span>
                      {noteStatusLabels[status as NoteStatus]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Compose area */}
          {isComposing && (
            <div className="px-4 py-3 border-b border-border bg-card">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                  noteTypeConfig[selectedType].bgColor
                )}>
                  <span className={noteTypeConfig[selectedType].color}>
                    {noteTypeIcons[selectedType]}
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Type selector */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {Object.entries(noteTypeConfig).map(([type, typeConfig]) => (
                      <button
                        key={type}
                        onClick={() => setSelectedType(type as NoteType)}
                        className={cn(
                          "px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                          selectedType === type
                            ? cn(typeConfig.bgColor, typeConfig.color, "font-medium")
                            : "border-border text-muted-foreground hover:border-primary/30"
                        )}
                      >
                        {noteTypeLabels[type as NoteType]}
                      </button>
                    ))}
                  </div>

                  {/* Content */}
                  <div className="relative">
                    <Textarea
                      aria-label={t("ui.journal.content", { defaultValue: "Working note" })}
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={(() => {
                        const template = config.quickTemplates.find((template) => template.type === selectedType)
                        return template
                          ? (quickTemplatePlaceholders[template.id] ?? template.placeholder)
                          : t("ui.journal.notePlaceholder")
                      })()}
                      rows={3}
                      className="resize-none text-sm pr-10"
                      autoFocus
                    />
                    {config.enableVoiceInput && (
                      <Button
                        variant={isRecording ? "destructive" : "ghost"}
                        size="icon"
                        onClick={toggleRecording}
                        className="absolute right-2 bottom-2 h-7 w-7"
                        title={isRecording ? t("ui.journal.actions.stopRecording") : t("ui.journal.actions.startRecording")}
                        aria-label={isRecording ? t("ui.journal.actions.stopRecording") : t("ui.journal.actions.startRecording")}
                      >
                        {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>

                  {/* Options row */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Priority */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">{t("ui.journal.priority")}</span>
                      {Object.entries(notePriorityConfig).map(([p, pConfig]) => (
                        <button
                          key={p}
                          onClick={() => setPriority(p as NotePriority)}
                          className={cn(
                            "w-2 h-2 rounded-full transition-all",
                            pConfig.dotColor,
                            priority === p ? "ring-2 ring-offset-1 ring-primary" : "opacity-40 hover:opacity-70"
                          )}
                          title={notePriorityLabels[p as NotePriority]}
                          aria-label={notePriorityLabels[p as NotePriority]}
                        />
                      ))}
                    </div>

                    {/* Tags */}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="h-auto min-h-5 max-w-full cursor-pointer gap-1 whitespace-normal px-1.5 py-0 text-[10px] hover:bg-destructive/20"
                            onClick={() => handleRemoveTag(tag)}
                          >
                            #{tag}
                            <X className="h-2 w-2 shrink-0" />
                          </Badge>
                        ))}
                        <Input
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault()
                              handleAddTag(tagInput)
                            }
                          }}
                          placeholder={t("ui.journal.addTagPlaceholder")}
                          className="h-5 w-16 text-[10px] px-1.5 border-dashed"
                        />
                      </div>
                    </div>

                    {/* Suggested tags */}
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {config.suggestedTags.slice(0, 4).map((tag) => (
                        !tags.includes(tag) && (
                          <button
                            key={tag}
                            onClick={() => handleAddTag(tag)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            +{tag}
                          </button>
                        )
                      ))}
                    </div>
                  </div>

                  {/* Link to task */}
                  {config.enableTaskLinking && (
                    <div className="flex items-center gap-2">
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                      <Input
                        value={linkedTaskId}
                        onChange={(e) => setLinkedTaskId(e.target.value)}
                        placeholder={t("ui.journal.linkTaskPlaceholder")}
                        className="h-6 text-[10px] flex-1 max-w-48"
                      />
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={resetForm} className="h-7 text-xs">
                      {t("common.cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSubmit} disabled={!content.trim() || !scope || !storageReady} className="h-7 text-xs gap-1.5">
                      <Send className="h-3 w-3" />
                      {t("ui.journal.actions.saveNote")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notes list */}
          <div className="space-y-2 p-4">
            {filteredNotes.length === 0 ? (
              <div className="text-center py-12">
                <StickyNote className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">{t("ui.journal.empty.title")}</p>
                <p className="text-xs text-muted-foreground/70">{t("ui.journal.empty.description")}</p>
              </div>
            ) : (
              filteredNotes.map((note) => (
                <div
                  key={note.id}
                  className={cn(
                    "p-3 rounded-lg border transition-colors",
                    note.status === "resolved" && "opacity-60",
                    note.status === "archived" && "opacity-40",
                    noteTypeConfig[note.type].bgColor
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5", noteTypeConfig[note.type].color)}>
                      {noteTypeIcons[note.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="h-auto min-h-4 max-w-full whitespace-normal px-1.5 py-0 text-[10px]">
                          {noteTypeLabels[note.type]}
                        </Badge>
                        {note.priority !== "normal" && (
                          <span className={cn("flex items-center gap-1 text-[10px]", notePriorityConfig[note.priority].color)}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", notePriorityConfig[note.priority].dotColor)} />
                            {notePriorityLabels[note.priority]}
                          </span>
                        )}
                        {note.linkedTaskId && (
                          <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                            <Link2 className="h-2.5 w-2.5 shrink-0" />
                            {note.linkedTaskId}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatTimeAgo(note.createdAt, t, i18n.resolvedLanguage ?? i18n.language)}
                        </span>
                      </div>
                      <p className={cn(
                        "text-sm leading-relaxed",
                        note.status === "resolved" && "line-through"
                      )}>
                        {note.content}
                      </p>
                      {note.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {note.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="h-auto min-h-4 max-w-full whitespace-normal px-1.5 py-0 text-[10px]">
                              #{tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">{t("ui.journal.actions.noteMenu")}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {note.status === "active" && (
                          <DropdownMenuItem onClick={() => handleUpdateStatus(note.id, "resolved")}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                            {t("ui.journal.actions.markResolved")}
                          </DropdownMenuItem>
                        )}
                        {note.status === "resolved" && (
                          <DropdownMenuItem onClick={() => handleUpdateStatus(note.id, "active")}>
                            <Circle className="h-3.5 w-3.5 mr-2" />
                            {t("ui.journal.actions.reopen")}
                          </DropdownMenuItem>
                        )}
                        {note.status !== "archived" && (
                          <DropdownMenuItem onClick={() => handleUpdateStatus(note.id, "archived")}>
                            <Archive className="h-3.5 w-3.5 mr-2" />
                            {t("ui.journal.actions.archive")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDeleteNote(note.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer stats */}
          <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground shrink-0">
            <span>{t("ui.journal.stats.activeNotes", { count: filteredNotes.filter(n => n.status === "active").length })}</span>
            <span>{t("ui.journal.stats.resolvedToday", { count: notes.filter(n => n.status === "resolved").length })}</span>
          </div>
        </div>
      )}
    </div>
  )
}
