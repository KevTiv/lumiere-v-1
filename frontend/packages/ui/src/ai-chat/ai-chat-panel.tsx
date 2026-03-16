"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  X,
  Send,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  Loader2,
  TrendingUp,
  Package,
  Users,
  FileText,
  PlusCircle,
  Edit,
  Trash,
  Download,
  Layout,
  CheckSquare,
  User,
  HelpCircle,
  BookOpen,
  AtSign,
  Command,
  GripVertical,
  Minimize2,
  Maximize2,
  Minus,
  Move,
  ChevronsUpDown,
  PanelRight,
  PanelRightClose,
} from "lucide-react"
import type { ChatMessage, AtCommand, AIChatConfig } from "@/lib/ai-chat-types"
import { defaultAtCommands } from "@/lib/ai-chat-types"

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
  docked?: boolean
  onDockToggle?: () => void
  config?: Partial<AIChatConfig>
  context?: {
    activeView?: string
    selectedData?: unknown
  }
}

const iconMap: Record<string, React.ReactNode> = {
  "trending-up": <TrendingUp className="h-4 w-4" />,
  "package": <Package className="h-4 w-4" />,
  "users": <Users className="h-4 w-4" />,
  "file-text": <FileText className="h-4 w-4" />,
  "plus-circle": <PlusCircle className="h-4 w-4" />,
  "edit": <Edit className="h-4 w-4" />,
  "trash": <Trash className="h-4 w-4" />,
  "download": <Download className="h-4 w-4" />,
  "layout": <Layout className="h-4 w-4" />,
  "check-square": <CheckSquare className="h-4 w-4" />,
  "user": <User className="h-4 w-4" />,
  "help-circle": <HelpCircle className="h-4 w-4" />,
  "book-open": <BookOpen className="h-4 w-4" />,
}

const categoryColors: Record<string, string> = {
  data: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  action: "bg-green-500/20 text-green-400 border-green-500/30",
  context: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  help: "bg-orange-500/20 text-orange-400 border-orange-500/30",
}

const MIN_WIDTH = 320
const MIN_HEIGHT = 300
const DEFAULT_WIDTH = 400
const DEFAULT_HEIGHT = 500

