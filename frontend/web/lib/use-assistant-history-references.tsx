"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import type {
  ChatMessage,
  ChatMessageSourceRef,
} from "@lumiere/ui/lib/ai-chat-types"
import { Button } from "@lumiere/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@lumiere/ui/components/dialog"
import { Textarea } from "@lumiere/ui/components/textarea"
import { approvalRecordHref } from "@lumiere/query-hooks/hooks/approvals"
import { sourceReviewHistoryHref } from "@lumiere/query-hooks/hooks/source-review-navigation"
import type { AiChatHistoryReference } from "@lumiere/query-hooks/hooks/ai-memory"
import { z } from "zod"

import {
  assistantHistoryReference,
  MAX_ASSISTANT_HISTORY_REFERENCES,
} from "@/app/api/ai/_lib/history-references"
import { apiFetch } from "./api-fetch"
import { assistantSavedWidgetHref } from "./assistant-native-actions"
import {
  assistantWidgetReceiptHref,
  assistantWidgetReceiptQueryKey,
  readAssistantWidgetReceipts,
} from "./assistant-widget-receipts"
import type { ChatImportTask } from "./chat-import-task"
import { importTaskHref } from "./import-task-navigation"
import { useErpAiHistoryReferenceRequest } from "./erp-ai-context"

type Reference = AiChatHistoryReference
type MessageReference = Extract<Reference, { kind: "message" }>
type DecisionReference = Extract<Reference, { kind: "decision" }>

const decisionNoteSchema = z.object({
  reference: assistantHistoryReference.refine(
    (reference) => reference.kind === "decision",
  ),
  note: z.string().max(2_000),
  actor: z.string().max(128),
  createdAt: z.string().max(100),
  latestRevision: z.number().int().positive(),
})

type DecisionNote = Omit<z.infer<typeof decisionNoteSchema>, "reference"> & {
  reference: DecisionReference
}

function decisionNote(value: unknown): DecisionNote {
  const saved = decisionNoteSchema.parse(value)
  if (saved.reference.kind !== "decision")
    throw new Error("Invalid saved decision")
  return { ...saved, reference: saved.reference }
}

type AttachedReference = { reference: Reference; unavailable?: boolean }
const EMPTY_REFERENCES: readonly AttachedReference[] = []
const EMPTY_NOTES: readonly DecisionNote[] = []
const MAX_DRAFT_THREADS = 16

function referenceKey(reference: Reference): string {
  return JSON.stringify(reference)
}

function sameReference(left: Reference, right: Reference): boolean {
  return referenceKey(left) === referenceKey(right)
}

async function checkedResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("Saved chat reference is unavailable")
  return response.json() as Promise<unknown>
}

function sourceDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

