"use client"

import { Fragment, useState, useRef, useEffect, useCallback, useId, type SetStateAction } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  X,
  Send,
  Sparkles,
  Copy,
  Check,
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
  PanelRight,
  PanelRightClose,
  Files,
  Layers3,
  SlidersHorizontal,
  Search,
  History,
  ArrowDown,
  Building2,
  ChevronRight,
  Paperclip,
  Square,
} from "lucide-react"
import type { ChatMessage, AtCommand, AIChatConfig, ChatMessageSourceRef, ChatContext, ChatAction, ChatActionDraftPayload, ChatSkill } from "@/lib/ai-chat-types"
import { defaultAtCommands } from "@/lib/ai-chat-types"
import { AiActionDraftCard } from "./ai-action-draft-card"
import { AiNativeActionCard, type NativeActionPresentation } from "./ai-native-action-card"
import { Dialog, DialogContent, DialogTitle } from "../components/dialog"
import { FileIdentity } from "../components/file-identity"
import { FileUploadField } from "../components/file-upload-field"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../components/popover"
import { AssistantGuideCard } from "./assistant-guide-viewer"
import { ImportTaskStatusCard } from "./import-task-status-card"
import type { ChatImportTaskStatus } from "../lib/import-task-status"
import { extractGuideHtmlDerivative, safeGuideHref } from "../lib/assistant-guide-types"
import type { GuideReference, OpenGuideRequest } from "../lib/assistant-guide-types"
import { aiChatCategoryPillClass } from "@/lib/theme-colors"
import { useTranslation } from "@lumiere/i18n"
import { validateChatImportFiles } from "../lib/chat-import-files"
import { assistantStarterIds, assistantStarters } from "./assistant-starters"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "../components/select"
import { ActionSkillList } from "./action-skill-list"
import { matchingChatSkills, slashSkillToken } from "../lib/chat-skill-search"
import { WorkspaceToolSurface } from "../pages/workspace-tool-surface"
import { ChatAnswerMarkdown } from "./chat-answer-markdown"

interface ChatReply {
  content: string
  stopped?: boolean
  recoveryPath?: ChatMessage["recoveryPath"]
  runId?: number
  sources?: ChatMessageSourceRef[]
  actions?: ChatAction[]
  guides?: GuideReference[]
  importTasks?: ChatImportTaskStatus[]
  importTaskIds?: string[]
  earlierContextUnavailable?: boolean
}

type LocalChatMessage = ChatMessage & { stopped?: boolean }

export type ChatTurnProjection = {
  id: string
  userText: string
  content: string
  timestamp: Date
} & ({ settled: false } | { settled: true; reply: ChatReply } | { settled: true; error: string })

function projectedMessages(turn: ChatTurnProjection, companyId?: number): LocalChatMessage[] {
  const { id, userText, timestamp } = turn
  const reply = turn.settled && "reply" in turn ? turn.reply : undefined
  const final = reply && !reply.stopped ? reply : undefined
  const error = turn.settled && "error" in turn ? turn.error : undefined
  return [
    { id: `${id}:user`, role: "user", content: userText, timestamp, metadata: { turnId: id } },
    {
      id: `${id}:assistant`,
      role: "assistant",
      content: error ?? final?.content ?? turn.content,
      timestamp,
      sources: final?.sources,
      actions: final?.actions,
      guides: final?.guides,
      recoveryPath: final?.recoveryPath,
      importTasks: final?.importTasks,
      importTaskIds: final?.importTaskIds,
      stopped: reply?.stopped,
      metadata: { companyId, turnId: id, runId: final?.runId },
    },
  ]
}

export type AIChatHistory = {
  open: boolean
  onToggle: () => void
  content: React.ReactNode
  title?: string
  actions?: React.ReactNode
  archived?: boolean
  unavailable?: boolean
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onLoadOlder?: () => Promise<unknown>
  onLatest?: () => Promise<unknown>
  loadingOlder?: boolean
  anchorMessageId?: string
}

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
  /** Side chat shares the same mounted conversation as the full workspace. */
  docked?: boolean
  onDockToggle?: () => void
  /** A stable shell mount for the dock and its narrow dialog presentation. */
  workspaceHost?: HTMLElement | null
  /** Guide dialogs use the panel's focus stack when the panel itself is modal. */
  overlayContent?: React.ReactNode
  contextOptions?: readonly { value: string; label: string; group: string }[]
  selectedContext?: string
  onContextChange?: (value: string) => void
  onClearSelection?: () => void
  /** An explicit selection is checked again for company and model policy by the gateway. */
  agentOptions?: readonly { value: string; label: string }[]
  selectedAgent?: string
  onAgentChange?: (value: string) => void
  config?: Partial<AIChatConfig>
  context?: ChatContext
  initialMessages?: ChatMessage[]
  history?: AIChatHistory
  conversationKey?: string
  draft?: { value: string; onChange: (value: SetStateAction<string>) => void }
  sendPending?: boolean
  turnProjection?: ChatTurnProjection
  onStopReply?: () => void
  turnProgress?: "answering" | "preparing_draft" | "saving_reply"
  renderMessageActions?: (message: ChatMessage) => React.ReactNode
  renderCitation?: (source: ChatMessageSourceRef) => React.ReactNode
  composerContext?: React.ReactNode
  /** A user-requested question is appended once without replacing unsent work or sending it. */
  composerRequest?: { id: string; text: string } | null
  onComposerRequestApplied?: (id: string) => void
  /** Error help opens above an existing editor without closing or weakening that editor's modal. */
  modal?: boolean
  /** History persistence is separate from obtaining an answer or executing an action. */
  historySaveFailed?: boolean
  /** When set, user messages are answered via this hook (e.g. BFF → ai-gateway RAG). */
  onSendMessage?: (userText: string, turnId?: string) => Promise<ChatReply>
  /** File-only intake attaches sources without sending or replacing the composer text. */
  onImportFiles?: (files: File[]) => Promise<void>
  /** Server-backed task cards are owned by the host, separately from text replies. */
  importTaskContent?: React.ReactNode
  renderImportTask?: (taskId: string) => React.ReactNode
  importCompanyLabel?: string
  importFileNames?: readonly string[]
  importFocusedFileNames?: readonly string[]
  onClearImportFocus?: () => void
  showWorkbench?: boolean
  /** The host can include actor and organization when the panel is not remounted on scope changes. */
  importScopeKey?: string
  onStreamMessage?: (
    userText: string,
    handlers: {
      onDelta: (delta: string) => void
      turnId: string
      onSources: (sources: ChatMessageSourceRef[]) => void
      onActions?: (actions: ChatAction[]) => void
    },
  ) => Promise<ChatReply>
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
  "search": <Search className="h-4 w-4" />,
}

const categoryColors: Record<string, string> = aiChatCategoryPillClass

function selectionSummaryFromContext(context?: ChatContext): string | null {
  const selected = context?.selectedData
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) return null
  const record = selected as {
    entityType?: unknown
    entityId?: unknown
    selectionSummary?: unknown
  }
  const summary =
    typeof record.selectionSummary === "string" && record.selectionSummary.trim()
      ? record.selectionSummary.trim()
      : null
  const entityType =
    typeof record.entityType === "string" && record.entityType.trim()
      ? record.entityType.trim()
      : null
  const entityId =
    record.entityId != null && String(record.entityId).trim() !== ""
      ? String(record.entityId).trim()
      : null

  if (entityType && entityId) {
    const prefix = `${entityType} #${entityId}`
    if (summary && !summary.startsWith(prefix)) {
      return `${prefix} · ${summary}`
    }
    return summary ?? prefix
  }

  return summary
}

