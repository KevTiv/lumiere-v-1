"use client"

import { useEffect, useMemo, useState } from "react"
import { MessageCircleIcon } from "lucide-react"

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
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"
import { WhatsAppDispatchAction } from "./whatsapp-dispatch-action"
import { WhatsAppTriagePanel } from "./whatsapp-triage-panel"

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
  const { data: phoneIdentities = [] } = useContactPhoneIdentities(organization)
  const openConversation = useOpenCrmConversation(organization)
  const appendMessage = useAppendCrmConversationMessage(organization)
  const updateConversation = useUpdateCrmConversation(organization)
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBody("")
    setError(null)
  }, [organizationId, contactId])

  const conversation = useMemo(() => {
    const rows = ((conversationsQuery.data ?? []) as Row[]).filter((row) =>
      asId(row.contactId ?? row.contact_id) === contactId && channelTag(row.channel) === "WhatsApp",
    )
    // Prefer the open thread but retain a closed provider thread for explicit reopening.
    return rows.find((row) => String(row.status) !== "closed") ?? rows[0] ?? null
  }, [conversationsQuery.data, contactId])

  const conversationId = conversation ? asId(conversation.id) : null
  const companyId = conversation ? asId(conversation.companyId ?? conversation.company_id) : null
  const accountId = conversation ? asId(optionValue(conversation.providerAccountId ?? conversation.provider_account_id)) : null
  const closed = conversation?.status === "closed"
  const phoneIdentityId = useMemo(() => {
    const candidates = (phoneIdentities as Row[]).filter((row) => isPhoneIdentityUsable(row, contactId))
    const preferred = candidates.find((row) => Boolean(row.isPreferred ?? row.is_preferred))
    return preferred ? asId(preferred.id) : candidates[0] ? asId(candidates[0].id) : null
  }, [contactId, phoneIdentities])

  const thread = useMemo(() => {
    if (!conversationId) return []
    return ((messagesQuery.data ?? []) as Row[])
      .filter((row) => asId(row.conversationId ?? row.conversation_id) === conversationId)
      .sort((left, right) => {
        const a = asId(left.id) ?? 0n
        const b = asId(right.id) ?? 0n
        return a < b ? -1 : a > b ? 1 : 0
      })
  }, [messagesQuery.data, conversationId])

  const showError = (cause: unknown) => setError(cause instanceof Error ? cause.message : "WhatsApp operation could not be confirmed")
  const sourceError = conversationsQuery.isError || messagesQuery.isError

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crm.inbox.title", "WhatsApp inbox")}</CardTitle>
        <CardDescription>{t("crm.whatsapp.description", "Queue a message, review its exact recipient and content, then confirm provider sending.")}</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          {!conversation ? (
            <Button size="sm" disabled={openConversation.isPending || phoneIdentityId == null || sourceError}
              onClick={() => openConversation.mutate({
                contactId, channel: { tag: "WhatsApp" }, phoneIdentityId: phoneIdentityId ?? undefined,
                externalThreadId: undefined, assignedUserId: undefined, metadata: undefined,
              }, { onError: showError })}>
              {t("crm.inbox.open", "Open thread")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={updateConversation.isPending || !conversationId || sourceError}
              onClick={() => conversationId && updateConversation.mutate({
                conversationId,
                params: { status: closed ? "open" : "closed", assignedUserId: undefined, externalThreadId: undefined, metadata: undefined },
              }, { onError: showError })}>
              {closed ? t("crm.whatsapp.reopen", "Reopen thread") : t("crm.inbox.close", "Close")}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {(error || sourceError) && <p role="alert" className="break-words text-sm text-destructive">
          {error ?? t("crm.whatsapp.sourceUnavailable", "Conversation access is unavailable. Cached messages cannot authorize sending.")}
        </p>}
        {conversationsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading", "Loading…")}</p>
        ) : !conversation || !conversationId ? (
          <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageCircleIcon /></EmptyMedia>
            <EmptyTitle>{t("crm.inbox.emptyTitle", "No open conversation")}</EmptyTitle>
            <EmptyDescription>{t("crm.inbox.emptyDescription", "Open a WhatsApp thread for this contact.")}</EmptyDescription>
          </EmptyHeader></Empty>
        ) : !sourceError ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">WhatsApp</Badge><Badge variant="outline">{String(conversation.status)}</Badge>
              <span className="min-w-0 truncate text-muted-foreground">{String(optionValue(conversation.lastPreview ?? conversation.last_preview) ?? "")}</span>
            </div>
            <ul className="max-h-[36rem] min-w-0 space-y-2 overflow-y-auto">
              {thread.map((message) => (
                <li key={String(message.id)} className="min-w-0 rounded-md border border-border/70 px-3 py-2 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{String(message.direction)}</Badge>
                    <span className="text-xs text-muted-foreground">{String(message.status)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{String(message.body ?? "")}</p>
                  {message.direction === "outbound" && message.status === "queued" && companyId && !closed && <WhatsAppDispatchAction
                    key={`${organizationId}:${companyId}:${message.id}`}
                    companyId={String(companyId)} messageId={String(message.id)} onUseTemplate={setBody}
                  />}
                </li>
              ))}
            </ul>
            {!closed && <div className="space-y-2">
              <Label htmlFor={`crm-inbox-body-${contactId}`}>{t("crm.inbox.compose", "Outbound message")}</Label>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Input id={`crm-inbox-body-${contactId}`} value={body} className="min-w-0 flex-1" maxLength={4000}
                  onChange={(event) => setBody(event.target.value)} placeholder={t("crm.inbox.placeholder", "Type a message…")} />
                <Button size="sm" disabled={!body.trim() || appendMessage.isPending}
                  onClick={() => {
                    setError(null)
                    appendMessage.mutate({ conversationId, params: {
                      direction: "outbound", body: body.trim(), status: "queued",
                      providerMessageId: undefined, operationalMessageId: undefined, metadata: undefined,
                    } }, { onSuccess: () => setBody(""), onError: showError })
                  }}>
                  {t("crm.whatsapp.queueForReview", "Queue for review")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("crm.whatsapp.queueNotice", "Queueing does not send a WhatsApp message. A connected sender, recorded consent and a separate confirmation are required.")}</p>
            </div>}
            {companyId && accountId && <WhatsAppTriagePanel key={`${organizationId}:${companyId}:${accountId}`}
              companyId={String(companyId)} accountId={String(accountId)} />}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
