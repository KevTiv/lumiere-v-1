"use client"

import { useState, useRef, useEffect, useCallback } from "react"
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
} from "lucide-react"
import type { ChatMessage, AtCommand, AIChatConfig, ChatMessageSourceRef, ChatContext, ChatAction, ChatActionDraftPayload } from "@/lib/ai-chat-types"
import { defaultAtCommands } from "@/lib/ai-chat-types"
import { AiActionDraftCard } from "./ai-action-draft-card"
import { aiChatCategoryPillClass } from "@/lib/theme-colors"
import { useTranslation } from "@lumiere/i18n"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "../components/select"

interface ChatReply {
  content: string
  runId?: number
  sources?: ChatMessageSourceRef[]
  actions?: ChatAction[]
}

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
  /** Side chat shares the same mounted conversation as the full workspace. */
  docked?: boolean
  onDockToggle?: () => void
  contextOptions?: readonly { value: string; label: string; group: string }[]
  selectedContext?: string
  onContextChange?: (value: string) => void
  config?: Partial<AIChatConfig>
  context?: ChatContext
  initialMessages?: ChatMessage[]
  /** History persistence is separate from obtaining an answer or executing an action. */
  historySaveFailed?: boolean
  /** When set, user messages are answered via this hook (e.g. BFF → ai-gateway RAG). */
  onSendMessage?: (userText: string) => Promise<ChatReply>
  onStreamMessage?: (
    userText: string,
    handlers: {
      onDelta: (delta: string) => void
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

export function AIChatPanel({
  open,
  onClose,
  docked = false,
  onDockToggle,
  contextOptions,
  selectedContext,
  onContextChange,
  config,
  context,
  initialMessages,
  historySaveFailed,
  onSendMessage,
  onStreamMessage,
}: AIChatPanelProps) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
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
  const scrollRef = useRef<HTMLDivElement>(null)

  const commands = config?.commands || defaultAtCommands
  const selectionSummary = selectionSummaryFromContext(context)

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages)
    }
  }, [initialMessages])

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

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current && messages) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus the composer on entering either workspace mode.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, docked])

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
    setSendError(null)
    setInput("")
    setIsLoading(true)

    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()

    try {
      let assistantMessage: ChatMessage

      if (onStreamMessage) {
        const assistantId = (Date.now() + 1).toString()
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
          },
        ])

        const reply = await onStreamMessage(userMessage.content, {
          onDelta: (delta) => {
            if (!active.current) return
            streamedContent += delta
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, content: streamedContent }
                  : message,
              ),
            )
          },
          onSources: (sources) => {
            if (!active.current) return
            streamedSources = sources
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, sources: sources.length > 0 ? sources : undefined }
                  : message,
              ),
            )
          },
          onActions: (actions) => {
            if (!active.current) return
            streamedActions = actions
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, actions: actions.length > 0 ? actions : undefined }
                  : message,
              ),
            )
          },
        })
        if (!active.current) return
        const t1 = typeof performance !== "undefined" ? performance.now() : Date.now()
        assistantMessage = {
          id: assistantId,
          role: "assistant",
          content: reply.content || streamedContent,
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
          metadata: {
            duration: Math.round(t1 - t0),
            runId: reply.runId,
            companyId: context?.companyId,
          },
        }
        setMessages((prev) =>
          prev.map((message) => (message.id === assistantId ? assistantMessage : message)),
        )
        return
      } else if (onSendMessage) {
        const reply = await onSendMessage(userMessage.content)
        const t1 = typeof performance !== "undefined" ? performance.now() : Date.now()
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: reply.content,
          timestamp: new Date(),
          sources: reply.sources && reply.sources.length > 0 ? reply.sources : undefined,
          actions: reply.actions && reply.actions.length > 0 ? reply.actions : undefined,
          metadata: {
            duration: Math.round(t1 - t0),
            runId: reply.runId,
            companyId: context?.companyId,
          },
        }
      } else {
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: t("aiChat.turn.notConfigured"),
          timestamp: new Date(),
        }
      }

      if (!active.current) return
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      if (!active.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(msg)
      setInput((current) => current === "" ? userMessage.content : current)
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: msg,
          timestamp: new Date(),
        },
      ])
    } finally {
      if (active.current) setIsLoading(false)
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
      await config.onApproveActionDraft(draft)
      patchDraftInMessages(draft.draftId, { status: "approved" })
    },
    [config, patchDraftInMessages],
  )

  const handleRejectDraft = useCallback(
    async (draft: ChatActionDraftPayload, reason?: string) => {
      if (!config?.onRejectActionDraft) return
      await config.onRejectActionDraft(draft, reason)
      patchDraftInMessages(draft.draftId, { status: "rejected" })
    },
    [config, patchDraftInMessages],
  )

  const handleUpdateDraft = useCallback(
    async (draft: ChatActionDraftPayload) => {
      if (!config?.onUpdateActionDraft) return
      await config.onUpdateActionDraft(draft)
      patchDraftInMessages(draft.draftId, {
        paramsJson: draft.paramsJson,
        summary: draft.summary,
      })
    },
    [config, patchDraftInMessages],
  )

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

  if (!open) return null

  return (
    <section
      data-testid="erp-ai-chat-panel"
      data-mode={docked ? "side" : "full"}
      aria-label={config?.title || t("aiChat.title")}
      className={cn(
        "relative z-50 flex min-h-0 flex-col overflow-hidden bg-background text-foreground",
        docked
          ? "fixed inset-0 sm:relative sm:inset-auto sm:h-full sm:w-[380px] sm:shrink-0 sm:border-l sm:border-border xl:w-[420px]"
          : "fixed inset-0 h-dvh w-screen",
      )}
    >
      <header className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <Sparkles className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">{config?.title || t("aiChat.title")}</h2>
            <p className="truncate text-xs text-muted-foreground">{docked ? "Working alongside your module" : "Business workspace"}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {contextOptions && contextOptions.length > 0 && onContextChange ? (
            <label className="min-w-0">
              <span className="sr-only">Assistant context</span>
              <Select
                value={String(selectedContext ?? contextOptions[0]?.value ?? "")}
                onValueChange={(nextValue) => onContextChange(nextValue)}
              >
                <SelectTrigger
                  data-testid="erp-ai-chat-context"
                  className="h-9 max-w-[128px] rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[190px]"
                  aria-label={"Assistant context"}
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
            </label>
          ) : null}
          {onDockToggle ? (
            <Button variant="ghost" size="icon" onClick={onDockToggle} className="size-9 shrink-0" title={docked ? "Open full workspace" : "Dock beside ERP"} aria-label={docked ? "Open full workspace" : "Dock beside ERP"}>
              {docked ? <PanelRightClose className="size-4" /> : <PanelRight className="size-4" />}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose} className="size-9 shrink-0" aria-label={t("common.close")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1" ref={scrollRef}>
          <div className={cn("mx-auto w-full max-w-[820px] px-4 py-8 sm:px-8", docked ? "sm:px-4" : "sm:py-12")}>
          {sendError ? <p role="alert" className="break-words text-sm text-destructive">{t("aiChat.requestFailed", { defaultValue: "The assistant request failed. Review the error and your message before sending again." })}</p> : null}
          {historySaveFailed ? <p role="alert" className="mb-4 break-words rounded-md border p-3 text-sm">{t("aiChat.historySaveFailed", { defaultValue: "Conversation history may not be available after leaving this page. Your answer is still here. Copy anything you need to keep. This warning does not describe whether a business action completed." })}</p> : null}
            {messages.length === 0 ? (
              <div className={cn("flex flex-col justify-center", docked ? "py-8" : "min-h-[48vh] py-12")}>
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
                <div className={cn("mt-8 grid gap-2", docked ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
                  {([
                    { labelKey: "aiChat.quickActions.salesSummary", icon: TrendingUp },
                    { labelKey: "aiChat.quickActions.checkInventory", icon: Package },
                    { labelKey: "aiChat.quickActions.listCustomers", icon: Users },
                    { labelKey: "aiChat.quickActions.generateReport", icon: FileText },
                  ] as const).map(({ labelKey, icon: Icon }) => (
                    <button
                      type="button"
                      key={labelKey}
                      onClick={() => { setInput(t(labelKey)); inputRef.current?.focus() }}
                      className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>{t(labelKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8 pb-8">
                {messages.map((message) => (
                  <div
                    key={message.id}
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
                        "max-w-full min-w-0 break-words text-[14px] leading-7",
                        message.role === "user"
                          ? "rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-foreground"
                          : "text-foreground"
                      )}>
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.content}</p>
                      </div>
                      {message.role === "assistant" && message.sources != null && message.sources.length > 0 && (
                        <div className="mt-2 w-full max-w-full rounded-lg border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
                          <div className="font-medium text-foreground/80 mb-0.5">{t("aiChat.sources")}</div>
                          <ul className="space-y-0.5 list-disc list-inside">
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
                                <li key={sourceKey} className="break-all">
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
                                  {src.href ? (
                                    <a
                                      href={src.href}
                                      className="text-primary hover:underline underline-offset-2"
                                    >
                                      {citationLabel}
                                    </a>
                                  ) : (
                                    citationLabel
                                  )}
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
                        </div>
                      )}
                      {message.role === "assistant" && message.actions != null && message.actions.length > 0 && (
                        <div className="mt-2 w-full min-w-0 space-y-3">
                          {message.actions.map((action) =>
                            action.type === "draft" && action.draft ? (
                              <AiActionDraftCard
                                key={action.id}
                                draft={action.draft}
                                onApprove={
                                  config?.onApproveActionDraft ? handleApproveDraft : undefined
                                }
                                onReject={
                                  config?.onRejectActionDraft ? handleRejectDraft : undefined
                                }
                                onUpdateDraft={
                                  config?.onUpdateActionDraft ? handleUpdateDraft : undefined
                                }
                              />
                            ) : null,
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {message.role === "assistant" && (
                          <button
                            onClick={() => handleCopy(message.content, message.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy answer"
                          >
                            {copiedId === message.id ? (
                              <Check className="h-3 w-3 text-success" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                        {message.role === "assistant" && (
                          <button
                            type="button"
                            onClick={() => handleUseAnswerInForm(message.content)}
                            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Use in form
                          </button>
                        )}
                        {message.role === "assistant" && message.metadata?.runId != null ? (
                          <a
                            href={`/ai-harness?runId=${message.metadata.runId}${message.metadata.companyId ? `&companyId=${message.metadata.companyId}` : ""}`}
                            className="text-[11px] text-primary hover:underline"
                          >
                            Inspect run
                          </a>
                        ) : null}
                        {message.metadata?.tokens != null ? (
                          <span className="text-[11px] text-muted-foreground">
                            {message.metadata.tokens}t
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    {t("aiChat.thinking")}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
        {showCommands && filteredCommands.length > 0 && (
            <div
              className="absolute bottom-[152px] left-4 right-4 z-20 mx-auto max-w-[790px] overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg max-h-[240px]"
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
        <div className="shrink-0 border-t border-border/70 bg-background/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:px-5">
          <div className="mx-auto w-full max-w-[790px] rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-ring">
            <Textarea
              variant="plain"
              ref={inputRef}
              data-testid="erp-ai-chat-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={config?.placeholder || t("aiChat.placeholder")}
              rows={2}
              aria-label="Message Lumière assistant"
              className="block field-sizing-fixed min-h-[58px] max-h-[180px] w-full resize-none rounded-none border-0 bg-transparent px-3 pt-2 text-sm leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 pl-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span><kbd className="rounded bg-muted px-1 py-0.5">@</kbd> {t("aiChat.hints.cmds")}</span>
                {selectionSummary ? (
                  <Badge variant="outline" className="max-w-[180px] truncate text-[10px]" title={t("aiChat.selectionContext")}>
                    <CheckSquare className="mr-1 size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{selectionSummary}</span>
                  </Badge>
                ) : null}
              </div>
              <Button
                size="icon"
                data-testid="erp-ai-chat-send"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="size-9 shrink-0 rounded-xl"
                aria-label="Send message"
              >
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
          <p className="mx-auto mt-2 max-w-[790px] text-center text-[11px] text-muted-foreground">
            Suggested actions require review. Lumière checks your current permissions.
          </p>
        </div>
      </div>
    </section>
  )
}