export function useAssistantHistoryReferences({
  scopeKey,
  sessionKey,
  companyId,
  messageIds,
  onNewChat,
  onOpenMessage,
  readonly = false,
}: {
  scopeKey: string | null
  sessionKey: string | null
  companyId: number | null
  messageIds: readonly string[]
  onNewChat: () => string | null
  onOpenMessage: (sessionKey: string, messageId: string) => void
  readonly?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const moduleReference = useErpAiHistoryReferenceRequest()
  const [drafts, setDrafts] = useState<{
    scopeKey: string
    byThread: ReadonlyMap<string, readonly AttachedReference[]>
  } | null>(null)
  const [edit, setEdit] = useState<{
    scopeKey: string
    reference: MessageReference
    existing?: DecisionNote
  } | null>(null)
  const [source, setSource] = useState<{
    scopeKey: string
    reference: Reference
  } | null>(null)
  const [referenceLimit, setReferenceLimit] = useState<{
    scopeKey: string
    sessionKey: string
  } | null>(null)

  useEffect(() => {
    setDrafts((current) => (current?.scopeKey === scopeKey ? current : null))
    setEdit((current) => (current?.scopeKey === scopeKey ? current : null))
    setSource((current) => (current?.scopeKey === scopeKey ? current : null))
    setReferenceLimit((current) =>
      current?.scopeKey === scopeKey ? current : null,
    )
  }, [scopeKey])

  const active =
    drafts?.scopeKey === scopeKey && sessionKey
      ? (drafts.byThread.get(sessionKey) ?? EMPTY_REFERENCES)
      : EMPTY_REFERENCES
  const historyRefs = useMemo(
    () => active.map((item) => item.reference),
    [active],
  )
  const editDecision =
    edit?.scopeKey === scopeKey && edit.reference.sessionKey === sessionKey
      ? edit
      : null
  const viewSource = source?.scopeKey === scopeKey ? source.reference : null
  const ids = messageIds
    .filter((id) => /^[1-9][0-9]{0,19}$/.test(id))
    .slice(-90)
    .join(",")
  const notesQuery = useQuery({
    queryKey: ["assistant-chat-decisions", scopeKey, sessionKey, ids],
    enabled: !!scopeKey && !!sessionKey && !!companyId && !!ids,
    retry: false,
    gcTime: 60_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        companyId: String(companyId),
        sessionKey: sessionKey ?? "",
        messageIds: ids,
      })
      const payload = await checkedResponse(
        await apiFetch("/api/ai/chat/decisions?" + params, {
          signal,
          cache: "no-store",
        }),
      )
      return z
        .object({ data: z.array(z.unknown()).max(180) })
        .parse(payload)
        .data.map(decisionNote)
    },
  })
  const widgetReceipts = useQuery({
    queryKey: [...assistantWidgetReceiptQueryKey(scopeKey, sessionKey), ids],
    enabled: !!scopeKey && !!sessionKey && !!companyId && !!ids,
    retry: false,
    gcTime: 60_000,
    queryFn: ({ signal }) =>
      readAssistantWidgetReceipts(companyId!, sessionKey!, ids, signal),
  })
  const notes = notesQuery.isError
    ? EMPTY_NOTES
    : (notesQuery.data ?? EMPTY_NOTES)
  const notesByMessage = useMemo(
    () => new Map(notes.map((note) => [note.reference.messageId, note])),
    [notes],
  )

  const setThreadReferences = useCallback(
    (
      thread: string,
      update: (
        items: readonly AttachedReference[],
      ) => readonly AttachedReference[],
    ) => {
      if (!scopeKey) return
      setDrafts((current) => {
        const byThread = new Map(
          current?.scopeKey === scopeKey ? current.byThread : undefined,
        )
        const existing = byThread.get(thread) ?? EMPTY_REFERENCES
        byThread.delete(thread)
        const next = update(existing)
        if (next.length) byThread.set(thread, next)
        if (byThread.size > MAX_DRAFT_THREADS) {
          const first = byThread.keys().next().value
          if (first !== undefined) byThread.delete(first)
        }
        return { scopeKey, byThread }
      })
    },
    [scopeKey],
  )

  const addReference = useCallback(
    (reference: Reference, newChat = false) => {
      if (!scopeKey || !companyId || (readonly && !newChat)) return
      if (
        !newChat &&
        !active.some((item) => sameReference(item.reference, reference)) &&
        active.length >= MAX_ASSISTANT_HISTORY_REFERENCES &&
        sessionKey
      ) {
        setReferenceLimit({ scopeKey, sessionKey })
        return
      }
      const thread = newChat ? onNewChat() : sessionKey
      if (!thread) return
      setReferenceLimit(null)
      setThreadReferences(thread, (items) =>
        items.some((item) => sameReference(item.reference, reference)) ||
        items.length >= MAX_ASSISTANT_HISTORY_REFERENCES
          ? items
          : [...items, { reference }],
      )
    },
    [
      active,
      companyId,
      onNewChat,
      readonly,
      scopeKey,
      sessionKey,
      setThreadReferences,
    ],
  )

  const clearReferences = useCallback(
    (threadKey = sessionKey) => {
      if (threadKey) setThreadReferences(threadKey, () => EMPTY_REFERENCES)
    },
    [sessionKey, setThreadReferences],
  )

  const [consumed, setConsumed] = useState<string | null>(null)
  useEffect(() => {
    if (
      !moduleReference ||
      moduleReference.id === consumed ||
      !scopeKey ||
      !companyId
    )
      return
    setConsumed(moduleReference.id)
    addReference(moduleReference.reference, true)
  }, [addReference, companyId, consumed, moduleReference, scopeKey])

  const label = (reference: Reference) => {
    switch (reference.kind) {
      case "message":
        return t("aiChat.history.referenceMessage", {
          defaultValue: "Earlier chat message",
        })
      case "decision":
        return t("aiChat.history.referenceDecision", {
          defaultValue: "Saved chat decision",
        })
      case "import_decision":
        return t("aiChat.history.referenceImportDecision", {
          defaultValue: "Saved import decision",
        })
      case "import_mapping":
        return t("aiChat.history.referenceImportMapping", {
          defaultValue: "Confirmed import mapping",
        })
      case "approval_receipt":
        return t("aiChat.history.referenceApproval", {
          defaultValue: "Saved approval receipt",
        })
    }
  }

  const openSource = (reference: Reference) => {
    if (scopeKey) setSource({ scopeKey, reference })
  }

  const referenceActions = (reference: Reference) => (
    <div className="flex flex-wrap gap-1">
      {!readonly && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => addReference(reference)}
        >
          {t("aiChat.history.useInDraft", { defaultValue: "Add reference" })}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => addReference(reference, true)}
      >
        {t("aiChat.history.useInNewChat", { defaultValue: "Use in new chat" })}
      </Button>
    </div>
  )

  const renderMessageActions = (message: ChatMessage) => {
    if (!scopeKey || !sessionKey || !companyId || message.role === "system")
      return null
    const parsed = assistantHistoryReference.safeParse({
      kind: "message",
      sessionKey,
      messageId: message.id,
    })
    if (!parsed.success || parsed.data.kind !== "message") return null
    const reference = parsed.data
    const saved = notesByMessage.get(message.id)
    const proposalLinks =
      message.actions?.flatMap((action) => {
        const href =
          action.nativeAction &&
          assistantSavedWidgetHref(action.nativeAction, companyId)
        return href ? [{ href, label: action.label }] : []
      }) ?? []
    const savedLinks = widgetReceipts.isError
      ? []
      : (widgetReceipts.data ?? [])
          .filter((receipt) => receipt.messageId === message.id)
          .map((receipt) => ({
            href: assistantWidgetReceiptHref(receipt, companyId),
            label: t("aiChat.history.savedChart", {
              defaultValue: "Saved chart",
            }),
          }))
    const widgetLinks = [...savedLinks, ...proposalLinks]
    return (
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          {referenceActions(reference)}
          {!readonly && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEdit({ scopeKey, reference, existing: saved })}
            >
              {saved
                ? t("aiChat.history.reviseDecision", {
                    defaultValue: "Revise decision",
                  })
                : t("aiChat.history.saveDecision", {
                    defaultValue: "Save decision",
                  })}
            </Button>
          )}
        </div>
        {widgetLinks.map((widget) => (
          <a
            key={widget.href}
            className="inline-flex min-h-8 items-center text-sm font-medium text-primary underline underline-offset-4"
            aria-label={t("aiChat.history.openCurrentWidget", {
              defaultValue: "Open current view for {{widget}}",
              widget: widget.label,
            })}
            href={widget.href}
          >
            {t("aiChat.history.openCurrentView", {
              defaultValue: "Open current view",
            })}
          </a>
        ))}
        {saved && (
          <section className="rounded-md border p-3 text-sm">
            <div className="font-medium">{label(saved.reference)}</div>
            <p className="whitespace-pre-wrap break-words">{saved.note}</p>
            <p className="text-xs text-muted-foreground">
              {t("aiChat.history.decisionReceipt", {
                defaultValue: "You confirmed revision {{revision}} · {{date}}",
                revision: saved.reference.revision,
                date: sourceDate(saved.createdAt),
              })}
            </p>
            <div className="flex flex-wrap items-center">
              {referenceActions(saved.reference)}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => openSource(saved.reference)}
              >
                {t("aiChat.history.viewSource", {
                  defaultValue: "View source",
                })}
              </Button>
            </div>
          </section>
        )}
      </div>
    )
  }

  const renderImportDecision = (task: ChatImportTask) => {
    const receipt = task.decisionReceipt
    if (
      !receipt ||
      task.conversationKey !== sessionKey ||
      task.companyId !== String(companyId)
    )
      return null
    const reference: Reference = {
      kind: "import_decision",
      sessionKey: task.conversationKey,
      taskId: task.requestId,
      decisionId: receipt.decisionId,
      revision: receipt.revision,
    }
    return (
      <section className="rounded-md border p-3 text-sm">
        <div className="font-medium">{label(reference)}</div>
        <p className="text-xs text-muted-foreground">
          {t("aiChat.history.decisionReceipt", {
            defaultValue: "You confirmed revision {{revision}} · {{date}}",
            revision: receipt.revision,
            date: sourceDate(receipt.createdAt),
          })}
        </p>
        {referenceActions(reference)}
      </section>
    )
  }

  const renderCitation = (citation: ChatMessageSourceRef) => {
    if (citation.source_kind !== "assistant_history" || !citation.source_key)
      return null
    try {
      const reference = assistantHistoryReference.parse(
        JSON.parse(citation.source_key),
      )
      return (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto whitespace-normal p-0 text-left"
          onClick={() => openSource(reference)}
        >
          {label(reference)}
          {"revision" in reference
            ? " · " +
              t("aiChat.history.revision", {
                defaultValue: "Revision {{revision}}",
                revision: reference.revision,
              })
            : ""}
        </Button>
      )
    } catch {
      return null
    }
  }

  const composerContext: ReactNode = (
    <>
      {!!active.length && (
        <ul
          className="flex flex-wrap gap-2"
          aria-label={t("aiChat.history.attachedReferences", {
            defaultValue: "Attached chat references",
          })}
        >
          {active.map(({ reference, unavailable }) => (
            <li
              key={referenceKey(reference)}
              className="flex max-w-full flex-wrap items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => openSource(reference)}
              >
                {label(reference)}
                {"revision" in reference ? " · " + reference.revision : ""}
              </Button>
              {unavailable && (
                <span role="status">
                  {t("aiChat.history.referenceUnavailable", {
                    defaultValue: "Source unavailable",
                  })}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t("aiChat.history.removeReference", {
                  defaultValue: "Remove {{reference}}",
                  reference: label(reference),
                })}
                onClick={() => {
                  if (sessionKey)
                    setThreadReferences(sessionKey, (items) =>
                      items.filter(
                        (item) => !sameReference(item.reference, reference),
                      ),
                    )
                  setReferenceLimit(null)
                }}
              >
                {t("aiChat.history.removeReferenceShort", {
                  defaultValue: "Remove",
                })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {referenceLimit?.scopeKey === scopeKey &&
        referenceLimit.sessionKey === sessionKey && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("aiChat.history.referenceLimit", {
              defaultValue:
                "Remove a reference before adding another. Each chat can attach up to four.",
            })}
          </p>
        )}
    </>
  )
  const referenceOverlay: ReactNode = (
    <>
      {companyId && editDecision && (
        <DecisionEditor
          key={referenceKey(editDecision.reference)}
          companyId={companyId}
          reference={editDecision.reference}
          existing={editDecision.existing}
          close={() => setEdit(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({
              queryKey: ["assistant-chat-decisions", scopeKey, sessionKey],
            })
          }}
        />
      )}
      {companyId && viewSource && (
        <ReferenceSource
          key={referenceKey(viewSource)}
          companyId={companyId}
          reference={viewSource}
          title={label(viewSource)}
          close={() => setSource(null)}
          onOpenMessage={onOpenMessage}
          onUnavailable={() => {
            if (sessionKey)
              setThreadReferences(sessionKey, (items) =>
                items.some(
                  (item) =>
                    !item.unavailable &&
                    sameReference(item.reference, viewSource),
                )
                  ? items.map((item) =>
                      sameReference(item.reference, viewSource)
                        ? { ...item, unavailable: true }
                        : item,
                    )
                  : items,
              )
          }}
        />
      )}
    </>
  )

  return {
    historyRefs,
    renderMessageActions,
    composerContext,
    referenceOverlay,
    clearReferences,
    renderCitation,
    addReference,
    renderImportDecision,
  }
}

function DecisionEditor({
  companyId,
  reference,
  existing,
  close,
  onSaved,
}: {
  companyId: number
  reference: MessageReference
  existing?: DecisionNote
  close: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState(existing?.note ?? "")
  const [request, setRequest] = useState(() => ({
    decisionId: existing?.reference.decisionId ?? id(),
    requestId: id(),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const maxBytes = 2_000
  const valid =
    !!note.trim() && new TextEncoder().encode(note.trim()).length <= maxBytes
  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(false)
    try {
      const response = await apiFetch("/api/ai/chat/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          sessionKey: reference.sessionKey,
          messageId: reference.messageId,
          ...request,
          expectedRevision: existing?.reference.revision ?? 0,
          note,
        }),
      })
      const saved = decisionNote(await checkedResponse(response))
      if (
        saved.reference.sessionKey !== reference.sessionKey ||
        saved.reference.messageId !== reference.messageId ||
        saved.reference.decisionId !== request.decisionId ||
        saved.reference.revision !== (existing?.reference.revision ?? 0) + 1
      ) {
        throw new Error("Saved decision does not match the requested revision")
      }
      onSaved()
      close()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <DialogContent size="confirmation" layout="bounded">
        <DialogHeader>
          <DialogTitle>
            {t("aiChat.history.saveDecision", {
              defaultValue: "Save decision",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("aiChat.history.decisionDescription", {
              defaultValue: "Record what you confirmed in this conversation.",
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Textarea
            aria-label={t("aiChat.history.decisionNote", {
              defaultValue: "Confirmed decision",
            })}
            value={note}
            maxLength={maxBytes}
            disabled={busy}
            onChange={(event) => {
              setNote(event.target.value)
              if (error) {
                setRequest((current) => ({ ...current, requestId: id() }))
                setError(false)
              }
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("aiChat.history.decisionSaveFailed", {
                defaultValue:
                  "The decision could not be saved. Your note is retained.",
              })}
            </p>
          )}
          <Button
            type="button"
            disabled={!valid || busy}
            onClick={() => void save()}
          >
            {t("aiChat.history.confirmDecision", {
              defaultValue: "Confirm and save",
            })}
          </Button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function id(): string {
  return crypto.randomUUID().replaceAll("-", "")
}

const referenceExcerpt = z.object({
  content: z.string().max(3_200).nullable().optional(),
  assistantContextUnavailable: z.boolean().optional(),
  note: z.string().max(2_000).nullable().optional(),
  confirmedValues: z.string().max(3_200).optional(),
  choice: z.string().max(100).optional(),
  decision: z.string().max(100).nullable().optional(),
  createdAt: z.unknown().optional(),
  confirmedBy: z.string().max(128).nullable().optional(),
  latestRevision: z.union([z.string(), z.number()]).nullable().optional(),
  subjectModel: z.string().max(100).nullable().optional(),
  subjectId: z.string().max(20).nullable().optional(),
})

function ReferenceSource({
  companyId,
  reference,
  title,
  close,
  onOpenMessage,
  onUnavailable,
}: {
  companyId: number
  reference: Reference
  title: string
  close: () => void
  onOpenMessage: (sessionKey: string, messageId: string) => void
  onUnavailable: () => void
}) {
  const { t } = useTranslation()
  const [excerpt, setExcerpt] = useState<z.infer<
    typeof referenceExcerpt
  > | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await apiFetch("/api/ai/chat/references/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, references: [reference] }),
          signal: controller.signal,
          cache: "no-store",
        })
        const payload = z
          .object({
            companyId: z.string(),
            references: z
              .array(
                z.object({
                  reference: assistantHistoryReference,
                  excerpt: referenceExcerpt,
                }),
              )
              .length(1),
          })
          .parse(await checkedResponse(response))
        const saved = payload.references[0]
        if (
          !saved ||
          payload.companyId !== String(companyId) ||
          !sameReference(saved.reference, reference)
        )
          throw new Error("Reference changed")
        if (!controller.signal.aborted) setExcerpt(saved.excerpt)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    })()
    return () => controller.abort()
  }, [companyId, reference])
  const unavailableCallback = useRef(onUnavailable)
  unavailableCallback.current = onUnavailable
  useEffect(() => {
    if (failed) unavailableCallback.current()
  }, [failed])
  const nativeHref =
    reference.kind === "import_decision"
      ? importTaskHref({ taskId: reference.taskId, companyId, view: "sources" })
      : reference.kind === "import_mapping"
        ? sourceReviewHistoryHref(String(companyId), {
            batchId: reference.batchId,
            itemId: reference.itemId,
            revision: reference.revision,
          })
        : reference.kind === "approval_receipt" &&
            typeof excerpt?.subjectModel === "string" &&
            typeof excerpt.subjectId === "string"
          ? approvalRecordHref(
              excerpt.subjectModel,
              Number.isSafeInteger(Number(excerpt.subjectId))
                ? Number(excerpt.subjectId)
                : undefined,
            )
          : null
  const message = "messageId" in reference ? reference : null
  const text =
    excerpt &&
    [
      excerpt.content,
      excerpt.note,
      excerpt.confirmedValues,
      excerpt.choice,
      excerpt.decision,
    ].find((value) => typeof value === "string")
  const superseded =
    excerpt &&
    "revision" in reference &&
    Number(excerpt.latestRevision) > Number(reference.revision)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent size="confirmation" layout="bounded">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {"revision" in reference
              ? t("aiChat.history.revision", {
                  defaultValue: "Revision {{revision}}",
                  revision: reference.revision,
                })
              : t("aiChat.history.sourceDescription", {
                  defaultValue: "Original saved conversation source",
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {failed ? (
            <p role="alert">
              {t("aiChat.history.referenceUnavailable", {
                defaultValue: "Source unavailable",
              })}
            </p>
          ) : !excerpt ? (
            <p role="status">{t("common.loading")}</p>
          ) : (
            <>
              {typeof text === "string" && (
                <p className="whitespace-pre-wrap break-words">{text}</p>
              )}
              {excerpt.assistantContextUnavailable && (
                <p className="text-sm text-muted-foreground">
                  {t("aiChat.history.derivedReplyUnavailable", {
                    defaultValue:
                      "This reply links to the original conversation. Its source data must be retrieved again for a new answer.",
                  })}
                </p>
              )}
              {typeof excerpt.createdAt === "string" && (
                <p className="text-sm text-muted-foreground">
                  {sourceDate(excerpt.createdAt)}
                </p>
              )}
              {typeof excerpt.confirmedBy === "string" && (
                <p className="break-all text-sm text-muted-foreground">
                  {t("aiChat.history.confirmedBy", {
                    defaultValue: "Confirmed by {{actor}}",
                    actor: excerpt.confirmedBy,
                  })}
                </p>
              )}
              {superseded && (
                <p role="status">
                  {t("aiChat.history.newerDecision", {
                    defaultValue:
                      "A newer revision exists. You are viewing the selected revision.",
                  })}
                </p>
              )}
              {message && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    close()
                    onOpenMessage(message.sessionKey, message.messageId)
                  }}
                >
                  {t("aiChat.history.openMessage", {
                    defaultValue: "Open original message",
                  })}
                </Button>
              )}
              {nativeHref && (
                <a
                  className="text-sm underline underline-offset-4"
                  href={nativeHref}
                >
                  {t("aiChat.history.openWorkflowSource", {
                    defaultValue: "Open workflow source",
                  })}
                </a>
              )}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
