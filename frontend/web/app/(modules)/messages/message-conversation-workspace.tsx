"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ExternalLink,
  MessageSquare,
  Plus,
  Send,
} from "lucide-react"
import { newCorrelationId } from "@lumiere/erp-workflows"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Textarea } from "@lumiere/ui/components/textarea"
import { MarkdownView } from "@lumiere/ui/components/markdown-view"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { cn } from "@lumiere/ui/lib/utils"
import { UnconfirmedPostedMessageError } from "@lumiere/query-hooks/hooks/mail-message-post"
import {
  messageAuthorName,
  messageRecordPageHref,
  messageTitle,
} from "./message-record"
import {
  matchingConversations,
  messageConversations,
  messageDate,
  messageSource,
  type MessageRow,
} from "./message-conversations"

export type MessageReplyInput = {
  model: string
  resId: string
  parentId: string
  body: string
  idempotencyKey: string
}
export interface MessageConversationWorkspaceProps {
  messages: readonly MessageRow[]
  users?: readonly MessageRow[]
  selectedMessageId: string | null
  search: string
  onSearchChange: (value: string) => void
  onSelectMessage: (id: string | null) => void
  onNewMessage?: () => void
  onReply?: (input: MessageReplyInput) => Promise<{ id: string }>
  onCheckOutcome?: (input: MessageReplyInput) => Promise<{ id: string } | null>
  sourceLabels?: ReadonlyMap<string, string>
  canReply?: boolean
  pendingAttempts?: { readonly [thread: string]: MessageReplyInput }
  onPendingAttempt?: (
    threadId: string,
    attempt: MessageReplyInput | null,
  ) => void
}

