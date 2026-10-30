"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MessageCircleIcon, SendIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  useAppendCrmConversationMessage,
  useContactPhoneIdentities,
  useCrmConversationMessages,
  useCrmConversations,
  useOpenCrmConversation,
  useUpdateCrmConversation,
} from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"
import { mergeModuleStates, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"

type Row = Record<string, unknown>

function channelTag(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: unknown }).tag)
  }
  return String(value ?? "")
}

function isPhoneIdentityUsable(row: Row, contactId: bigint): boolean {
  if (asId(row.contactId ?? row.contact_id) !== contactId) return false
  if (optionValue(row.archivedAt ?? row.archived_at) != null) return false
  const kind = channelTag(row.kind)
  const state = channelTag(row.verificationState ?? row.verification_state)
  return (kind === "WhatsApp" || kind === "Primary") && state !== "OptedOut"
}

export interface CrmInboxPanelProps {
  organizationId: number
  contactId: bigint
}

export function CrmInboxPanel({ organizationId, contactId }: CrmInboxPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const conversationsQuery = useCrmConversations(organization)
  const messagesQuery = useCrmConversationMessages(organization)
  const phoneIdentitiesQuery = useContactPhoneIdentities(organization)
  const sourceState = mergeModuleStates([conversationsQuery, messagesQuery, phoneIdentitiesQuery].map(moduleQueryState))
  const ready = sourceState.status === "ready"
  const conversations = ready ? conversationsQuery.data ?? [] : []
  const messages = ready ? messagesQuery.data ?? [] : []
  const phoneIdentities = ready ? phoneIdentitiesQuery.data ?? [] : []
  const openConversation = useOpenCrmConversation(organization)
  const appendMessage = useAppendCrmConversationMessage(organization)
  const updateConversation = useUpdateCrmConversation(organization)
  const [body, setBody] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)
  const scope = `${organizationId}:${contactId}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  useEffect(() => { setBody(""); setActionError(null) }, [organizationId, contactId])
  const busy = openConversation.isPending || appendMessage.isPending || updateConversation.isPending
  const submitting = useRef(false)
  const runAction = async (action: () => Promise<unknown>) => {
    if (!ready || busy || submitting.current) return
    submitting.current = true
    setActionError(null)
    try { await action() }
    catch (cause) {
      if (activeScope.current === scope) setActionError(cause instanceof Error ? cause.message : t("crm.inbox.actionFailed", { defaultValue: "The request failed. Your message has been retained." }))
    } finally { submitting.current = false }
  }

  const conversation = useMemo(() => {
    return (
      (conversations as Row[]).find((row) => {
        if (asId(row.contactId ?? row.contact_id) !== contactId) return false
        return String(row.status ?? "") !== "closed"
      }) ?? null
    )
  }, [conversations, contactId])

  const conversationId = conversation ? asId(conversation.id) : null

  const phoneIdentityId = useMemo(() => {
    const candidates = (phoneIdentities as Row[]).filter((row) =>
      isPhoneIdentityUsable(row, contactId),
    )
    const preferred = candidates.find((row) => Boolean(row.isPreferred ?? row.is_preferred))
    return preferred ? asId(preferred.id) : candidates[0] ? asId(candidates[0].id) : null
  }, [contactId, phoneIdentities])

  const thread = useMemo(() => {
    if (!conversationId) return []
    return (messages as Row[]).filter(
      (row) => asId(row.conversationId ?? row.conversation_id) === conversationId,
    )
  }, [messages, conversationId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crm.inbox.title", "WhatsApp inbox")}</CardTitle>
        <CardDescription>
          {t(
            "crm.inbox.description",
            "Review this contact's WhatsApp conversation. Queued messages have not yet been confirmed delivered.",
          )}
        </CardDescription>
        <CardAction className="flex gap-2">
          {!conversation ? (
            <Button
              size="sm"
              disabled={!ready || busy || phoneIdentityId == null}
              onClick={() =>
                void runAction(() => openConversation.mutateAsync({
                  contactId,
                  channel: { tag: "WhatsApp" },
                  phoneIdentityId: phoneIdentityId ?? undefined,
                  externalThreadId: undefined,
                  assignedUserId: undefined,
                  metadata: undefined,
                }))
              }
            >
              {t("crm.inbox.open", "Open thread")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!ready || busy || !conversationId}
              onClick={() =>
                conversationId &&
                void runAction(() => updateConversation.mutateAsync({
                  conversationId,
                  params: {
                    status: "closed",
                    assignedUserId: undefined,
                    externalThreadId: undefined,
                    metadata: undefined,
                  },
                }))
              }
            >
              {t("crm.inbox.close", "Close")}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <ModuleDataNotice state={sourceState} />
        {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
        {sourceState.status === "loading" ? (
          <p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
        ) : !ready ? null : !conversation || !conversationId ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleIcon />
              </EmptyMedia>
              <EmptyTitle>{t("crm.inbox.emptyTitle", "No open conversation")}</EmptyTitle>
              <EmptyDescription>
                {phoneIdentityId == null
                  ? t("crm.inbox.phoneRequired", { defaultValue: "Add an eligible WhatsApp phone identity to this contact before opening a thread." })
                  : t("crm.inbox.emptyDescription", "Open a WhatsApp thread for this contact.")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{channelTag(conversation.channel)}</Badge>
              <Badge variant="outline">{String(conversation.status)}</Badge>
              {conversation.lastPreview || conversation.last_preview ? (
                <span className="text-muted-foreground truncate">
                  {String(optionValue(conversation.lastPreview ?? conversation.last_preview))}
                </span>
              ) : null}
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {thread.map((msg) => (
                <li
                  key={String(msg.id)}
                  className="rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline">{String(msg.direction)}</Badge>
                    <span className="text-muted-foreground text-xs">{String(msg.status)}</span>
                  </div>
                  <p className="[overflow-wrap:anywhere]">{String(msg.body)}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              <Label htmlFor="crm-inbox-body">{t("crm.inbox.compose", "Outbound message")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="crm-inbox-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("crm.inbox.placeholder", "Type a message…")}
                />
                <Button
                  aria-label={t("crm.inbox.queueMessage", { defaultValue: "Queue message" })}
                  disabled={!ready || !body.trim() || busy}
                  onClick={() => {
                    const submittedBody = body.trim()
                    void runAction(async () => {
                      await appendMessage.mutateAsync(
                      {
                        conversationId,
                        params: {
                          direction: "outbound",
                          body: submittedBody,
                          status: "queued",
                          providerMessageId: undefined,
                          operationalMessageId: undefined,
                          metadata: undefined,
                        },
                      },
                      )
                      if (activeScope.current === scope) setBody((current) => current.trim() === submittedBody ? "" : current)
                    })
                  }}
                >
                  <SendIcon className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