export function AIChatPanel({ open, onClose, docked = false, onDockToggle, config, context }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const [commandFilter, setCommandFilter] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  
  // Floating panel state
  const [position, setPosition] = useState<Position>({ x: -1, y: -1 })
  const [size, setSize] = useState<Size>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [prevState, setPrevState] = useState<{ position: Position; size: Size } | null>(null)
  
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number }>({ x: 0, y: 0, posX: 0, posY: 0 })
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number; posX: number; posY: number }>({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 })

  const commands = config?.commands || defaultAtCommands

  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(commandFilter.toLowerCase()) ||
      cmd.description.toLowerCase().includes(commandFilter.toLowerCase()) ||
      cmd.keywords.some((k) => k.toLowerCase().includes(commandFilter.toLowerCase()))
  )

  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = []
    acc[cmd.category].push(cmd)
    return acc
  }, {} as Record<string, AtCommand[]>)

  // Initialize position on first open
  useEffect(() => {
    if (open && position.x === -1) {
      setPosition({
        x: window.innerWidth - DEFAULT_WIDTH - 24,
        y: 80,
      })
    }
  }, [open, position.x])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open && !isMinimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, isMinimized])

  // Handle @ command detection
  useEffect(() => {
    const atIndex = input.lastIndexOf("@")
    if (atIndex !== -1 && atIndex === input.length - 1) {
      setShowCommands(true)
      setCommandFilter("")
      setSelectedCommandIndex(0)
    } else if (atIndex !== -1) {
      const afterAt = input.slice(atIndex + 1)
      if (!afterAt.includes(" ")) {
        setShowCommands(true)
        setCommandFilter(afterAt)
        setSelectedCommandIndex(0)
      } else {
        setShowCommands(false)
      }
    } else {
      setShowCommands(false)
    }
  }, [input])

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
        
        if (isResizing.includes("e")) {
          newWidth = Math.max(MIN_WIDTH, resizeStartRef.current.width + dx)
        }
        if (isResizing.includes("w")) {
          const widthDelta = Math.min(dx, resizeStartRef.current.width - MIN_WIDTH)
          newWidth = resizeStartRef.current.width - widthDelta
          newX = resizeStartRef.current.posX + widthDelta
        }
        if (isResizing.includes("s")) {
          newHeight = Math.max(MIN_HEIGHT, resizeStartRef.current.height + dy)
        }
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

  // Resize handlers
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

  const insertCommand = useCallback((cmd: AtCommand) => {
    const atIndex = input.lastIndexOf("@")
    const newInput = input.slice(0, atIndex) + `@${cmd.name} `
    setInput(newInput)
    setShowCommands(false)
    inputRef.current?.focus()
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedCommandIndex((prev) => 
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        )
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedCommandIndex((prev) => 
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        )
      } else if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault()
        insertCommand(filteredCommands[selectedCommandIndex])
      } else if (e.key === "Escape") {
        setShowCommands(false)
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    // Simulate AI response (replace with actual AI SDK call)
    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: generateMockResponse(userMessage.content, context),
        timestamp: new Date(),
        metadata: {
          model: "gpt-4",
          tokens: Math.floor(Math.random() * 500) + 100,
          duration: Math.floor(Math.random() * 2000) + 500,
        },
      }
      setMessages((prev) => [...prev, assistantMessage])
      setIsLoading(false)
    }, 1500)
  }

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleClearHistory = () => {
    setMessages([])
  }

  if (!open) return null

  // Shared inner content — same markup reused for both floating and docked modes
  const chatContent = (
    <>
      {/* Resize handles — floating only */}
      {!docked && !isMinimized && !isMaximized && (
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
          "flex items-center justify-between px-2 py-2 border-b border-border bg-card/50 select-none",
          isMinimized && "border-b-0"
        )}
      >
        <div className="flex items-center gap-1.5">
          {/* Drag button — floating mode only */}
          {!docked && (
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
          )}

          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shrink-0">
            <Sparkles className="h-3 w-3 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{config?.title || "AI Assistant"}</h2>
            {!isMinimized && (
              <p className="text-[10px] text-muted-foreground truncate">Type @ for commands</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Dock / undock toggle */}
          {onDockToggle && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDockToggle}
              className="h-7 w-7"
              title={docked ? "Undock to floating" : "Dock to sidebar"}
            >
              {docked ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRight className="h-3.5 w-3.5" />}
            </Button>
          )}
          {/* Minimize / maximize only in floating mode */}
          {!docked && (
            <>
              <Button variant="ghost" size="icon" onClick={toggleMinimize} className="h-7 w-7" title="Minimize">
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={toggleMaximize} className="h-7 w-7" title={isMaximized ? "Restore" : "Maximize"}>
                {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={handleClearHistory} className="h-7 w-7" title="Clear history">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content - Hidden when minimized */}
      {!isMinimized && (
        <>
          {/* Messages */}
          <ScrollArea className="flex-1 p-3" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-sm font-medium mb-1">How can I help?</h3>
                <p className="text-xs text-muted-foreground max-w-[240px] mb-4">
                  {config?.welcomeMessage || "Ask questions or use @ commands for quick actions."}
                </p>
                
                {/* Quick actions */}
                <div className="grid grid-cols-2 gap-1.5 w-full max-w-[280px]">
                  {[
                    { label: "Sales summary", icon: TrendingUp },
                    { label: "Check inventory", icon: Package },
                    { label: "List customers", icon: Users },
                    { label: "Generate report", icon: FileText },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => setInput(action.label)}
                      className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left text-xs"
                    >
                      <action.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-2",
                      message.role === "user" ? "flex-row-reverse" : ""
                    )}
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarFallback className={cn(
                        "text-[10px]",
                        message.role === "assistant" 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-muted"
                      )}>
                        {message.role === "assistant" ? <Sparkles className="h-3 w-3" /> : "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className={cn(
                      "flex flex-col gap-0.5 max-w-[85%]",
                      message.role === "user" ? "items-end" : "items-start"
                    )}>
                      <div className={cn(
                        "rounded-xl px-3 py-2 text-xs",
                        message.role === "user" 
                          ? "bg-primary text-primary-foreground rounded-br-sm" 
                          : "bg-muted rounded-bl-sm"
                      )}>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                      <div className="flex items-center gap-1.5 px-1">
                        <span className="text-[9px] text-muted-foreground">
                          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {message.role === "assistant" && (
                          <button
                            onClick={() => handleCopy(message.content, message.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {copiedId === message.id ? (
                              <Check className="h-2.5 w-2.5 text-green-500" />
                            ) : (
                              <Copy className="h-2.5 w-2.5" />
                            )}
                          </button>
                        )}
                        {message.metadata && (
                          <span className="text-[9px] text-muted-foreground">
                            {message.metadata.tokens}t
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-2">
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        <Sparkles className="h-3 w-3" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="bg-muted rounded-xl rounded-bl-sm px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="text-xs text-muted-foreground">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Command palette */}
          {showCommands && filteredCommands.length > 0 && (
            <div 
              className="absolute bottom-[100px] left-3 right-3 bg-popover border border-border rounded-lg shadow-lg max-h-[200px] overflow-auto"
            >
              <div className="p-1.5 border-b border-border">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1.5">
                  <AtSign className="h-2.5 w-2.5" />
                  <span>Commands</span>
                  <span className="ml-auto flex items-center gap-1">
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Tab</kbd>
                  </span>
                </div>
              </div>
              <div className="p-1">
                {Object.entries(groupedCommands).map(([category, cmds]) => (
                  <div key={category} className="mb-1.5 last:mb-0">
                    <div className="px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                      {category}
                    </div>
                    {cmds.map((cmd) => {
                      const globalIndex = filteredCommands.indexOf(cmd)
                      return (
                        <button
                          key={cmd.id}
                          onClick={() => insertCommand(cmd)}
                          className={cn(
                            "w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-left transition-colors",
                            globalIndex === selectedCommandIndex
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <div className={cn(
                            "w-5 h-5 rounded flex items-center justify-center border text-[10px]",
                            categoryColors[cmd.category]
                          )}>
                            {iconMap[cmd.icon] || <Command className="h-3 w-3" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium">@{cmd.name}</span>
                            <p className="text-[10px] text-muted-foreground truncate">{cmd.description}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="p-3 border-t border-border bg-card/50">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={config?.placeholder || "Ask anything... @ for commands"}
                  rows={1}
                  className={cn(
                    "w-full resize-none rounded-lg border border-input bg-background px-3 py-2 pr-10",
                    "text-xs placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                    "min-h-[36px] max-h-[120px]"
                  )}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-1.5 bottom-1.5 h-6 w-6 rounded-md"
                >
                  <Send className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-0.5">
              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                <kbd className="px-1 py-0.5 bg-muted rounded">@</kbd>
                <span>cmds</span>
                <span className="mx-0.5">|</span>
                <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd>
                <span>send</span>
              </div>
              <div className="flex items-center gap-1.5">
                {context?.activeView && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                    <Layout className="h-2.5 w-2.5 mr-0.5" />
                    {context.activeView}
                  </Badge>
                )}
                {/* Resize button — floating mode only */}
                {!docked && !isMaximized && (
                  <button
                    title="Drag to resize"
                    onMouseDown={handleResizeStart("se")}
                    className={cn(
                      "flex items-center justify-center h-5 w-5 rounded transition-colors",
                      "text-muted-foreground hover:text-foreground hover:bg-muted",
                      isResizing === "se" ? "bg-primary/10 text-primary cursor-se-resize" : "cursor-se-resize"
                    )}
                  >
                    <ChevronsUpDown className="h-3 w-3 rotate-45" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )

  // ----- Docked mode: right sidebar rail -----
  if (docked) {
    return (
      <aside className="h-screen w-[24vw] min-w-[320px] shrink-0 flex flex-col bg-sidebar border-l border-sidebar-border relative overflow-hidden">
        {chatContent}
      </aside>
    )
  }

  // ----- Floating mode: draggable island -----
  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden",
        "transition-shadow duration-200",
        isDragging && "shadow-2xl shadow-primary/20",
        isMinimized && "!h-auto"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? 280 : size.width,
        height: isMinimized ? "auto" : size.height,
      }}
    >
      {chatContent}
    </div>
  )
}

// Mock response generator (replace with actual AI SDK integration)
function generateMockResponse(userInput: string, context?: { activeView?: string }): string {
  const input = userInput.toLowerCase()
  
  if (input.includes("@sales") || input.includes("sales summary")) {
    return `Sales summary for current period:

**Revenue:** $284,392 (+12.5%)
**Orders:** 1,847 processed
**AOV:** $154

Top products:
1. Enterprise Suite - $84,600
2. Professional Plan - $46,800
3. Starter Kit - $28,350

Want a detailed report?`
  }
  
  if (input.includes("@inventory") || input.includes("inventory") || input.includes("stock")) {
    return `Inventory status:

**SKUs:** 1,234 items
**Low Stock:** 23 alerts
**Out of Stock:** 5 items

Need attention:
- Electronics: 8 low
- Accessories: 12 low
- Software: 3 out

Generate restock list?`
  }
  
  if (input.includes("@customers") || input.includes("customers")) {
    return `Customer overview:

**Total:** 3,421
**New:** 423 (+8.2%)
**Active:** 2,156 (63%)

Segments:
- Enterprise: 234 ($1.2M ARR)
- Professional: 892 ($890K ARR)
- Starter: 2,295 ($450K ARR)

Export customer list?`
  }
  
  if (input.includes("@help") || input.includes("help")) {
    return `Available commands:

**Data:** @sales, @inventory, @customers, @reports
**Actions:** @create, @update, @delete, @export
**Context:** @view, @selection, @user

Type any command or ask naturally!`
  }
  
  return `I can help with "${userInput}" in the ${context?.activeView || "current"} view.

Try @ commands or describe what you need.`
}