/** Presentation over authorized rows. The caller remounts this boundary on actor/company changes. */
export function MessageConversationWorkspace({
  messages,
  users = [],
  selectedMessageId,
  search,
  onSearchChange,
  onSelectMessage,
  onNewMessage,
  onReply,
  onCheckOutcome,
  sourceLabels,
  canReply = false,
  pendingAttempts = {},
  onPendingAttempt,
}: MessageConversationWorkspaceProps) {
  const { t, i18n } = useTranslation()
  const threads = useMemo(() => messageConversations(messages), [messages])
  const visible = useMemo(
    () => matchingConversations(threads, search),
    [threads, search],
  )
  const selected = threads.find((thread) =>
    thread.messages.some((row) => String(row.id) === selectedMessageId),
  )
  const [drafts, setDrafts] = useState<{ [thread: string]: string }>({})
  const [localAttempts, setAttempts] = useState<{
    [thread: string]: MessageReplyInput
  }>({ ...pendingAttempts })
  const attempts = onPendingAttempt ? pendingAttempts : localAttempts
  const [errors, setErrors] = useState<{ [thread: string]: string }>({})
  const [busy, setBusy] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const busyRef = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    setIsHydrated(true)
    return () => {
      active.current = false
    }
  }, [])
  const selectedThreadId = useRef(selected?.id)
  selectedThreadId.current = selected?.id
  const selectedSource = selected && messageSource(selected.root)
  const sourceHref =
    selected && selectedSource
      ? messageRecordPageHref(selected.root)
      : undefined
  const sourceLabel = (row: MessageRow) => {
    const source = messageSource(row)
    return source
      ? (sourceLabels?.get(`${source.model}:${source.resId}`) ??
          t("messages.workspace.linkedRecord", {
            defaultValue: "Linked record #{{id}}",
            id: source.resId,
          }))
      : t("messages.workspace.sourceUnavailable", {
          defaultValue: "Source unavailable",
        })
  }
  const when = (row: MessageRow) => {
    const ms = messageDate(row)
    return ms == null
      ? ""
      : new Date(ms).toLocaleString(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
        })
  }
  const finish = (threadId: string, id: string) => {
    setDrafts((previous) => ({ ...previous, [threadId]: "" }))
    setAttempts((previous) => {
      const next = { ...previous }
      delete next[threadId]
      return next
    })
    setErrors((previous) => ({ ...previous, [threadId]: "" }))
    onPendingAttempt?.(threadId, null)
    if (selectedThreadId.current === threadId) onSelectMessage(id)
  }
  const submit = async (check: boolean) => {
    if (!selected || !selectedSource || busyRef.current || !canReply) return
    const threadId = selected.id
    const attempt = attempts[threadId]
    if ((!check && attempt) || (check && !attempt)) return
    const body = (drafts[threadId] ?? "").trim()
    if (!check && (!body || !onReply)) return
    const input: MessageReplyInput = attempt ?? {
      ...selectedSource,
      parentId: String(selected.root.id),
      body,
      idempotencyKey: newCorrelationId(),
    }
    // The caller retains a minimal attempt even if a source refresh unmounts this view.
    if (!check) onPendingAttempt?.(threadId, input)
    busyRef.current = true
    setBusy(true)
    setErrors((previous) => ({ ...previous, [threadId]: "" }))
    try {
      const effect = check
        ? await onCheckOutcome?.(input)
        : await onReply?.(input)
      if (!active.current) {
        if (effect) onPendingAttempt?.(threadId, null)
        return
      }
      if (effect) finish(threadId, effect.id)
      else {
        setAttempts((previous) => ({ ...previous, [threadId]: input }))
        onPendingAttempt?.(threadId, input)
        setErrors((previous) => ({
          ...previous,
          [threadId]: t("messages.workspace.unconfirmed", {
            defaultValue:
              "The message outcome is still unconfirmed. Check again without posting another message.",
          }),
        }))
      }
    } catch (error) {
      if (!(error instanceof UnconfirmedPostedMessageError) && !check)
        onPendingAttempt?.(threadId, null)
      if (!active.current) return
      if (error instanceof UnconfirmedPostedMessageError) {
        setAttempts((previous) => ({ ...previous, [threadId]: input }))
        onPendingAttempt?.(threadId, input)
      }
      setErrors((previous) => ({
        ...previous,
        [threadId]:
          error instanceof UnconfirmedPostedMessageError
            ? t("messages.workspace.unconfirmed", {
                defaultValue:
                  "The message outcome is still unconfirmed. Check again without posting another message.",
              })
            : error instanceof Error
              ? error.message
              : t("messages.workspace.replyFailed", {
                  defaultValue:
                    "The reply could not be posted. Your draft is retained.",
                }),
      }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!isHydrated) return (
    <div role="status" className="space-y-4" aria-label={t("messages.workspace.loading", { defaultValue: "Loading conversations and current access…" })}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )

  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="message-conversation-workspace"
      aria-label={t("messages.workspace.title", {
        defaultValue: "Conversations",
      })}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("messages.workspace.title", { defaultValue: "Conversations" })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("messages.workspace.description", {
              defaultValue:
                "Open a record conversation and reply with its context beside you.",
            })}
          </p>
        </div>
        {onNewMessage && (
          <Button className="min-h-11 sm:min-h-8" onClick={onNewMessage}>
            <Plus />
            {t("messages.workspace.newMessage", {
              defaultValue: "New message",
            })}
          </Button>
        )}
      </header>
      <div className="grid min-w-0 overflow-hidden rounded-xl border lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
        <aside
          className={cn(
            "min-w-0 space-y-3 border-border p-3 lg:border-r",
            selectedMessageId && "hidden lg:block",
          )}
          aria-label={t("messages.workspace.list", {
            defaultValue: "Conversation list",
          })}
        >
          <Input
            aria-label={t("messages.workspace.search", {
              defaultValue: "Search loaded conversations",
            })}
            placeholder={t("messages.workspace.search", {
              defaultValue: "Search loaded conversations",
            })}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("messages.workspace.loaded", {
              defaultValue: "{{count}} loaded conversations",
              count: visible.length,
            })}
          </p>
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("messages.workspace.empty", {
                defaultValue: "No conversations match this view.",
              })}
            </p>
          ) : (
            <ul className="space-y-1">
              {visible.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full space-y-1 rounded-lg p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected?.id === thread.id && "bg-muted",
                    )}
                    aria-current={
                      selected?.id === thread.id ? "true" : undefined
                    }
                    onClick={() => onSelectMessage(thread.id)}
                  >
                    <span className="block truncate text-sm font-medium">
                      {messageTitle(thread.root)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {sourceLabel(thread.root)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {messageTitle(thread.latest)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {when(thread.latest)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div
          className={cn("min-w-0 p-4", !selectedMessageId && "hidden lg:block")}
        >
          {!selected ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <MessageSquare />
              <p>
                {selectedMessageId
                  ? t("messages.workspace.unavailable", {
                      defaultValue:
                        "This conversation is unavailable in the current view.",
                    })
                  : t("messages.workspace.select", {
                      defaultValue: "Select a conversation to read and reply.",
                    })}
              </p>
              {selectedMessageId && (
                <Button className="min-h-11 sm:min-h-8" variant="outline" onClick={() => onSelectMessage(null)}>
                  {t("messages.workspace.back", {
                    defaultValue: "Back to conversations",
                  })}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <header className="space-y-3 border-b pb-4">
                <Button
                  variant="ghost"
                  className="min-h-11 sm:min-h-8 lg:hidden"
                  onClick={() => onSelectMessage(null)}
                >
                  <ArrowLeft />
                  {t("messages.workspace.back", {
                    defaultValue: "Back to conversations",
                  })}
                </Button>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">
                      {messageTitle(selected.root)}
                    </h3>
                    <p className="break-words text-sm text-muted-foreground">
                      {sourceLabel(selected.root)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11 sm:min-h-8"
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link href={`/messages/${String(selected.root.id)}`} />
                      }
                    >
                      <ExternalLink />
                      {t("messages.workspace.openMessage", {
                        defaultValue: "Open message",
                      })}
                    </Button>
                    {sourceHref && (
                      <Button
                        className="min-h-11 sm:min-h-8"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={sourceHref} />}
                      >
                        {t("messages.workspace.openRecord", {
                          defaultValue: "Open record",
                        })}
                      </Button>
                    )}
                  </div>
                </div>
              </header>
              <ol className="space-y-4" data-testid="conversation-messages">
                {selected.messages.map((row) => (
                  <li
                    key={String(row.id)}
                    className="space-y-2 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <span>{messageAuthorName(row, users)}</span>
                      <Link
                        href={`/messages/${String(row.id)}`}
                        className="hover:underline"
                      >
                        {when(row)}
                      </Link>
                    </div>
                    {typeof row.body === "string" ? (
                      <MarkdownView value={row.body} />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("messages.workspace.contentUnavailable", {
                          defaultValue: "Message content unavailable.",
                        })}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              {canReply && onReply && selectedSource ? (
                <form
                  className="space-y-3 border-t pt-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submit(false)
                  }}
                >
                  <label
                    className="block text-sm font-medium"
                    htmlFor="conversation-reply"
                  >
                    {t("messages.workspace.reply", {
                      defaultValue: "Reply to this conversation",
                    })}
                  </label>
                  <Textarea
                    id="conversation-reply"
                    rows={4}
                    value={drafts[selected.id] ?? ""}
                    disabled={busy || !!attempts[selected.id]}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [selected.id]: event.target.value,
                      }))
                    }
                  />
                  {errors[selected.id] && (
                    <p role="alert" className="text-sm text-destructive">
                      {errors[selected.id]}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {t("messages.workspace.postedNote", {
                        defaultValue:
                          "Messages are posted as comments on the linked record.",
                      })}
                    </p>
                    {attempts[selected.id] ? (
                      <Button
                        className="min-h-11 sm:min-h-8"
                        type="button"
                        variant="outline"
                        disabled={busy || !onCheckOutcome}
                        onClick={() => void submit(true)}
                      >
                        {t("messages.workspace.checkOutcome", {
                          defaultValue: "Check outcome",
                        })}
                      </Button>
                    ) : (
                      <Button
                        className="min-h-11 sm:min-h-8"
                        type="submit"
                        disabled={busy || !(drafts[selected.id] ?? "").trim()}
                      >
                        <Send />
                        {t("messages.workspace.postReply", {
                          defaultValue: "Post reply",
                        })}
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("messages.workspace.replyUnavailable", {
                    defaultValue:
                      "Replying is unavailable for this source or your current access.",
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
