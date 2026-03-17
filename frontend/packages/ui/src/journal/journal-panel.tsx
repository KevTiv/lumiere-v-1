"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  priorityConfig,
  statusConfig,
  sampleWorkNotes,
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

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const MIN_WIDTH = 360
const MIN_HEIGHT = 320
const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 580

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

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function JournalPanel({ open, onClose }: JournalPanelProps) {
  const { currentUser } = useRBAC()
  const [notes, setNotes] = useState<WorkNote[]>(sampleWorkNotes)
  const [isComposing, setIsComposing] = useState(false)
  const [selectedType, setSelectedType] = useState<NoteType>("observation")
  const [content, setContent] = useState("")
  const [priority, setPriority] = useState<NotePriority>("normal")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [linkedTaskId, setLinkedTaskId] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterType, setFilterType] = useState<NoteType | "all">("all")
  const [filterStatus, setFilterStatus] = useState<NoteStatus | "all">("all")
  const [isRecording, setIsRecording] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  // Floating panel state
  const [position, setPosition] = useState<Position>({ x: -1, y: -1 })
  const [size, setSize] = useState<Size>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [prevState, setPrevState] = useState<{ position: Position; size: Size } | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number }>({ x: 0, y: 0, posX: 0, posY: 0 })
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number; posX: number; posY: number }>({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 })

  // Get role-based config
  const userRoleId = currentUser?.roles[0] || "default"
  const config: WorkNotesConfig = workNotesConfigs[userRoleId] || defaultWorkNotesConfig

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

  // Initialize position on first open
  useEffect(() => {
    if (open && position.x === -1) {
      setPosition({
        x: window.innerWidth - DEFAULT_WIDTH - 24,
        y: 80,
      })
    }
  }, [open, position.x])

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    }
  }, [position, isMaximized])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStartRef.current.x
        const dy = e.clientY - dragStartRef.current.y
        const newX = Math.max(0, Math.min(window.innerWidth - size.width, dragStartRef.current.posX + dx))
        const newY = Math.max(0, Math.min(window.innerHeight - 60, dragStartRef.current.posY + dy))
        setPosition({ x: newX, y: newY })
      }

      if (isResizing) {
        const dx = e.clientX - resizeStartRef.current.x
        const dy = e.clientY - resizeStartRef.current.y

        let newWidth = resizeStartRef.current.width
        let newHeight = resizeStartRef.current.height
        let newX = position.x
        let newY = position.y

        if (isResizing.includes("e")) newWidth = Math.max(MIN_WIDTH, resizeStartRef.current.width + dx)
        if (isResizing.includes("w")) {
          const widthDelta = Math.min(dx, resizeStartRef.current.width - MIN_WIDTH)
          newWidth = resizeStartRef.current.width - widthDelta
          newX = resizeStartRef.current.posX + widthDelta
        }
        if (isResizing.includes("s")) newHeight = Math.max(MIN_HEIGHT, resizeStartRef.current.height + dy)
        if (isResizing.includes("n")) {
          const heightDelta = Math.min(dy, resizeStartRef.current.height - MIN_HEIGHT)
          newHeight = resizeStartRef.current.height - heightDelta
          newY = resizeStartRef.current.posY + heightDelta
        }

        setSize({ width: newWidth, height: newHeight })
        if (isResizing.includes("w") || isResizing.includes("n")) {
          setPosition({ x: newX, y: newY })
        }
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(null)
    }

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      return () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }
    }
  }, [isDragging, isResizing, size.width, position.x, position.y])

  const handleResizeStart = useCallback((direction: string) => (e: React.MouseEvent) => {
    if (isMaximized) return
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(direction)
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y,
    }
  }, [size, position, isMaximized])

  const toggleMaximize = () => {
    if (isMaximized) {
      if (prevState) {
        setPosition(prevState.position)
        setSize(prevState.size)
      }
      setIsMaximized(false)
    } else {
      setPrevState({ position, size })
      setPosition({ x: 20, y: 20 })
      setSize({ width: window.innerWidth - 40, height: window.innerHeight - 40 })
      setIsMaximized(true)
    }
    setIsMinimized(false)
  }

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized)
    setIsMaximized(false)
  }

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
      const SpeechRecognition = window.webkitSpeechRecognition
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true

      recognitionRef.current.onresult = (event) => {
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
      id: `note-${Date.now()}`,
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

    setNotes([newNote, ...notes])
    resetForm()
  }

  const resetForm = () => {
    setContent("")
    setPriority(config.defaultPriority)
    setTags([])
    setLinkedTaskId("")
    setIsComposing(false)
  }

  const handleUpdateStatus = (noteId: string, newStatus: NoteStatus) => {
    setNotes(notes.map((note) => {
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
    setNotes(notes.filter((note) => note.id !== noteId))
  }

  const handleQuickNote = (type: NoteType) => {
    setSelectedType(type)
    setIsComposing(true)
    setTimeout(() => textareaRef.current?.focus(), 100)
  }

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden",
        "transition-shadow duration-200",
        isDragging && "shadow-2xl shadow-amber-500/20",
        isMinimized && "!h-auto"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? 320 : size.width,
        height: isMinimized ? "auto" : size.height,
      }}
    >
      {/* Resize handles */}
      {!isMinimized && !isMaximized && (
        <>
          <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-10" onMouseDown={handleResizeStart("nw")} />
          <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-10" onMouseDown={handleResizeStart("ne")} />
          <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-10" onMouseDown={handleResizeStart("sw")} />
          <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-10" onMouseDown={handleResizeStart("se")} />
          <div className="absolute top-0 left-3 right-3 h-1 cursor-n-resize" onMouseDown={handleResizeStart("n")} />
          <div className="absolute bottom-0 left-3 right-3 h-1 cursor-s-resize" onMouseDown={handleResizeStart("s")} />
          <div className="absolute left-0 top-3 bottom-3 w-1 cursor-w-resize" onMouseDown={handleResizeStart("w")} />
          <div className="absolute right-0 top-3 bottom-3 w-1 cursor-e-resize" onMouseDown={handleResizeStart("e")} />
        </>
      )}

      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-2 py-2 border-b border-border bg-card/50 select-none shrink-0",
          isMinimized && "border-b-0"
        )}
      >
        <div className="flex items-center gap-1.5">
          {/* Drag handle */}
          <button
            title="Drag to move"
            onMouseDown={handleDragStart}
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded-md transition-colors shrink-0",
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
            <h2 className="text-sm font-semibold truncate">Work Notes</h2>
            {!isMinimized && (
              <p className="text-[10px] text-muted-foreground truncate">Quick notes, observations & updates</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={toggleMinimize} className="h-7 w-7" title="Minimize">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleMaximize} className="h-7 w-7" title={isMaximized ? "Restore" : "Maximize"}>
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Panel body — hidden when minimized */}
      {!isMinimized && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Quick action bar */}
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-medium text-muted-foreground">Quick add:</span>
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
                    <span>{template.label}</span>
                  </button>
                ))}
                <button
                  onClick={() => setIsComposing(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-dashed border-border hover:border-primary/50 hover:bg-muted/50 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  <span>Other</span>
                </button>
              </div>
            </div>

            {/* Search and filter */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search notes..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter className="h-3 w-3" />
                    Filter
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Type</div>
                  <DropdownMenuItem onClick={() => setFilterType("all")}>
                    <Circle className={cn("h-3 w-3 mr-2", filterType === "all" && "text-primary")} />
                    All Types
                  </DropdownMenuItem>
                  {Object.entries(noteTypeConfig).map(([type, config]) => (
                    <DropdownMenuItem key={type} onClick={() => setFilterType(type as NoteType)}>
                      <span className={cn("mr-2", config.color)}>{noteTypeIcons[type as NoteType]}</span>
                      {config.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Status</div>
                  <DropdownMenuItem onClick={() => setFilterStatus("all")}>
                    <Circle className={cn("h-3 w-3 mr-2", filterStatus === "all" && "text-primary")} />
                    All Status
                  </DropdownMenuItem>
                  {Object.entries(statusConfig).map(([status, config]) => (
                    <DropdownMenuItem key={status} onClick={() => setFilterStatus(status as NoteStatus)}>
                      <span className={cn("h-3 w-3 mr-2", config.color)}>
                        {status === "active" ? <Circle className="h-3 w-3" /> :
                          status === "resolved" ? <CheckCircle2 className="h-3 w-3" /> :
                            <Archive className="h-3 w-3" />}
                      </span>
                      {config.label}
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
                <div className="flex-1 space-y-2">
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
                        {typeConfig.label}
                      </button>
                    ))}
                  </div>

                  {/* Content */}
                  <div className="relative">
                    <Textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={config.quickTemplates.find(t => t.type === selectedType)?.placeholder || "Write your note..."}
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
                      >
                        {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>

                  {/* Options row */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Priority */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Priority:</span>
                      {Object.entries(priorityConfig).map(([p, pConfig]) => (
                        <button
                          key={p}
                          onClick={() => setPriority(p as NotePriority)}
                          className={cn(
                            "w-2 h-2 rounded-full transition-all",
                            pConfig.dotColor,
                            priority === p ? "ring-2 ring-offset-1 ring-primary" : "opacity-40 hover:opacity-70"
                          )}
                          title={pConfig.label}
                        />
                      ))}
                    </div>

                    {/* Tags */}
                    <div className="flex items-center gap-1.5 flex-1">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      <div className="flex items-center gap-1 flex-wrap">
                        {tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-5 gap-1 cursor-pointer hover:bg-destructive/20"
                            onClick={() => handleRemoveTag(tag)}
                          >
                            #{tag}
                            <X className="h-2 w-2" />
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
                          placeholder="add tag"
                          className="h-5 w-16 text-[10px] px-1.5 border-dashed"
                        />
                      </div>
                    </div>

                    {/* Suggested tags */}
                    <div className="flex items-center gap-1">
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
                        placeholder="Link to task ID (optional)"
                        className="h-6 text-[10px] flex-1 max-w-48"
                      />
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={resetForm} className="h-7 text-xs">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSubmit} disabled={!content.trim()} className="h-7 text-xs gap-1.5">
                      <Send className="h-3 w-3" />
                      Save Note
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notes list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-2">
              {filteredNotes.length === 0 ? (
                <div className="text-center py-12">
                  <StickyNote className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No notes yet</p>
                  <p className="text-xs text-muted-foreground/70">Use the quick actions above to add your first note</p>
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
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            {noteTypeConfig[note.type].label}
                          </Badge>
                          {note.priority !== "normal" && (
                            <span className={cn("flex items-center gap-1 text-[10px]", priorityConfig[note.priority].color)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", priorityConfig[note.priority].dotColor)} />
                              {priorityConfig[note.priority].label}
                            </span>
                          )}
                          {note.linkedTaskId && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Link2 className="h-2.5 w-2.5" />
                              {note.linkedTaskId}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {formatTimeAgo(note.createdAt)}
                          </span>
                        </div>
                        <p className={cn(
                          "text-sm leading-relaxed",
                          note.status === "resolved" && "line-through"
                        )}>
                          {note.content}
                        </p>
                        {note.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            {note.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {note.status === "active" && (
                            <DropdownMenuItem onClick={() => handleUpdateStatus(note.id, "resolved")}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                              Mark Resolved
                            </DropdownMenuItem>
                          )}
                          {note.status === "resolved" && (
                            <DropdownMenuItem onClick={() => handleUpdateStatus(note.id, "active")}>
                              <Circle className="h-3.5 w-3.5 mr-2" />
                              Reopen
                            </DropdownMenuItem>
                          )}
                          {note.status !== "archived" && (
                            <DropdownMenuItem onClick={() => handleUpdateStatus(note.id, "archived")}>
                              <Archive className="h-3.5 w-3.5 mr-2" />
                              Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeleteNote(note.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Footer stats */}
          <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground shrink-0">
            <span>{filteredNotes.filter(n => n.status === "active").length} active notes</span>
            <span>{notes.filter(n => n.status === "resolved").length} resolved today</span>
          </div>
        </div>
      )}
    </div>
  )
}
