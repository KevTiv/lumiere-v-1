"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useCallback, useEffect, useMemo, useState } from "react"
import { canUseModuleData, mergeModuleStates, moduleCollection } from "@lumiere/ui/lib/module-data-state"
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
import { messageAuthorName, messageRecordHref } from "./message-record"
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
import { useContacts, useUsers } from "@lumiere/query-hooks/hooks/crm"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { mailMessageRowsToSelectOptions } from "@/lib/form-lookup"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { messageRecordChoices, resolveMessageRecordChoice } from "./message-record-choice"

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
  const messagesRead = moduleCollection(useMailMessages(orgId, initialMessages))
  const messages = messagesRead.rows
  const followersRead = moduleCollection(useMailFollowers(orgId, initialFollowers))
  const followers = followersRead.rows
  const contactsQuery = useContacts(orgId)
  const { data: contacts = [] } = contactsQuery
  const { data: users = [] } = useUsers(orgId)
  const accountMovesQuery = useAccountMoves(orgId)
  const { data: accountMoves = [] } = accountMovesQuery
  const contactChoicesRead = moduleCollection(contactsQuery)
  const moveChoicesRead = moduleCollection(accountMovesQuery)
  const postMessage = usePostMessage(orgId)
  const subscribeToRecord = useSubscribeToRecord(orgId)
  const unsubscribeFromRecord = useUnsubscribeFromRecord(orgId)

  const parentMessageOptions = useMemo(
    () => mailMessageRowsToSelectOptions(messages as Record<string, unknown>[]),
    [messages],
  )

  const recordChoices = useMemo(() => messageRecordChoices(
    moveChoicesRead.rows as unknown as Record<string, unknown>[],
    contactChoicesRead.rows as unknown as Record<string, unknown>[],
    { organizationId, companyId: activeCompanyId },
    {
      invoice: t("messages.forms.recordChoice.invoice", { defaultValue: "Invoice" }),
      bill: t("messages.forms.recordChoice.bill", { defaultValue: "Vendor bill" }),
      creditNote: t("messages.forms.recordChoice.creditNote", { defaultValue: "Credit note" }),
      vendorCredit: t("messages.forms.recordChoice.vendorCredit", { defaultValue: "Vendor credit" }),
      journalEntry: t("messages.forms.recordChoice.journalEntry", { defaultValue: "Journal entry" }),
      accountingDocument: t("messages.forms.recordChoice.accountingDocument", { defaultValue: "Accounting document" }),
      contact: t("messages.forms.recordChoice.contact", { defaultValue: "Contact" }),
    },
  ), [moveChoicesRead.rows, contactChoicesRead.rows, organizationId, activeCompanyId, t])
  const recordChoicesLoading = contactChoicesRead.state.status === "loading" || moveChoicesRead.state.status === "loading"
  const recordHint = recordChoicesLoading
    ? t("messages.forms.recordChoice.loading", { defaultValue: "Loading available records. Your message can stay open while the choices load." })
    : !canUseModuleData(contactChoicesRead.state) || !canUseModuleData(moveChoicesRead.state)
      ? t("messages.forms.recordChoice.unavailable", { defaultValue: "Some record choices could not be loaded. Refresh the page to reload the available records." })
      : undefined

  const mailMessageFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newMailMessageForm(t, recordChoices, recordHint), {
        parentId: parentMessageOptions,
      }),
    [t, parentMessageOptions, recordChoices, recordHint],
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
        if (tab.id === "messages" || tab.id === "notifications") {
          const view = tab.entityConfig?.view
          const withAuthor =
            tab.entityConfig && view?.mode === "table"
              ? {
                  entityConfig: {
                    ...tab.entityConfig,
                    view: {
                      ...view,
                      columns: [
                        ...view.columns,
                        { key: "authorName", label: t("messages.messages.columns.author", { defaultValue: "Author" }), width: "min-w-32" },
                      ],
                    },
                  },
                }
              : {}
          return {
            ...tab,
            ...withAuthor,
            ...(tab.id === "messages" ? { createForm: mailMessageFormConfig } : {}),
            recordSheet: {
              titleKey: "body",
              openHref: messageRecordHref,
              detailConfig: {
                mode: "detail" as const,
                sections: [
                  {
                    id: "message",
                    fields: [
                      { key: "model", label: t("messages.messages.columns.model") },
                      { key: "resId", label: t("messages.messages.columns.resId") },
                      { key: "messageType", label: t("messages.messages.columns.messageType") },
                      { key: "date", label: t("messages.messages.columns.date"), type: "datetime" as const },
                    ],
                  },
                ],
              },
            },
          }
        }
        return tab
      }),
    }),
    [accountMoves, activeCompanyId, contacts, liveSections, t, moduleConfig, mailMessageFormConfig, organizationId],
  )

  const withAuthorNames = useCallback(
    (rows: MailMessage[]) =>
      (rows as unknown as Record<string, unknown>[]).map((row) => ({
        ...row,
        authorName: messageAuthorName(row, users as unknown as Record<string, unknown>[]),
      })),
    [users],
  )

  const data = useMemo(
    () => ({
      messages: withAuthorNames(messages),
      notifications: withAuthorNames(myNotifications),
      followers: followers as unknown as Record<string, unknown>[],
    }),
    [messages, myNotifications, followers, withAuthorNames],
  )

  const inboxState = mergeModuleStates([messagesRead.state, followersRead.state])
  const dataState = {
    dashboard: inboxState,
    messages: messagesRead.state,
    notifications: inboxState,
    followers: followersRead.state,
  }
  const actionTabs: Record<string, keyof typeof dataState> = {
    createMessage: "messages", subscribeToRecord: "followers", unsubscribeFromRecord: "followers",
  }
  const actionUsable = (action: string) => {
    const tab = actionTabs[action]
    return tab == null || canUseModuleData(dataState[tab])
  }
  const quickActionUsable = quickActionForm == null || actionUsable(quickActionForm.action)
  useEffect(() => {
    if (!quickActionUsable) setQuickActionForm(null)
  }, [quickActionUsable])

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!actionUsable(action)) throw new Error("Required data is unavailable. Refresh and try again.")
    if (action === "createMessage") {
      const body = String(formData.body ?? "").trim()
      if (!body) throw new Error(t("messages.forms.errors.bodyRequired", { defaultValue: "Write a message before saving. Your entries are retained." }))
      const reference = resolveMessageRecordChoice(formData, recordChoices)
      if (!reference) throw new Error(t("messages.forms.errors.recordChoiceRequired", { defaultValue: "Choose an available record, or check the advanced custom reference. Your entries are retained." }))
      await postMessage.mutateAsync({
        model: reference.model,
        resId: reference.resId,
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
      const resId = optionalBigIntU64(formData.resId)
      if (!resModel || !resId) throw new Error(t("messages.forms.errors.recordTypeRequired", { defaultValue: "Enter a record type and an existing record number. Your entries are retained." }))
      await subscribeToRecord.mutateAsync({
        resModel,
        resId,
        subtypes: csvList(formData.subtypes),
      })
      return
    }

    if (action === "unsubscribeFromRecord") {
      const resModel = String(formData.resModel ?? "").trim()
      const resId = optionalBigIntU64(formData.resId)
      if (!resModel || !resId) throw new Error(t("messages.forms.errors.recordTypeRequired", { defaultValue: "Enter a record type and an existing record number. Your entries are retained." }))
      await unsubscribeFromRecord.mutateAsync({
        resModel,
        resId,
      })
      return
    }
    throw new Error(t("messages.forms.errors.unsupportedAction", { defaultValue: "This message action is unavailable. Close and reopen the form before trying again." }))
  }

  const isFormMutationPending =
    postMessage.isPending || subscribeToRecord.isPending || unsubscribeFromRecord.isPending

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        dataState={dataState}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null && quickActionUsable}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.action === "createMessage" ? mailMessageFormConfig : quickActionForm?.form ?? mailMessageFormConfig}
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
