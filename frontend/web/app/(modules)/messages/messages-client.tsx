"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import {
  ModuleView,
  FormModal,
  newMailMessageForm,
  subscribeToRecordForm,
  unsubscribeFromRecordForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { messagesModuleConfig } from "@/lib/module-dashboard-configs"
import { MessageBatchesPanel } from "./message-batches-panel"
import { useMessagesModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useMailFollowers,
  useMailMessages,
  usePostMessage,
  useSubscribeToRecord,
  useUnsubscribeFromRecord,
  type MailFollower,
  type MailMessage,
} from "@lumiere/query-hooks/hooks/messages"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { mailMessageRowsToSelectOptions } from "@/lib/form-lookup"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

interface MessagesClientProps {
  initialMessages?: MailMessage[]
  initialFollowers?: MailFollower[]
  organizationId?: number
}

type MessagesClientLoadedProps = Omit<MessagesClientProps, "organizationId"> & {
  organizationId: number
}

function csvList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function identityHex(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.toLowerCase()
  if (typeof v === "object" && v !== null && "toHex" in v) {
    const th = (v as { toHex: () => { toString: () => string } }).toHex
    if (typeof th === "function") return th.call(v).toString().toLowerCase()
  }
  return String(v).toLowerCase()
}

function parseMetadataRecipient(metadata: unknown): string | null {
  if (metadata == null || metadata === "") return null
  try {
    const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata
    if (parsed && typeof parsed === "object" && "recipient" in parsed) {
      return String((parsed as { recipient: unknown }).recipient).toLowerCase()
    }
  } catch {
    return null
  }
  return null
}

function isNotificationMessage(row: MailMessage): boolean {
  // NOTE: messageType is a generated tagged-union ({ tag: "Notification" | ... }), not a
  // string, so this string comparison never matches — pre-existing bug, preserved as-is.
  const type = String(row.messageType ?? "").toLowerCase()
  return type === "notification" || type === "user_notification"
}

export function MessagesClient(props: MessagesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <MessagesClientLoaded {...props} organizationId={props.organizationId} />
}

function MessagesClientLoaded({ initialMessages, initialFollowers, organizationId }: MessagesClientLoadedProps) {
  useMessagesModuleSubscription()
  const { t } = useTranslation()
  const { identity, activeCompanyId } = useErpSession()
  const moduleConfig = useMemo(() => messagesModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { data: messages = [] } = useMailMessages(orgId, initialMessages)
  const { data: followers = [] } = useMailFollowers(orgId, initialFollowers)
  const { data: contacts = [] } = useContacts(orgId)
  const { data: accountMoves = [] } = useAccountMoves(orgId)
  const postMessage = usePostMessage(orgId)
  const subscribeToRecord = useSubscribeToRecord(orgId)
  const unsubscribeFromRecord = useUnsubscribeFromRecord(orgId)

  const parentMessageOptions = useMemo(
    () => mailMessageRowsToSelectOptions(messages as Record<string, unknown>[]),
    [messages],
  )

  const mailMessageFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newMailMessageForm(t), {
        parentId: parentMessageOptions,
      }),
    [t, parentMessageOptions],
  )

  const myNotifications = useMemo(() => {
    if (!identity) return []
    const me = identity.toLowerCase()
    const followedKeys = new Set(
      followers
        .filter((f) => identityHex(f.partnerId) === me)
        .map((f) => `${String(f.resModel)}:${String(f.resId)}`),
    )

    return messages.filter((m) => {
      if (!isNotificationMessage(m)) return false
      const recipient = parseMetadataRecipient(m.metadata)
      if (recipient === me) return true
      const key = `${String(m.model)}:${String(m.resId)}`
      return followedKeys.has(key)
    })
  }, [messages, followers, identity])

  const liveSections = useMemo(() => {
    const emails = messages.filter((m) => String(m.messageType) === "email").length
    const comments = messages.filter((m) => String(m.messageType) === "comment").length
    const notifications = myNotifications.length

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("messages.dashboard.totalMessages"), value: String(messages.length), icon: "MessageSquare" },
                { label: t("messages.dashboard.emails"), value: String(emails), icon: "Mail" },
                { label: t("messages.dashboard.comments"), value: String(comments), icon: "MessageCircle" },
                { label: t("messages.dashboard.notifications"), value: String(notifications), icon: "Bell" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_message: () => setQuickActionForm({ form: mailMessageFormConfig, action: "createMessage" }),
            subscribe_record: () =>
              setQuickActionForm({ form: subscribeToRecordForm(t), action: "subscribeToRecord" }),
            unsubscribe_record: () =>
              setQuickActionForm({ form: unsubscribeFromRecordForm(t), action: "unsubscribeFromRecord" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
          })
  }, [messages, myNotifications.length, moduleConfig, t, mailMessageFormConfig])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
        if (tab.id === "message-batches") {
          return {
            ...tab,
            customContent: <MessageBatchesPanel organizationId={organizationId} companyId={activeCompanyId != null ? BigInt(activeCompanyId) : 0n} contacts={contacts as Record<string, unknown>[]} invoices={accountMoves as Record<string, unknown>[]} />,
          }
        }
        return tab
      }),
    }),
    [accountMoves, activeCompanyId, contacts, liveSections, moduleConfig, mailMessageFormConfig, organizationId],
  )

  const data = useMemo(
    () => ({
      messages: messages as unknown as Record<string, unknown>[],
      notifications: myNotifications as unknown as Record<string, unknown>[],
      followers: followers as unknown as Record<string, unknown>[],
    }),
    [messages, myNotifications, followers],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createMessage") {
      const body = String(formData.body ?? "").trim()
      if (!body) return
      const resRaw = formData.resId
      if (resRaw === "" || resRaw == null) return
      const resNum = Number(resRaw)
      if (!Number.isFinite(resNum) || resNum <= 0) return
      await postMessage.mutateAsync({
        model: formData.model ? String(formData.model) : "mail.message",
        resId: BigInt(Math.floor(resNum)),
        body,
        messageType: formData.messageType ? String(formData.messageType) : "comment",
        subtype: formData.subtype ? String(formData.subtype) : null,
        parentId: optionalBigIntU64(formData.parentId) ?? null,
        attachmentIds: [],
      })
      return
    }

    if (action === "subscribeToRecord") {
      const resModel = String(formData.resModel ?? "").trim()
      const resRaw = formData.resId
      if (!resModel || resRaw === "" || resRaw == null) return
      const resNum = Number(resRaw)
      if (!Number.isFinite(resNum) || resNum <= 0) return
      await subscribeToRecord.mutateAsync({
        resModel,
        resId: BigInt(Math.floor(resNum)),
        subtypes: csvList(formData.subtypes),
      })
      return
    }

    if (action === "unsubscribeFromRecord") {
      const resModel = String(formData.resModel ?? "").trim()
      const resRaw = formData.resId
      if (!resModel || resRaw === "" || resRaw == null) return
      const resNum = Number(resRaw)
      if (!Number.isFinite(resNum) || resNum <= 0) return
      await unsubscribeFromRecord.mutateAsync({
        resModel,
        resId: BigInt(Math.floor(resNum)),
      })
    }
  }

  const isFormMutationPending =
    postMessage.isPending || subscribeToRecord.isPending || unsubscribeFromRecord.isPending

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? mailMessageFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