export function AIChatPanel(props: AIChatPanelProps) {
  return <AIChatConversation key={props.conversationKey} {...props} />
}

function AIChatConversation({
  open,
  onClose,
  docked: requestedDocked = false,
  onDockToggle,
  workspaceHost,
  overlayContent,
  contextOptions,
  selectedContext,
  onContextChange,
  onClearSelection,
  agentOptions,
  selectedAgent,
  onAgentChange,
  config,
  context,
  initialMessages,
  history,
  conversationKey,
  draft,
  sendPending,
  turnProjection,
  onStopReply,
  turnProgress,
  renderMessageActions,
  renderCitation,
  composerContext,
  composerRequest,
  onComposerRequestApplied,
  modal = false,
  historySaveFailed,
  onSendMessage,
  onImportFiles,
  importTaskContent,
  renderImportTask,
  importCompanyLabel,
  importFileNames,
  importFocusedFileNames,
  onClearImportFocus,
  showWorkbench,
  importScopeKey,
  onStreamMessage,
}: AIChatPanelProps) {
  const { t } = useTranslation()
  const docked = requestedDocked && !modal
  const managedPlacement = workspaceHost !== undefined && !modal
  const [localMessages, setMessages] = useState<LocalChatMessage[]>([])
  const [nativePresentation, setNativePresentation] = useState(() => new Map<string, NativeActionPresentation>())
  const [localInput, setLocalInput] = useState("")
  const input = draft?.value ?? localInput
  const setInput = draft?.onChange ?? setLocalInput
  const readOnly = history?.archived || history?.unavailable
  const messages: LocalChatMessage[] = []
  const knownTurns = new Set<string>()
  if (!history?.unavailable) {
    const addMessage = (message: LocalChatMessage) => {
      const turnId = message.metadata?.turnId
      if (turnId) {
        const key = `${turnId}:${message.role}`
        if (knownTurns.has(key)) return
        knownTurns.add(key)
      }
      messages.push(message)
    }
    initialMessages?.forEach(addMessage)
    localMessages.forEach(addMessage)
    if (turnProjection) projectedMessages(turnProjection, context?.companyId).forEach(addMessage)
  }
  const [earlierContextUnavailable, setEarlierContextUnavailable] = useState(false)
  const [openTools, setOpenTools] = useState<"files" | "skills" | null>(null)
  const [contextVisible, setContextVisible] = useState(true)
  const contextId = useId()
  const skillsId = useId()
  const filesId = useId()
  const [composerCaret, setComposerCaret] = useState(0)
  const [dismissedSlash, setDismissedSlash] = useState<string | null>(null)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [activeSkillId, setActiveSkillId] = useState("draft")
  const pendingCaret = useRef<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [guideError, setGuideError] = useState<string | null>(null)
  const fileImportEnabled = config?.enableFileUpload === true && onImportFiles != null && !readOnly
  const fileScope = JSON.stringify([importScopeKey, context?.currentUser, context?.companyId, fileImportEnabled])
  const currentFileScope = useRef(fileScope)
  currentFileScope.current = fileScope
  const [fileImport, setFileImport] = useState<{ scope: string; busy: boolean; error?: string }>({ scope: fileScope, busy: false })
  const fileImportAttempt = useRef<{ scope: string; token: object } | null>(null)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const fileDragDepth = useRef(0)
  const fileImportBusy = fileImport.scope === fileScope && fileImport.busy
  const fileImportError = fileImport.scope === fileScope ? fileImport.error : undefined
  useEffect(() => {
    fileDragDepth.current = 0
    fileImportAttempt.current = null
    setDraggingFiles(false)
    setFileImport({ scope: fileScope, busy: false })
  }, [fileScope])
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const [showCommands, setShowCommands] = useState(false)
  const [commandFilter, setCommandFilter] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [citeStatus, setCiteStatus] = useState<Record<string, "pending" | "done" | "error">>({})
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastComposerRequest = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLElement>(null)
  const historyToggleRef = useRef<HTMLButtonElement>(null)
  const historyId = useId()
  const lastHistoryOpen = useRef(false)
  const scrollSnapshot = useRef<{ height: number; top: number } | null>(null)
  const atBottom = useRef(true)
  const lastAnchor = useRef<string | null>(null)
  const previousConversationFocus = useRef<string | undefined>(undefined)

  const commands = config?.commands || defaultAtCommands
  const selectionSummary = selectionSummaryFromContext(context)
  const builtInSkills: ChatSkill[] = [
    {
      id: "draft",
      label: t("aiChat.quickActions.createDraft"),
      icon: "plus-circle",
      description: t("aiChat.deck.draftDescription"),
      keywords: ["create", "new", "draft"],
      prompt: t("aiChat.quickActions.createDraftPrompt"),
    },
    {
      id: "find",
      label: t("aiChat.quickActions.findRecords"),
      icon: "search",
      description: t("aiChat.deck.findDescription"),
      keywords: ["find", "search", "records"],
      prompt: t("aiChat.quickActions.findRecordsPrompt"),
    },
    {
      id: "report",
      label: t("aiChat.quickActions.generateReport"),
      icon: "file-text",
      description: t("aiChat.deck.reportDescription"),
      keywords: ["report", "analysis", "summary"],
      prompt: t("aiChat.quickActions.reportPrompt"),
    },
    {
      id: "explain",
      label: t("aiChat.quickActions.explainPage"),
      icon: "help-circle",
      description: t("aiChat.deck.explainDescription"),
      keywords: ["explain", "help", "guide"],
      prompt: t("aiChat.quickActions.explainPagePrompt"),
    },
  ]
  const skills = Array.from(new Map([...builtInSkills, ...(config?.skills ?? [])].map(skill => [skill.id, skill])).values())
  const selectedSkills = skills.filter(skill => selectedSkillIds.includes(skill.id))
  const slashSignature = `${input}:${composerCaret}`
  const slash = dismissedSlash === slashSignature ? null : slashSkillToken(input, composerCaret)
  const showSkills = openTools === "skills" || slash !== null
  const showFiles = openTools === "files" && slash === null
  const activeContext = contextOptions?.find(option => option.value === selectedContext) ?? contextOptions?.[0]
  const moduleLabel = activeContext?.value === "current"
    ? context?.activeView ?? activeContext.label
    : activeContext?.label ?? context?.activeView ?? context?.module
  const activeViewLabel = context?.activeTab?.replaceAll(/[-_]/g, " ")
  const focusedFileNames = importFocusedFileNames?.length ? importFocusedFileNames : undefined
  const pending = isLoading || Boolean(sendPending || turnProjection?.settled === false)
  const canStopReply = pending && Boolean(onStopReply)
  const showContext = !docked && !modal && !history?.open && contextVisible
  const matchingSkills = slash ? matchingChatSkills(skills, slash.query) : skills
  const focusedSkillId = matchingSkills.some(skill => skill.id === activeSkillId) ? activeSkillId : matchingSkills[0]?.id

  const toggleSkill = (id: string) => {
    setSelectedSkillIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    setActiveSkillId(id)
    if (slash) {
      setOpenTools("skills")
      pendingCaret.current = slash.start
      setComposerCaret(slash.start)
      setInput(input.slice(0, slash.start) + input.slice(slash.end))
    }
    inputRef.current?.focus()
  }

  useEffect(() => {
    if (pendingCaret.current === null) return
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [input])

  const handleImportFiles = async (files: File[]) => {
    if (files.length === 0 || fileImportAttempt.current?.scope === fileScope) return
    if (!fileImportEnabled || !onImportFiles) {
      setFileImport({ scope: fileScope, busy: false, error: t("aiChat.import.unavailable", { defaultValue: "File import is unavailable in this workspace." }) })
      return
    }
    const problem = validateChatImportFiles(files)
    if (problem) {
      const defaults = {
        tooManyFiles: "Choose up to 20 files at a time.",
        unsupportedFile: "{{fileName}} is not a CSV or XLSX file.",
        emptyFile: "{{fileName}} is empty. Choose a file containing data.",
        fileTooLarge: "{{fileName}} exceeds the 5 MB file limit.",
        totalTooLarge: "The selected files exceed the 20 MB total limit.",
      }
      setFileImport({ scope: fileScope, busy: false, error: t(`aiChat.import.${problem.code}`, { defaultValue: defaults[problem.code], fileName: "fileName" in problem ? problem.fileName : undefined }) })
      return
    }
    const attempt = { scope: fileScope, token: {} }
    fileImportAttempt.current = attempt
    setFileImport({ scope: fileScope, busy: true })
    const isCurrent = () => active.current && currentFileScope.current === fileScope && fileImportAttempt.current === attempt
    try {
      await onImportFiles(files)
      if (isCurrent()) setFileImport({ scope: fileScope, busy: false })
    } catch (error) {
      if (isCurrent()) setFileImport({ scope: fileScope, busy: false, error: error instanceof Error ? error.message : t("aiChat.import.failed", { defaultValue: "Import preparation could not be started. Check the saved task before trying again." }) })
    } finally {
      if (fileImportAttempt.current === attempt) fileImportAttempt.current = null
    }
  }

  const isFileDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files") || event.dataTransfer.files.length > 0

  useEffect(() => {
    if (readOnly || !composerRequest || composerRequest.id === lastComposerRequest.current) return
    lastComposerRequest.current = composerRequest.id
    onComposerRequestApplied?.(composerRequest.id)
    setInput((current) => current.trim() ? `${current}\n\n${composerRequest.text}` : composerRequest.text)
    inputRef.current?.focus()
  }, [composerRequest, onComposerRequestApplied, readOnly, setInput])

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

  const historyOpen = Boolean(history?.open && !modal)
  useEffect(() => {
    if (open && historyOpen && !lastHistoryOpen.current) {
      historyRef.current?.querySelector<HTMLElement>("[data-assistant-history-search]")?.focus()
    } else if (!historyOpen && lastHistoryOpen.current) {
      historyToggleRef.current?.focus()
    }
    lastHistoryOpen.current = open && historyOpen
  }, [open, historyOpen])

  useEffect(() => {
    if (open && !historyOpen && !history?.anchorMessageId && !readOnly && conversationKey && previousConversationFocus.current !== conversationKey) {
      inputRef.current?.focus()
      previousConversationFocus.current = conversationKey
    }
  }, [open, historyOpen, history?.anchorMessageId, readOnly, conversationKey])

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const id = history?.anchorMessageId
    const anchor = id
      ? Array.from(viewport.querySelectorAll<HTMLElement>("[data-chat-message-id]")).find(
        message => message.dataset.chatMessageId === id,
      )
      : null
    if (anchor && lastAnchor.current !== id) {
      lastAnchor.current = id ?? null
      anchor.scrollIntoView({ block: "center" })
      anchor.focus({ preventScroll: true })
    } else if (scrollSnapshot.current) {
      const { height, top } = scrollSnapshot.current
      viewport.scrollTop = top + viewport.scrollHeight - height
      scrollSnapshot.current = null
    } else {
      if (atBottom.current) viewport.scrollTop = viewport.scrollHeight
    }
  }, [open, historyOpen, history?.anchorMessageId, initialMessages, localMessages, turnProjection])

  const loadOlder = async () => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport) scrollSnapshot.current = { height: viewport.scrollHeight, top: viewport.scrollTop }
    try { await history?.onLoadOlder?.() }
    catch { scrollSnapshot.current = null }
  }

  const jumpToLatest = () => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    scrollSnapshot.current = null
    atBottom.current = true
    viewport.scrollTop = viewport.scrollHeight
    setShowJumpToLatest(false)
    inputRef.current?.focus({ preventScroll: true })
  }

  // The shell surface handles focus on open and preserves it during responsive changes.
  useEffect(() => {
    if (open && !managedPlacement) inputRef.current?.focus()
  }, [open, docked, managedPlacement])

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

  const insertCommand = useCallback((cmd: AtCommand) => {
    const atIndex = input.lastIndexOf("@")
    const newInput = input.slice(0, atIndex) + `@${cmd.name} `
    setInput(newInput)
    setShowCommands(false)
    inputRef.current?.focus()
  }, [input, setInput])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (slash) {
      if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key)) {
        if (!matchingSkills.length) return
        e.preventDefault()
        const direction = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1
        const index = matchingSkills.findIndex(skill => skill.id === focusedSkillId)
        setActiveSkillId(matchingSkills[(index + direction + matchingSkills.length) % matchingSkills.length]!.id)
      } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault()
        if (focusedSkillId) toggleSkill(focusedSkillId)
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        if (focusedSkillId) setActiveSkillId(focusedSkillId)
        setDismissedSlash(slashSignature)
      }
      return
    }
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
        e.preventDefault()
        e.stopPropagation()
        setShowCommands(false)
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    if (readOnly || history?.loading || (!input.trim() && selectedSkills.length === 0) || isLoading || sendPending || slash) return
    const submittedInput = input
    const turnId = crypto.randomUUID()

    const userMessage: ChatMessage = {
      id: `${turnId}:user`,
      metadata: { turnId },
      role: "user",
      content: [input.trim(), ...selectedSkills.map(skill => skill.prompt)].filter(Boolean).join("\n\n"),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev.slice(-12), userMessage])
    setSendError(null)
    setEarlierContextUnavailable(false)
    atBottom.current = true
    setShowJumpToLatest(false)
    setInput("")
    setIsLoading(true)

    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()

    let streamFrame: number | undefined
    try {
      let assistantMessage: ChatMessage

      if (onStreamMessage) {
        const assistantId = `${turnId}:assistant`
        setStreamingTurnId(turnId)
        let streamedContent = ""
        let streamedSources: ChatMessageSourceRef[] = []
        let streamedActions: ChatAction[] = []
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: new Date(),
            metadata: { turnId },
          },
        ])

        const reply = await onStreamMessage(userMessage.content, {
          turnId,
          onDelta: (delta) => {
            if (!active.current) return
            streamedContent += delta
            if (streamFrame !== undefined) return
            streamFrame = requestAnimationFrame(() => {
              streamFrame = undefined
              if (!active.current) return
              const content = streamedContent
              setMessages((prev) => prev.map((message) =>
                message.id === assistantId ? { ...message, content } : message,
              ))
            })
          },
          onSources: (sources) => {
            streamedSources = sources
          },
          onActions: (actions) => {
            streamedActions = actions
          },
        })
        if (reply.stopped) {
          if (active.current || draft) setInput((current) => current === "" ? submittedInput : current)
          if (active.current) {
            setMessages((prev) => prev.map((message) =>
              message.id === assistantId ? { ...message, content: streamedContent, stopped: true } : message,
            ))
          }
          return
        }
        if (!active.current) return
        setEarlierContextUnavailable(Boolean(reply.earlierContextUnavailable))
        const t1 = typeof performance !== "undefined" ? performance.now() : Date.now()
        assistantMessage = {
          id: assistantId,
          role: "assistant",
          content: reply.content,
          timestamp: new Date(),
          sources:
            reply.sources && reply.sources.length > 0
              ? reply.sources
              : streamedSources.length > 0
                ? streamedSources
                : undefined,
          actions:
            reply.actions && reply.actions.length > 0
              ? reply.actions
              : streamedActions.length > 0
                ? streamedActions
                : undefined,
          guides: reply.guides,
          recoveryPath: reply.recoveryPath,
          importTasks: reply.importTasks,
          importTaskIds: reply.importTaskIds,
          metadata: {
            duration: Math.round(t1 - t0),
            turnId,
            runId: reply.runId,
            companyId: context?.companyId,
          },
        }
        setMessages((prev) =>
          prev.map((message) => (message.id === assistantId ? assistantMessage : message)),
        )
        return
      } else if (onSendMessage) {
        const reply = await (conversationKey
          ? onSendMessage(userMessage.content, turnId)
          : onSendMessage(userMessage.content))
        if (!active.current) return
        setEarlierContextUnavailable(Boolean(reply.earlierContextUnavailable))
        const t1 = typeof performance !== "undefined" ? performance.now() : Date.now()
        assistantMessage = {
          id: `${turnId}:assistant`,
          role: "assistant",
          content: reply.content,
          timestamp: new Date(),
          sources: reply.sources && reply.sources.length > 0 ? reply.sources : undefined,
          actions: reply.actions && reply.actions.length > 0 ? reply.actions : undefined,
          guides: reply.guides,
          recoveryPath: reply.recoveryPath,
          importTasks: reply.importTasks,
          importTaskIds: reply.importTaskIds,
          metadata: {
            duration: Math.round(t1 - t0),
            turnId,
            runId: reply.runId,
            companyId: context?.companyId,
          },
        }
      } else {
        assistantMessage = {
          id: `${turnId}:assistant`,
          role: "assistant",
          content: t("aiChat.turn.notConfigured"),
          timestamp: new Date(),
        }
      }

      if (!active.current) return
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      if (active.current || draft) setInput((current) => current === "" ? submittedInput : current)
      if (!active.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(msg)
      setMessages((prev) => [...prev.filter(message => message.metadata?.turnId !== turnId), {
        id: `${turnId}:error`,
        role: "assistant",
        content: msg,
        timestamp: new Date(),
        metadata: { turnId },
      }])
    } finally {
      if (streamFrame !== undefined) cancelAnimationFrame(streamFrame)
      if (active.current) {
        setIsLoading(false)
        setStreamingTurnId(null)
        setStopping(false)
      }
    }
  }

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleUseAnswerInForm = (text: string) => {
    window.dispatchEvent(
      new CustomEvent("lumiere:ai-form-fill-prompt", {
        detail: { text },
      }),
    )
  }

  const patchDraftInMessages = useCallback(
    (draftId: number, patch: Partial<ChatActionDraftPayload>) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (!message.actions?.length) return message
          return {
            ...message,
            actions: message.actions.map((action) => {
              if (action.type !== "draft" || action.draft?.draftId !== draftId) return action
              return {
                ...action,
                draft: { ...action.draft, ...patch },
              }
            }),
          }
        }),
      )
    },
    [],
  )

  const handleApproveDraft = useCallback(
    async (draft: ChatActionDraftPayload) => {
      if (!config?.onApproveActionDraft) return
      const observed = await config.onApproveActionDraft(draft)
      if (observed) patchDraftInMessages(draft.draftId, observed)
    },
    [config, patchDraftInMessages],
  )

  const handleRejectDraft = useCallback(
    async (draft: ChatActionDraftPayload, reason?: string) => {
      if (!config?.onRejectActionDraft) return
      const observed = await config.onRejectActionDraft(draft, reason)
      if (observed) patchDraftInMessages(draft.draftId, observed)
    },
    [config, patchDraftInMessages],
  )

  const handleUpdateDraft = useCallback(
    async (draft: ChatActionDraftPayload) => {
      if (!config?.onUpdateActionDraft) return
      const observed = await config.onUpdateActionDraft(draft)
      if (observed) patchDraftInMessages(draft.draftId, observed)
    },
    [config, patchDraftInMessages],
  )

  const handleRefreshDraft = useCallback(async (draft: ChatActionDraftPayload) => {
    if (!config?.onRefreshActionDraft) throw new Error("Draft readback is unavailable")
    const observed = await config.onRefreshActionDraft(draft)
    if (active.current) patchDraftInMessages(draft.draftId, observed)
    return observed
  }, [config, patchDraftInMessages])

  const handleCiteSource = useCallback(
    async (messageId: string, sourceKey: string, source: ChatMessageSourceRef) => {
      if (!config?.onCiteSource || citeStatus[sourceKey] === "pending" || citeStatus[sourceKey] === "done") {
        return
      }
      setCiteStatus((prev) => ({ ...prev, [sourceKey]: "pending" }))
      try {
        await config.onCiteSource({ messageId, source })
        setCiteStatus((prev) => ({ ...prev, [sourceKey]: "done" }))
      } catch {
        setCiteStatus((prev) => ({ ...prev, [sourceKey]: "error" }))
      }
    },
    [config, citeStatus],
  )

  const handleOpenGuide = async (request: OpenGuideRequest) => {
    if (!config?.onOpenGuide) return
    setGuideError(null)
    try {
      await config.onOpenGuide(request)
    } catch (cause) {
      setGuideError(cause instanceof Error ? cause.message : t("aiChat.guide.openFailed", { defaultValue: "The document could not be opened. Try again." }))
    }
  }

  if (!open || (managedPlacement && !workspaceHost)) return null

  const contextTitle = t("aiChat.workspace.context")
  const panelTitle = config?.title || t("aiChat.title")
  const dockLabel = docked
    ? t("aiChat.workspace.openFull", { defaultValue: "Open full workspace" })
    : t("aiChat.workspace.dockBesideErp", { defaultValue: "Dock beside ERP" })
  const contextDetails = (
    <>
      <section className="space-y-2 border-b px-4 py-3">
        <h4 className="text-xs font-medium text-muted-foreground">{t("aiChat.workspace.modules")}</h4>
        <p className="text-sm font-medium capitalize [overflow-wrap:anywhere]">{moduleLabel ?? t("aiChat.workspace.noModule", { defaultValue: "No active module" })}</p>
        {importCompanyLabel ? <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{importCompanyLabel}</p> : null}
        {selectionSummary ? <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{selectionSummary}</p> : null}
      </section>
      {config?.enableFileUpload ? (
        <section className="space-y-2 border-b px-4 py-3">
          <h4 className="text-xs font-medium text-muted-foreground">{t("aiChat.workspace.files")}</h4>
          <ChatFileNames names={importFileNames} />
        </section>
      ) : null}
      <section className="space-y-2 px-4 py-3">
        <h4 className="text-xs font-medium text-muted-foreground">{t("aiChat.deck.selected")}</h4>
        {selectedSkills.length ? (
          <ul className="space-y-1 text-sm">
            {selectedSkills.map(skill => <li key={skill.id} className="[overflow-wrap:anywhere]">{skill.label}</li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("aiChat.workspace.noSkills")}</p>}
      </section>
    </>
  )

  const panel = (
    <section
      data-testid="erp-ai-chat-panel"
      data-mode={docked ? "side" : "full"}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        fileDragDepth.current += 1
        if (fileImportEnabled && !fileImportBusy) setDraggingFiles(true)
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = fileImportEnabled && !fileImportBusy ? "copy" : "none"
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return
        fileDragDepth.current = Math.max(0, fileDragDepth.current - 1)
        if (fileDragDepth.current === 0) setDraggingFiles(false)
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        fileDragDepth.current = 0
        setDraggingFiles(false)
        void handleImportFiles(Array.from(event.dataTransfer.files))
      }}
      aria-label={managedPlacement ? undefined : panelTitle}
      className={cn(
        "@container/chat-workspace relative z-50 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground",
        managedPlacement ? "h-full w-full" : docked
          ? "fixed inset-0 h-dvh w-full lg:relative lg:inset-auto lg:h-full lg:w-[360px] lg:shrink-0 lg:bg-transparent xl:w-[380px] 2xl:w-[420px]"
          : modal ? "h-full w-full" : "fixed inset-0 h-dvh w-full",
      )}
    >
      {draggingFiles ? <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95 p-6 text-center text-sm" role="status">{t("aiChat.import.dropFiles", { defaultValue: "Drop CSV or XLSX files to attach them" })}</div> : null}
      <header className={cn("flex h-14 shrink-0 items-center justify-between gap-3 px-4", !docked && "border-b border-border")}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Sparkles className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">{config?.title || t("aiChat.title")}</h2>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {history && !modal ? (
            <Button ref={historyToggleRef} variant="ghost" size="icon" className="size-9 shrink-0"
              aria-expanded={historyOpen} aria-controls={historyId}
              aria-label={t("aiChat.history.title", { defaultValue: "History" })}
              title={t("aiChat.history.title", { defaultValue: "History" })}
              onClick={history.onToggle}>
              <History className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          {!docked && !modal && !historyOpen ? (
            <Button variant="ghost" size="icon" className="hidden size-9 @min-[58rem]/chat-workspace:inline-flex"
              aria-label={contextTitle} aria-expanded={showContext} aria-controls={contextId}
              onClick={() => setContextVisible(visible => !visible)}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          {!modal ? (
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" size="icon" className={cn("size-9", !docked && "@min-[58rem]/chat-workspace:hidden")} />} aria-label={contextTitle}>
                <SlidersHorizontal className="size-4" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-[70dvh] w-72 max-w-[calc(100vw-2rem)] overflow-auto p-0">
                <PopoverTitle className="border-b px-4 py-3">{contextTitle}</PopoverTitle>
                {contextDetails}
              </PopoverContent>
            </Popover>
          ) : null}
          {!modal && onDockToggle ? (
            <Button variant="ghost" size="icon" onClick={() => {
              onDockToggle()
              inputRef.current?.focus()
            }} className="size-9 shrink-0" title={dockLabel} aria-label={dockLabel}>
              {docked ? <PanelRightClose className="size-4" /> : <PanelRight className="size-4" />}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose} className="size-9 shrink-0" aria-label={t("common.close")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
      {history ? (
        <aside id={historyId} ref={historyRef} aria-label={t("aiChat.history.title", { defaultValue: "History" })}
          className={cn("min-h-0 min-w-0 bg-muted/20", historyOpen
            ? "w-full @min-[58rem]/chat-workspace:w-72 @min-[58rem]/chat-workspace:shrink-0 @min-[58rem]/chat-workspace:border-r"
            : "hidden")}>
          {historyOpen ? history.content : null}
        </aside>
      ) : null}
      <div className={cn("relative min-h-0 min-w-0 flex-1 flex-col", historyOpen
        ? "hidden @min-[58rem]/chat-workspace:flex"
        : "flex")}>
        {history?.title || history?.actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
            <h3 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{history.title}</h3>
            {!historyOpen ? history.actions : null}
          </div>
        ) : null}
        <ScrollArea className="min-h-0 flex-1" ref={scrollRef} onScrollCapture={event => {
          const target = event.target
          if (target instanceof HTMLElement && target.dataset.slot === "scroll-area-viewport") {
            atBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80
            setShowJumpToLatest(!atBottom.current)
          }
        }}>
          <div className="mx-auto w-full max-w-[768px] px-4 py-6 sm:px-6">
          {sendError || (turnProjection?.settled && "error" in turnProjection) ? <p role="alert" className="break-words text-sm text-destructive">{t("aiChat.requestFailed", { defaultValue: "The assistant request failed. Review the error and your message before sending again." })}</p> : null}
          {guideError ? <p role="alert" className="mb-4 break-words text-sm text-destructive">{guideError}</p> : null}
          {historySaveFailed ? <p role="alert" className="mb-4 break-words rounded-md border p-3 text-sm">{t("aiChat.historySaveFailed", { defaultValue: "Conversation history may not be available after leaving this page. Your answer is still here. Copy anything you need to keep. This warning does not describe whether a business action completed." })}</p> : null}
          {earlierContextUnavailable || (turnProjection?.settled && "reply" in turnProjection && turnProjection.reply.earlierContextUnavailable) ? <p role="status" className="mb-4 text-sm text-muted-foreground">{t("aiChat.history.earlierUnavailable", { defaultValue: "Earlier context is temporarily unavailable." })}</p> : null}
          {history?.loading ? <p role="status" className="mb-4 text-sm text-muted-foreground">{t("aiChat.history.loadingThread", { defaultValue: "Loading conversation…" })}</p> : null}
          {history?.error || history?.unavailable ? (
            <div role="alert" className="mb-4 space-y-2">
              <p className="text-sm text-destructive">{t("aiChat.history.threadUnavailable", { defaultValue: "This conversation could not be opened." })}</p>
              {history.onRetry ? <Button size="sm" variant="outline" onClick={history.onRetry}>{t("common.retry", { defaultValue: "Retry" })}</Button> : null}
            </div>
          ) : null}
          {history?.onLoadOlder || history?.onLatest ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {history.onLoadOlder ? (
                <Button variant="ghost" size="sm" disabled={history.loadingOlder} onClick={() => { void loadOlder() }}>
                  {t("aiChat.history.olderMessages", { defaultValue: "Load older messages" })}
                </Button>
              ) : null}
              {history.onLatest ? (
                <Button variant="ghost" size="sm" disabled={history.loadingOlder} onClick={() => {
                  atBottom.current = true
                  scrollSnapshot.current = null
                  void history.onLatest?.()
                }}>
                  {t("aiChat.history.latestMessages", { defaultValue: "Back to latest messages" })}
                </Button>
              ) : null}
            </div>
          ) : null}
          {!history?.unavailable && importTaskContent ? <div className="mb-6 space-y-3" data-testid="erp-ai-chat-import-tasks">{importTaskContent}</div> : null}
          {messages.length === 0 && !pending ? (
              history?.loading || history?.error || readOnly ? null : <div className={cn("flex flex-col justify-center", docked ? "py-8" : "min-h-[48vh] py-12")}>
                <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="inline-block size-1.5 rounded-full bg-primary" aria-hidden="true" />
                  {context?.activeView ?? "Your organization"}
                </div>
                <h3 className={cn("font-semibold tracking-tight text-foreground", docked ? "text-xl" : "text-3xl sm:text-4xl")}>
                  What would you like to work on?
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  {config?.welcomeMessage || t("aiChat.emptyState.welcome")}
                </p>
                {!docked ? (
                  <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {assistantStarterIds(context).map((id) => {
                      const starter = assistantStarters[id]
                      const label = t(`aiChat.starters.${id}.label`, { defaultValue: starter.label })
                      const prompt = t(`aiChat.starters.${id}.prompt`, { defaultValue: starter.prompt })
                      return (
                        <button
                          type="button"
                          key={id}
                          onClick={() => {
                            setInput((current) => current.trim() ? `${current}\n\n${prompt}` : prompt)
                            inputRef.current?.focus()
                          }}
                          className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="shrink-0 text-muted-foreground" aria-hidden="true">{iconMap[starter.icon]}</span>
                          <span>{label}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-6 pb-2">
                {messages.map((message) => {
                  const inFlightId = streamingTurnId ?? (turnProjection?.settled === false ? turnProjection.id : null)
                  const streaming = message.role === "assistant" && inFlightId !== null
                    && message.id === `${inFlightId}:assistant`
                  const provisional = streaming || message.stopped === true
                  return (
                  <div
                    key={message.id}
                    data-chat-message-id={message.id}
                    tabIndex={message.id === history?.anchorMessageId ? -1 : undefined}
                    data-testid={`erp-ai-chat-message-${message.role}`}
                    className={cn(
                      "flex w-full",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    
                    <div className={cn(
                      "flex min-w-0 flex-col gap-2",
                        message.role === "user" ? "items-end max-w-[90%]" : "items-start w-full"
                    )}>
                      <div className={cn(
                        "max-w-full min-w-0 break-words text-sm leading-6",
                        message.role === "user"
                          ? "rounded-2xl rounded-br-md border border-border/50 bg-card px-4 py-2.5 text-foreground"
                          : "w-full max-w-[72ch] text-foreground"
                      )}>
                        {message.content ? (
                          message.role === "assistant" && !provisional
                            ? <ChatAnswerMarkdown content={message.content} />
                            : <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.content}</p>
                        ) : null}
                        {message.stopped ? (
                          <p role="status" className="mt-2 text-xs font-medium text-muted-foreground">
                            {message.content
                              ? t("aiChat.progress.partial", { defaultValue: "Reply stopped. Partial reply only." })
                              : t("aiChat.progress.stopped", { defaultValue: "Reply stopped." })}
                          </p>
                        ) : null}
                        {message.metadata?.historyTruncated ? (
                          <p className="text-sm text-muted-foreground">{t("aiChat.history.messageTruncated", {
                            defaultValue: "Part of this saved message exceeds the history display limit.",
                          })}</p>
                        ) : null}
                      </div>
                      {message.role === "assistant" && !provisional && message.recoveryPath === "/ai-skills" && (
                        <a className="text-sm font-medium text-primary underline underline-offset-4" href={message.recoveryPath}>
                          {t("aiSkills.title")}
                        </a>
                      )}
                      {message.role === "assistant" && !provisional ? (
                        message.importTaskIds?.length && renderImportTask
                          ? message.importTaskIds.map(taskId => <Fragment key={taskId}>{renderImportTask(taskId)}</Fragment>)
                          : message.importTasks?.map(status => <ImportTaskStatusCard key={status.taskId} status={status} companyId={context?.companyId} />)
                      ) : null}
                      {message.role === "assistant" && !provisional && config?.onOpenGuide ? <>
                        {message.guides?.map((reference) => <AssistantGuideCard key={`${reference.guideId}:${reference.revision}`} title={reference.title ?? t("aiChat.guide.savedGuide", { defaultValue: "Saved ERP guide" })} module={reference.module} revision={reference.revision} onOpen={() => void handleOpenGuide({ messageId: message.id, reference })} />)}
                        {!isLoading && message.content.trim().length >= 240 && context?.companyId ? <AssistantGuideCard title={message.content.split("\n").find((line) => line.trim())?.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").slice(0, 100) ?? t("aiChat.guide.newGuide", { defaultValue: "ERP guidance" })} module={context.module ?? context.activeView} onOpen={() => void handleOpenGuide({ messageId: message.id, draft: {
                          draftKey: `message:${message.id}`,
                          title: message.content.split("\n").find((line) => line.trim())?.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").slice(0, 100) ?? "ERP guidance",
                          markdown: message.content,
                          html: extractGuideHtmlDerivative(message.content),
                          module: context.module ?? "general",
                          companyId: String(context.companyId),
                          workflow: context.activeTab,
                          sources: message.sources ?? [],
                          originMessageId: message.id,
                          runId: message.metadata?.runId != null ? String(message.metadata.runId) : undefined,
                        } })} /> : null}
                      </> : null}
                      {message.role === "assistant" && !provisional && message.sources != null && message.sources.length > 0 && (
                        <details className="group w-full max-w-full text-xs leading-5 text-muted-foreground">
                          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
                            {t("aiChat.sources")} <span className="text-muted-foreground">{message.sources.length}</span>
                          </summary>
                          <ul className="space-y-2 rounded-lg border border-border bg-card p-3">
                            {(message.sources as ChatMessageSourceRef[]).map((src, i) => {
                              const scope = src.entity_type ?? src.source_kind ?? "ref"
                              const idLabel =
                                src.entity_id != null && String(src.entity_id) !== ""
                                  ? String(src.entity_id)
                                  : src.passage_id != null
                                    ? String(src.passage_id)
                                    : null
                              const citationLabel =
                                src.label ??
                                (idLabel != null ? `${scope} #${idLabel}` : scope)
                              const isLive = src.kind === "live" || src.trust === "authoritative"
                              const isWeb = src.kind === "web"
                              const badgeLabel = isWeb
                                ? "Web"
                                : isLive
                                  ? t("aiChat.sourceLive")
                                  : src.kind === "activity"
                                    ? t("aiChat.sourceActivity")
                                    : t("aiChat.sourceMemory")
                              const sourceKey = `${message.id}-src-${i}`
                              const canCite = config?.onCiteSource != null && src.kind === "passage" && src.passage_id != null
                              const status = citeStatus[sourceKey]
                              return (
                                <li key={sourceKey} className="[overflow-wrap:anywhere]">
                                  <span
                                    className={cn(
                                      "mr-1 inline-flex rounded px-1 py-px text-[11px] font-medium uppercase tracking-wide",
                                      isLive
                                        ? "bg-success/15 text-success"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                    title={
                                      src.snapshot_at
                                        ? t("aiChat.sourceAsOf", { time: src.snapshot_at })
                                        : undefined
                                    }
                                  >
                                    {badgeLabel}
                                  </span>
                                  {renderCitation?.(src) ?? (src.source_kind === "managed_document_selection" && config?.onOpenDocumentSource ? (
                                    <button type="button" className="text-start text-primary underline-offset-2 hover:underline"
                                      onClick={() => config.onOpenDocumentSource?.(src)}>
                                      {citationLabel}
                                    </button>
                                  ) : src.href ? (
                                    <a
                                      href={src.href}
                                      className="text-primary hover:underline underline-offset-2"
                                    >
                                      {citationLabel}
                                    </a>
                                  ) : (
                                    citationLabel
                                  ))}
                                  {src.score != null && src.kind !== "live" ? ` · ${src.score.toFixed(2)}` : ""}
                                  {src.excerpt ? ` — ${src.excerpt}` : ""}
                                  {canCite && (
                                    <button
                                      type="button"
                                      disabled={status === "pending" || status === "done"}
                                      onClick={() => handleCiteSource(message.id, sourceKey, src)}
                                      className={cn(
                                        "ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px] font-medium underline-offset-2",
                                        status === "done"
                                          ? "text-success"
                                          : status === "error"
                                            ? "text-destructive hover:underline"
                                            : "text-primary hover:underline",
                                      )}
                                    >
                                      {status === "pending" ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : status === "done" ? (
                                        <Check className="h-3 w-3" />
                                      ) : null}
                                      {status === "pending"
                                        ? t("aiChat.citeSourcePending")
                                        : status === "done"
                                          ? t("aiChat.citeSourceDone")
                                          : status === "error"
                                            ? t("aiChat.citeSourceError")
                                            : t("aiChat.citeSource")}
                                    </button>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        </details>
                      )}
                      {message.role === "assistant" && !provisional && message.actions != null && message.actions.length > 0 && (
                        <div className="mt-2 w-full min-w-0 space-y-3">
                          {message.actions.map((action) => {
                            if (action.type === "draft" && action.draft) return (
                              <AiActionDraftCard
                                key={action.id}
                                draft={action.draft}
                                scopeKey={config?.actionDraftScopeKey}
                                onApprove={
                                  !readOnly && config?.onApproveActionDraft ? handleApproveDraft : undefined
                                }
                                onReject={
                                  !readOnly && config?.onRejectActionDraft ? handleRejectDraft : undefined
                                }
                                onUpdateDraft={
                                  !readOnly && config?.onUpdateActionDraft ? handleUpdateDraft : undefined
                                }
                                onRefresh={config?.onRefreshActionDraft ? handleRefreshDraft : undefined}
                              />
                            )
                            if (action.type !== "native" || !action.nativeAction) return null
                            const key = JSON.stringify([message.metadata?.turnId ?? message.id, action.id, action.nativeAction])
                            return (
                              <AiNativeActionCard
                                key={key}
                                action={action.nativeAction}
                                label={action.label}
                                onOpen={config?.onNativeAction ? (nativeAction) => config.onNativeAction?.(nativeAction, message.id) : undefined}
                                presentation={{
                                  state: nativePresentation.get(key),
                                  onChange: state => setNativePresentation(previous => {
                                    const next = new Map(previous)
                                    next.delete(key)
                                    if (state) next.set(key, state)
                                    const oldest = next.keys().next().value
                                    if (next.size > 50 && oldest !== undefined) next.delete(oldest)
                                    return next
                                  }),
                                }}
                              />
                            )
                          })}
                        </div>
                      )}
                      {!provisional ? <div className="flex flex-wrap items-center gap-3 pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {message.role === "assistant" && message.content && (
                          <button
                            type="button"
                            onClick={() => void handleCopy(message.content, message.id)}
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring transition-colors pointer-coarse:size-11"
                            aria-label="Copy answer"
                            title="Copy answer"
                          >
                            {copiedId === message.id ? (
                              <Check className="h-3 w-3 text-success" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                        {message.role === "assistant" && message.content && !readOnly && (
                          <button
                            type="button"
                            onClick={() => handleUseAnswerInForm(message.content)}
                            className="inline-flex min-h-8 items-center rounded-md px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring transition-colors pointer-coarse:min-h-11"
                          >
                            Use in form
                          </button>
                        )}
                        {message.role === "assistant" && message.metadata?.runId != null ? (
                          <a
                            href={`/ai-harness?runId=${message.metadata.runId}${message.metadata.companyId ? `&companyId=${message.metadata.companyId}` : ""}`}
                            className="inline-flex min-h-8 items-center text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11"
                          >
                            Inspect run
                          </a>
                        ) : null}
                        {renderMessageActions?.(message)}
                        {message.metadata?.tokens != null ? (
                          <span className="text-[11px] text-muted-foreground">
                            {message.metadata.tokens}t
                          </span>
                        ) : null}
                      </div> : null}
                    </div>
                  </div>
                )})}
                {pending && (
                  <ChatReplyProgress progress={turnProgress} stopping={stopping} />
                )}
              </div>
            )}
          </div>
        </ScrollArea>
        {showJumpToLatest && !historyOpen ? (
          <div className="relative -mt-10 mb-1 flex h-9 shrink-0 justify-center">
            <Button type="button" variant="outline" size="sm" className="pointer-events-auto gap-1.5 bg-background" onClick={jumpToLatest}>
              <ArrowDown className="size-3.5" aria-hidden="true" />
              {t("aiChat.progress.jumpToLatest", { defaultValue: "Jump to latest" })}
            </Button>
          </div>
        ) : null}
        {readOnly ? (
          history?.archived ? <p className="shrink-0 border-t px-4 py-3 text-sm text-muted-foreground">{t("aiChat.history.restoreToContinue", { defaultValue: "Restore this conversation to continue." })}</p> : null
        ) : <div className="relative shrink-0 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        {!slash && showCommands && filteredCommands.length > 0 && (
            <div
              className="absolute bottom-full left-4 right-4 z-20 mb-2 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg max-h-[240px]"
            >
              <div className="p-1.5 border-b border-border">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1.5">
                  <AtSign className="h-2.5 w-2.5" />
                  <span>{t("aiChat.commands")}</span>
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
                          type="button"
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
        <div className="mx-auto w-full max-w-[768px] px-4 sm:px-6">
          <div id={skillsId} hidden={!showSkills} className="max-h-[30dvh] overflow-y-auto">
            <ActionSkillList className="mb-3" items={skills.map(skill => ({ ...skill, icon: iconMap[skill.icon ?? ""] ?? <Sparkles className="size-4" /> }))}
              selectedIds={selectedSkillIds} activeId={focusedSkillId} matchingIds={slash ? matchingSkills.map(skill => skill.id) : undefined}
              disabled={isLoading} onToggle={toggleSkill} onRemove={id => { setSelectedSkillIds(current => current.filter(value => value !== id)); inputRef.current?.focus() }}
              onActiveChange={setActiveSkillId} />
            {showWorkbench ? (
              <a href="/ai-harness" target="_blank" rel="noreferrer" className="mb-3 inline-block text-xs text-primary hover:underline">
                {t("aiHarness.title")}
              </a>
            ) : null}
          </div>
          {config?.enableFileUpload ? (
            <div id={filesId} hidden={!showFiles} className="mb-3 max-h-[30dvh] space-y-2 overflow-y-auto rounded-lg border bg-card p-3">
              <ChatFileNames names={importFileNames} />
              <FileUploadField
                multiple
                accept=".csv,.xlsx"
                data-testid="erp-ai-chat-file-input"
                chooseTestId="erp-ai-chat-attach"
                disabled={!fileImportEnabled || fileImportBusy}
                aria-label={t("aiChat.import.chooseFiles", { defaultValue: "Choose import files" })}
                chooseLabel={t("aiChat.workspace.addFiles")}
                onSelect={(files) => void handleImportFiles(files)}
              />
            </div>
          ) : null}
          {fileImportError ? <p role="alert" className="mx-auto mb-2 max-w-[790px] break-words text-sm text-destructive">{fileImportError}</p> : null}
          {fileImportBusy ? <p role="status" className="mx-auto mb-2 flex max-w-[790px] items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("aiChat.import.savingAttachments", { defaultValue: "Saving attachments…" })}</p> : null}
          {composerContext}
          <div className="w-full rounded-2xl border border-border bg-muted/40 p-2 transition-colors focus-within:border-ring">
            {moduleLabel || importCompanyLabel || selectionSummary || focusedFileNames ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1 text-xs text-muted-foreground"
                data-testid="assistant-composer-scope">
                {importCompanyLabel ? (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={importCompanyLabel}>
                    <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate font-medium text-foreground">{importCompanyLabel}</span>
                  </span>
                ) : null}
                {moduleLabel ? (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                    <Layers3 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate capitalize">{moduleLabel}{activeViewLabel ? ` · ${activeViewLabel}` : ""}</span>
                  </span>
                ) : null}
                {selectionSummary ? (
                  <ChatScopeChip
                    label={selectionSummary}
                    icon={<CheckSquare className="size-3 shrink-0" aria-hidden="true" />}
                    clearLabel={t("aiChat.workspace.clearSelection", { defaultValue: "Remove selected record from chat" })}
                    onClear={onClearSelection && (() => { onClearSelection(); inputRef.current?.focus() })}
                  />
                ) : null}
                {focusedFileNames ? (
                  <ChatScopeChip
                    label={focusedFileNames.length === 1 ? focusedFileNames[0]! : t("aiChat.workspace.focusedFiles", { defaultValue: "{{count}} files in this message", count: focusedFileNames.length })}
                    title={focusedFileNames.join(", ")}
                    icon={<Paperclip className="size-3 shrink-0" aria-hidden="true" />}
                    clearLabel={t("aiChat.workspace.clearFiles", { defaultValue: "Remove files from this message" })}
                    onClear={onClearImportFocus && (() => { onClearImportFocus(); inputRef.current?.focus() })}
                  />
                ) : null}
              </div>
            ) : null}
            <Textarea
              variant="plain"
              ref={inputRef}
              data-testid="erp-ai-chat-input"
              value={input}
              onChange={(event) => { setInput(event.target.value); setComposerCaret(event.target.selectionStart) }}
              onSelect={(event) => setComposerCaret(event.currentTarget.selectionStart)}
              onKeyDown={handleKeyDown}
              placeholder={config?.placeholder || t("aiChat.placeholder")}
              rows={2}
              aria-label="Message Lumière assistant"
              className="block field-sizing-content min-h-[50px] max-h-[180px] w-full resize-none rounded-none border-0 bg-transparent px-2 pt-2 text-sm leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex min-h-10 items-center justify-between gap-2 ps-2">
              <span className="min-w-0 text-xs text-muted-foreground">
                <kbd className="rounded bg-muted px-1 py-0.5">/</kbd> {t("aiChat.deck.skills")} · <kbd className="rounded bg-muted px-1 py-0.5">@</kbd> {t("aiChat.hints.cmds")}
              </span>
              {canStopReply || stopping ? (
                <Button type="button" size="icon" variant="outline"
                  data-testid="erp-ai-chat-stop"
                  className="size-9 shrink-0 rounded-xl pointer-coarse:size-11"
                  disabled={stopping}
                  aria-label={t("aiChat.progress.stop", { defaultValue: "Stop reply" })}
                  title={t("aiChat.progress.stop", { defaultValue: "Stop reply" })}
                  onClick={() => { setStopping(true); onStopReply?.(); inputRef.current?.focus() }}>
                  <Square className="size-3.5 fill-current" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  data-testid="erp-ai-chat-send"
                  onClick={handleSend}
                  disabled={(!input.trim() && selectedSkills.length === 0) || pending || history?.loading || slash !== null}
                  className="size-9 shrink-0 rounded-xl pointer-coarse:size-11"
                  aria-label="Send message"
                >
                  {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 py-1">
          {agentOptions && agentOptions.length > 0 && onAgentChange ? (
            <div className="flex min-w-0 items-center gap-1">
              <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Select value={selectedAgent ?? "default"} onValueChange={onAgentChange}>
                <SelectTrigger
                  data-testid="erp-ai-chat-agent"
                  className="h-9 max-w-[12rem] border-transparent bg-transparent text-xs"
                  aria-label="AI agent"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Organization default</SelectItem>
                  {agentOptions.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {contextOptions && contextOptions.length > 0 && onContextChange ? (
            <div className="flex min-w-0 items-center gap-1">
              <Layers3 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Select
                value={String(selectedContext ?? contextOptions[0]?.value ?? "")}
                onValueChange={(nextValue) => onContextChange(nextValue)}
              >
                <SelectTrigger
                  data-testid="erp-ai-chat-context"
                  className="h-9 max-w-[10rem] border-transparent bg-transparent text-xs"
                  aria-label={t("aiChat.workspace.contextSelect", { defaultValue: "Assistant context" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set(contextOptions.map((option) => option.group))).map((group) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {contextOptions
                        .filter((option) => option.group === group)
                        .map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
            {config?.enableFileUpload ? (
              <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2 text-xs"
                aria-controls={filesId} aria-expanded={showFiles}
                onClick={() => {
                  if (slash) setDismissedSlash(slashSignature)
                  setOpenTools(showFiles ? null : "files")
                }}>
                <Files className="size-4 text-muted-foreground" aria-hidden="true" />
                {t("aiChat.workspace.files")}
                {importFileNames?.length ? <span>{importFileNames.length}</span> : null}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2 text-xs"
              aria-controls={skillsId} aria-expanded={showSkills}
              onClick={() => {
                if (slash) setDismissedSlash(slashSignature)
                setOpenTools(showSkills ? null : "skills")
              }}>
              <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
              {t("aiChat.deck.cards")}
              {selectedSkills.length ? <span>{selectedSkills.length}</span> : null}
            </Button>
          {config?.guideLibraryHref && safeGuideHref(config.guideLibraryHref) ? <a href={safeGuideHref(config.guideLibraryHref)} className="flex min-h-8 items-center gap-2 text-xs text-primary hover:underline"><BookOpen className="size-3.5" aria-hidden="true" />{t("aiChat.guide.library", { defaultValue: "Saved guides" })}</a> : null}
          </div>
        </div>
        </div>}
      </div>
      {!docked && !modal ? (
        <aside
          id={contextId}
          aria-label={contextTitle}
          className={cn("hidden w-72 shrink-0 overflow-y-auto overscroll-contain border-l border-border bg-muted/30 @min-[75rem]/chat-workspace:w-80", showContext && "@min-[58rem]/chat-workspace:block")}
        >
          <h3 className="border-b px-4 py-3 text-sm font-semibold">{contextTitle}</h3>
          {contextDetails}
        </aside>
      ) : null}
      </div>
      {overlayContent}
    </section>
  )
  // Error help covers the viewport while leaving the original editor mounted.
  if (modal) return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}><DialogContent showCloseButton={false} className="left-0 top-0 h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 ring-0 sm:max-w-none"><DialogTitle className="sr-only">{panelTitle}</DialogTitle>{panel}</DialogContent></Dialog>
  return workspaceHost ? (
    <WorkspaceToolSurface container={workspaceHost} docked={docked} label={panelTitle} onClose={onClose} initialFocus={() => historyOpen
      ? historyRef.current?.querySelector<HTMLElement>("[data-assistant-history-search]") ?? historyToggleRef.current
      : inputRef.current ?? historyToggleRef.current}>
      {panel}
    </WorkspaceToolSurface>
  ) : panel
}

function ChatFileNames({ names }: { names?: readonly string[] }) {
  const { t } = useTranslation()
  return names?.length ? (
    <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
      {names.map((name, index) => <li className="min-w-0" key={index}><FileIdentity fileName={name} /></li>)}
    </ul>
  ) : <p className="text-xs text-muted-foreground">{t("aiChat.workspace.noFiles")}</p>
}

function ChatReplyProgress({ progress, stopping }: { progress: AIChatPanelProps["turnProgress"]; stopping: boolean }) {
  const { t } = useTranslation()
  const labels = {
    sending: t("aiChat.progress.sending", { defaultValue: "Sending message…" }),
    answering: t("aiChat.progress.answering", { defaultValue: "Writing reply…" }),
    preparing_draft: t("aiChat.progress.preparingDraft", { defaultValue: "Preparing a draft for review…" }),
    saving_reply: t("aiChat.progress.savingReply", { defaultValue: "Saving reply to history…" }),
    stopping: t("aiChat.progress.stopping", { defaultValue: "Stopping reply…" }),
  }
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground" role="status">
      <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
      {labels[stopping ? "stopping" : progress ?? "sending"]}
    </div>
  )
}

function ChatScopeChip({ label, title = label, icon, clearLabel, onClear }: {
  label: string
  title?: string
  icon: React.ReactNode
  clearLabel: string
  onClear?: () => void
}) {
  return (
    <Badge variant="outline" className="h-auto min-w-0 max-w-full gap-1 truncate px-1.5 py-0 text-xs" title={title}>
      {icon}
      <span className="truncate">{label}</span>
      {onClear ? (
        <button type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-9"
          aria-label={clearLabel} onClick={onClear}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </Badge>
  )
}
