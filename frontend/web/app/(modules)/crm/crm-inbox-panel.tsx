"use client"

import { useMemo, useState } from "react"
import { MessageCircleIcon, SendIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  useAppendCrmConversationMessage,
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

type Row = Record<string, unknown>

function optionValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && "some" in value) {
    return (value as { some: unknown }).some
  }
  return value
}

function asId(value: unknown): bigint | null {
  const raw = optionValue(value)
  if (raw == null || raw === "") return null
  try {
    return typeof raw === "bigint" ? raw : BigInt(String(raw))
  } catch {
    return null
  }
}

function channelTag(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: unknown }).tag)
  }
  return String(value ?? "")
}

export interface CrmInboxPanelProps {
  organizationId: number
  contactId: bigint
}

export function CrmInboxPanel({ organizationId, contactId }: CrmInboxPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: conversations = [], isLoading } = useCrmConversations(organization)
  const { data: messages = [] } = useCrmConversationMessages(organization)
  const openConversation = useOpenCrmConversation(organization)
  const appendMessage = useAppendCrmConversationMessage(organization)
  const updateConversation = useUpdateCrmConversation(organization)
  const [body, setBody] = useState("")

  const conversation = useMemo(() => {
    return (
      (conversations as Row[]).find((row) => {
        if (asId(row.contactId ?? row.contact_id) !== contactId) return false
        return String(row.status ?? "") !== "closed"
      }) ?? null
    )
  }, [conversations, contactId])

  const conversationId = conversation ? asId(conversation.id) : null

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
            "CRM conversation thread for WhatsApp intents (delivery via workers).",
          )}
        </CardDescription>
        <CardAction className="flex gap-2">
          {!conversation ? (
            <Button
              size="sm"
              disabled={openConversation.isPending}
              onClick={() =>
                openConversation.mutate({
                  contactId,
                  channel: { tag: "WhatsApp" },
                  phoneIdentityId: undefined,
                  externalThreadId: undefined,
                  assignedUserId: undefined,
                  metadata: undefined,
                })
              }
            >
              {t("crm.inbox.open", "Open thread")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={updateConversation.isPending || !conversationId}
              onClick={() =>
                conversationId &&
                updateConversation.mutate({
                  conversationId,
                  params: {
                    status: "closed",
                    assignedUserId: undefined,
                    externalThreadId: undefined,
                    metadata: undefined,
                  },
                })
              }
            >
              {t("crm.inbox.close", "Close")}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
        ) : !conversation || !conversationId ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleIcon />
              </EmptyMedia>
              <EmptyTitle>{t("crm.inbox.emptyTitle", "No open conversation")}</EmptyTitle>
              <EmptyDescription>
                {t("crm.inbox.emptyDescription", "Open a WhatsApp thread for this contact.")}
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
                  <p>{String(msg.body)}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              <Label htmlFor="crm-inbox-body">{t("crm.inbox.compose", "Outbound message")}</Label>
              <div className="flex gap-2">
                <Input
                  id="crm-inbox-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("crm.inbox.placeholder", "Type a message…")}
                />
                <Button
                  size="sm"
                  disabled={!body.trim() || appendMessage.isPending}
                  onClick={() => {
                    appendMessage.mutate(
                      {
                        conversationId,
                        params: {
                          direction: "outbound",
                          body: body.trim(),
                          status: "queued",
                          providerMessageId: undefined,
                          operationalMessageId: undefined,
                          metadata: undefined,
                        },
                      },
                      { onSuccess: () => setBody("") },
                    )
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
