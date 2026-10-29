"use client"
import {
  mapDashboardWidgets,
  withDashboardSections,
} from "@lumiere/ui/lib/dashboard-sections"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  canUseModuleData,
  mergeModuleStates,
  moduleCollection,
} from "@lumiere/ui/lib/module-data-state"
import { useTranslation } from "@lumiere/i18n"
import { newCorrelationId } from "@lumiere/erp-workflows"
import { UnconfirmedPostedMessageError } from "@lumiere/query-hooks/hooks/mail-message-post"
import { useErpSession } from "@lumiere/erp-session"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@lumiere/ui/components/button"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  ModuleView,
  useRBAC,
  FormModal,
  newMailMessageForm,
  subscribeToRecordForm,
  unsubscribeFromRecordForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { messagesModuleConfig } from "@/lib/module-dashboard-configs"
import {
  messageAuthorName,
  messageKind,
  messageRecordHref,
} from "./message-record"
import {
  isNotificationMessage,
  isNotificationRead,
  notificationRecipient,
  sameMessageSource,
} from "./message-conversations"
import {
  MessageConversationWorkspace,
  type MessageReplyInput,
} from "./message-conversation-workspace"
import { MessageBatchesPanel } from "./message-batches-panel"
import { useMessagesModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useMailFollowers,
  useMailMessages,
  usePostMessage,
  confirmPostedMessage,
  useMarkNotificationRead,
  useSubscribeToRecord,
  useUnsubscribeFromRecord,
  type PostMessageInput,
  type MailFollower,
  type MailMessage,
} from "@lumiere/query-hooks/hooks/messages"
import { useContacts, useUsers } from "@lumiere/query-hooks/hooks/crm"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { mailMessageRowsToSelectOptions } from "@/lib/form-lookup"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  messageRecordChoices,
  resolveMessageRecordChoice,
} from "./message-record-choice"

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

function MessageWorkspaceLoading() {
  const { t } = useTranslation()
  return (
    <div role="status" className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        {t("messages.workspace.loading", {
          defaultValue: "Loading conversations and current access…",
        })}
      </p>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

export function MessagesClient(props: MessagesClientProps) {
  const session = useErpSession()
  const { currentUser, roles, policies, permissionsReady } = useRBAC()
  if (!hasValidOrganizationId(props.organizationId))
    return <MissingOrganization />
  const scopeKey = JSON.stringify({
    organizationId: props.organizationId,
    companyId: session.activeCompanyId,
    identity: session.identity,
    currentUser,
    roles,
    policies,
  })
  if (permissionsReady === false || session.activeCompanyReady === false)
    return <MessageWorkspaceLoading />
  return (
    <MessagesClientLoaded
      key={scopeKey}
      {...props}
      organizationId={props.organizationId}
      scopeKey={scopeKey}
    />
  )
}

function MessagesClientLoaded({
  organizationId,
  scopeKey,
}: MessagesClientLoadedProps & { scopeKey: string }) {
  useMessagesModuleSubscription()
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const { t } = useTranslation()
  const { identity, activeCompanyId } = useErpSession()
  const { checkPermission, permissionsReady } = useRBAC()
  const router = useRouter(),
    pathname = usePathname(),
    searchParams = useSearchParams()
  const updateConversationUrl = (
    id: string | null,
    search = searchParams.get("messageSearch") ?? "",
    replace = false,
  ) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set("tab", "messages")
    next.delete("filter")
    if (id) next.set("message", id)
    else next.delete("message")
    if (search) next.set("messageSearch", search)
    else next.delete("messageSearch")
    if (replace) window.history.replaceState(null, "", `${pathname}?${next}`)
    else router.push(`${pathname}?${next}`, { scroll: false })
  }
  const moduleConfig = useMemo(() => messagesModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{
    form: FormConfig
    action: string
  } | null>(null)
  const [newMessageAttempt, setNewMessageAttempt] =
    useState<PostMessageInput | null>(null)
  const [pendingReplies, setPendingReplies] = useState<{
    [thread: string]: MessageReplyInput
  }>({})
  const messagesQuery = useMailMessages(orgId, undefined, scopeKey)
  const messagesRead = moduleCollection(messagesQuery)
  const messagesReadRefresh = messagesQuery.refetch
  const messages = messagesRead.rows
  const followersRead = moduleCollection(
    useMailFollowers(orgId, undefined, scopeKey),
  )
  const followers = followersRead.rows
  const contactsQuery = useContacts(orgId)
  const { data: contacts = [] } = contactsQuery
  const { data: users = [] } = useUsers(orgId)
  const accountMovesQuery = useAccountMoves(orgId)
  const { data: accountMoves = [] } = accountMovesQuery
  const contactChoicesRead = moduleCollection(contactsQuery)
  const moveChoicesRead = moduleCollection(accountMovesQuery)
  const postMessage = usePostMessage(orgId)
  const markNotificationRead = useMarkNotificationRead(orgId)
  const subscribeToRecord = useSubscribeToRecord(orgId)
  const unsubscribeFromRecord = useUnsubscribeFromRecord(orgId)

  const parentMessageOptions = useMemo(
    () => mailMessageRowsToSelectOptions(messages as Record<string, unknown>[]),
    [messages],
  )

  const recordChoices = useMemo(
    () =>
      messageRecordChoices(
        moveChoicesRead.rows,
        contactChoicesRead.rows,
        { organizationId, companyId: activeCompanyId },
        {
          invoice: t("messages.forms.recordChoice.invoice", {
            defaultValue: "Invoice",
          }),
          bill: t("messages.forms.recordChoice.bill", {
            defaultValue: "Vendor bill",
          }),
          creditNote: t("messages.forms.recordChoice.creditNote", {
            defaultValue: "Credit note",
          }),
          vendorCredit: t("messages.forms.recordChoice.vendorCredit", {
            defaultValue: "Vendor credit",
          }),
          journalEntry: t("messages.forms.recordChoice.journalEntry", {
            defaultValue: "Journal entry",
          }),
          accountingDocument: t(
            "messages.forms.recordChoice.accountingDocument",
            { defaultValue: "Accounting document" },
          ),
          contact: t("messages.forms.recordChoice.contact", {
            defaultValue: "Contact",
          }),
        },
      ),
    [
      moveChoicesRead.rows,
      contactChoicesRead.rows,
      organizationId,
      activeCompanyId,
      t,
    ],
  )
  const recordChoicesLoading =
    contactChoicesRead.state.status === "loading" ||
    moveChoicesRead.state.status === "loading"
  const recordHint = recordChoicesLoading
    ? t("messages.forms.recordChoice.loading", {
        defaultValue:
          "Loading available records. Your message can stay open while the choices load.",
      })
    : !canUseModuleData(contactChoicesRead.state) ||
        !canUseModuleData(moveChoicesRead.state)
      ? t("messages.forms.recordChoice.unavailable", {
          defaultValue:
            "Some record choices could not be loaded. Refresh the page to reload the available records.",
        })
      : undefined

  const mailMessageFormConfig = useMemo(() => {
    const configured = mergeSelectOptionsForFields(
      newMailMessageForm(t, recordChoices, recordHint),
      { parentId: parentMessageOptions },
    )
    // post_message creates record comments; email delivery and notification creation
    // have separate owners and cannot be selected through this command.
    const base = {
      ...configured,
      description: t("messages.workspace.postedNote", {
        defaultValue: "Messages are posted as comments on the linked record.",
      }),
      sections: configured.sections.map((section) => ({
        ...section,
        fields: section.fields.filter(
          (field) => !["messageType", "subtype"].includes(field.name),
        ),
      })),
    }
    if (!newMessageAttempt) return base
    return {
      ...base,
      submitLabel: t("messages.workspace.checkOutcome", {
        defaultValue: "Check outcome",
      }),
      description: t("messages.workspace.unconfirmed", {
        defaultValue:
          "The message outcome is still unconfirmed. Check again without posting another message.",
      }),
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => ({
          ...field,
          disabled: true,
          required: false,
        })),
      })),
    }
  }, [t, parentMessageOptions, recordChoices, recordHint, newMessageAttempt])

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
      const recipient = notificationRecipient(m)
      if (recipient) return recipient === me.replace(/^0x/, "")
      const key = `${String(m.model)}:${String(m.resId)}`
      return followedKeys.has(key)
    })
  }, [messages, followers, identity])

  const liveSections = useMemo(() => {
    const emails = messages.filter((m) => messageKind(m) === "email").length
    const comments = messages.filter((m) => messageKind(m) === "comment").length
    const notifications = myNotifications.length

    return mapDashboardWidgets(moduleConfig, (w) => {
      if (w.type === "stat-cards") {
        return {
          ...w,
          data: {
            stats: [
              {
                label: t("messages.dashboard.totalMessages"),
                value: String(messages.length),
                icon: "MessageSquare",
              },
              {
                label: t("messages.dashboard.emails"),
                value: String(emails),
                icon: "Mail",
              },
              {
                label: t("messages.dashboard.comments"),
                value: String(comments),
                icon: "MessageCircle",
              },
              {
                label: t("messages.dashboard.notifications"),
                value: String(notifications),
                icon: "Bell",
              },
            ],
          },
        }
      }
      if (w.type === "quick-actions") {
        const handlers: Record<string, () => void> = {
          new_message: () =>
            setQuickActionForm({
              form: mailMessageFormConfig,
              action: "createMessage",
            }),
          subscribe_record: () =>
            setQuickActionForm({
              form: subscribeToRecordForm(t),
              action: "subscribeToRecord",
            }),
          unsubscribe_record: () =>
            setQuickActionForm({
              form: unsubscribeFromRecordForm(t),
              action: "unsubscribeFromRecord",
            }),
        }
        return {
          ...w,
          data: {
            ...w.data,
            actions: w.data.actions.map((a) => ({
              ...a,
              onClick: handlers[a.id],
            })),
          },
        }
      }
      return w
    })
  }, [messages, myNotifications.length, moduleConfig, t, mailMessageFormConfig])

  const config = useMemo<ModuleConfig>(
    () => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map(
        (tab) => {
          if (tab.id === "message-batches") {
            return {
              ...tab,
              customContent: (
                <MessageBatchesPanel
                  organizationId={organizationId}
                  companyId={
                    activeCompanyId != null ? BigInt(activeCompanyId) : 0n
                  }
                  contacts={contacts as Record<string, unknown>[]}
                  invoices={accountMoves as Record<string, unknown>[]}
                />
              ),
            }
          }
          if (tab.id === "messages" && !searchParams.has("filter")) {
            const canCreate =
              permissionsReady !== false &&
              checkPermission("mail_message", "create").allowed &&
              messagesRead.state.status === "ready"
            return {
              ...tab,
              type: "custom" as const,
              createForm: undefined,
              customContent:
                messagesRead.state.status === "ready" ? (
                  <MessageConversationWorkspace
                    key={scopeKey}
                    pendingAttempts={pendingReplies}
                    onPendingAttempt={(threadId, attempt) =>
                      setPendingReplies((previous) => {
                        const next = { ...previous }
                        if (attempt) next[threadId] = { ...attempt, body: "" }
                        else delete next[threadId]
                        return next
                      })
                    }
                    messages={messages}
                    users={users}
                    selectedMessageId={searchParams.get("message")}
                    search={searchParams.get("messageSearch") ?? ""}
                    onSearchChange={(value) =>
                      updateConversationUrl(
                        searchParams.get("message"),
                        value,
                        true,
                      )
                    }
                    onSelectMessage={(id) => updateConversationUrl(id)}
                    onNewMessage={
                      canCreate
                        ? () =>
                            setQuickActionForm({
                              form: mailMessageFormConfig,
                              action: "createMessage",
                            })
                        : undefined
                    }
                    canReply={canCreate}
                    sourceLabels={
                      new Map(
                        recordChoices.map((choice) => [
                          choice.value,
                          choice.label,
                        ]),
                      )
                    }
                    onReply={async (input) =>
                      postMessage.mutateAsync({ ...input, attachmentIds: [] })
                    }
                    onCheckOutcome={async (input) => {
                      const effect = await confirmPostedMessage(orgId, {
                        idempotencyKey: input.idempotencyKey,
                        model: input.model,
                        resId: BigInt(input.resId),
                      })
                      if (effect) await messagesReadRefresh()
                      return effect
                    }}
                  />
                ) : messagesRead.state.status === "loading" ? (
                  <MessageWorkspaceLoading />
                ) : null,
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
                          {
                            key: "authorName",
                            label: t("messages.messages.columns.author", {
                              defaultValue: "Author",
                            }),
                            width: "min-w-32",
                          },
                        ],
                      },
                    },
                  }
                : {}
            return {
              ...tab,
              ...withAuthor,

              recordSheet: {
                titleKey: "body",
                openHref: messageRecordHref,
                actions: (row) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => updateConversationUrl(String(row.id))}
                    >
                      {t("messages.workspace.openConversation", {
                        defaultValue: "Open conversation",
                      })}
                    </Button>
                    {messageKind(row) === "notification" &&
                      notificationRecipient(row) ===
                        identity?.toLowerCase().replace(/^0x/, "") &&
                      !isNotificationRead(row) && (
                        <Button
                          variant="outline"
                          disabled={
                            markNotificationRead.isPending ||
                            messagesRead.state.status !== "ready"
                          }
                          onClick={async () => {
                            try {
                              await markNotificationRead.mutateAsync(
                                String(row.id),
                              )
                            } catch (error) {
                              showWorkflowToast({
                                kind: "error",
                                title: t("messages.workspace.markReadFailed", {
                                  defaultValue:
                                    "The notification could not be marked read.",
                                }),
                                description:
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                              })
                            }
                          }}
                        >
                          {t("messages.workspace.markRead", {
                            defaultValue: "Mark notification read",
                          })}
                        </Button>
                      )}
                  </div>
                ),
                detailConfig: {
                  mode: "detail" as const,
                  sections: [
                    {
                      id: "message",
                      fields: [
                        {
                          key: "model",
                          label: t("messages.messages.columns.model"),
                        },
                        {
                          key: "resId",
                          label: t("messages.messages.columns.resId"),
                        },
                        {
                          key: "messageType",
                          label: t("messages.messages.columns.messageType"),
                        },
                        {
                          key: "date",
                          label: t("messages.messages.columns.date"),
                          type: "datetime" as const,
                        },
                      ],
                    },
                  ],
                },
              },
            }
          }
          return tab
        },
      ),
    }),
    [
      accountMoves,
      activeCompanyId,
      contacts,
      liveSections,
      t,
      moduleConfig,
      mailMessageFormConfig,
      organizationId,
      scopeKey,
      pendingReplies,
      messages,
      messagesRead.state.status,
      users,
      recordChoices,
      permissionsReady,
      checkPermission,
      searchParams,
      postMessage,
      orgId,
      messagesReadRefresh,
      identity,
      markNotificationRead,
    ],
  )

  const withAuthorNames = useCallback(
    (rows: MailMessage[]) =>
      (rows as unknown as Record<string, unknown>[]).map((row) => ({
        ...row,
        authorName: messageAuthorName(
          row,
          users as unknown as Record<string, unknown>[],
        ),
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

  const inboxState = mergeModuleStates([
    messagesRead.state,
    followersRead.state,
  ])
  const dataState = {
    dashboard: inboxState,
    messages: messagesRead.state,
    notifications: inboxState,
    followers: followersRead.state,
  }
  const actionTabs: Record<string, keyof typeof dataState> = {
    createMessage: "messages",
    subscribeToRecord: "followers",
    unsubscribeFromRecord: "followers",
  }
  const actionUsable = (action: string) => {
    const tab = actionTabs[action]
    return tab == null || dataState[tab].status === "ready"
  }
  const quickActionUsable =
    quickActionForm == null || actionUsable(quickActionForm.action)
  useEffect(() => {
    if (messagesRead.state.status === "denied") {
      setPendingReplies({})
      setNewMessageAttempt(null)
    }
  }, [messagesRead.state.status])
  useEffect(() => {
    if (!quickActionUsable) setQuickActionForm(null)
  }, [quickActionUsable])

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!actionUsable(action))
      throw new Error(t("calendar.calendarClient.requiredDataIsUnavailableRefreshAndTryAgain"))
    if (action === "createMessage") {
      if (!checkPermission("mail_message", "create").allowed)
        throw new Error(
          t("messages.workspace.replyUnavailable", {
            defaultValue:
              "Replying is unavailable for this source or your current access.",
          }),
        )
      if (newMessageAttempt) {
        const effect = await confirmPostedMessage(orgId, {
          idempotencyKey: newMessageAttempt.idempotencyKey!,
          model: newMessageAttempt.model,
          resId: BigInt(newMessageAttempt.resId),
        })
        if (!effect) throw new UnconfirmedPostedMessageError()
        if (!active.current) return
        setNewMessageAttempt(null)
        await messagesReadRefresh()
        if (active.current) updateConversationUrl(effect.id)
        return
      }
      const body = String(formData.body ?? "").trim()
      if (!body)
        throw new Error(
          t("messages.forms.errors.bodyRequired", {
            defaultValue:
              "Write a message before saving. Your entries are retained.",
          }),
        )
      const reference = resolveMessageRecordChoice(
        {
          recordLinkMode: formData.recordLinkMode,
          recordReference: formData.recordReference,
          model: formData.model,
          resId: formData.resId,
        },
        recordChoices,
      )
      if (!reference)
        throw new Error(
          t("messages.forms.errors.recordChoiceRequired", {
            defaultValue:
              "Choose an available record, or check the advanced custom reference. Your entries are retained.",
          }),
        )
      const parentId = optionalBigIntU64(formData.parentId)
      if (parentId != null) {
        const parent = messages.find(
          (message) => String(message.id) === parentId.toString(),
        )
        if (
          !parent ||
          !sameMessageSource(parent, {
            model: reference.model,
            resId: reference.resId,
          })
        )
          throw new Error(
            t("messages.workspace.parentMismatch", {
              defaultValue:
                "Choose a parent message on the same record. Your entries are retained.",
            }),
          )
      }
      const attempt: PostMessageInput = {
        model: reference.model,
        resId: reference.resId,
        body,
        messageType: formData.messageType
          ? String(formData.messageType)
          : "comment",
        subtype: formData.subtype ? String(formData.subtype) : null,
        parentId: parentId ?? null,
        attachmentIds: [],
        idempotencyKey: newCorrelationId(),
      }
      setNewMessageAttempt(attempt)
      try {
        const effect = await postMessage.mutateAsync(attempt)
        if (!active.current) return
        setNewMessageAttempt(null)
        updateConversationUrl(effect.id)
      } catch (error) {
        if (active.current && !(error instanceof UnconfirmedPostedMessageError))
          setNewMessageAttempt(null)
        throw error
      }
      return
    }

    if (action === "subscribeToRecord") {
      const resModel = String(formData.resModel ?? "").trim()
      const resId = optionalBigIntU64(formData.resId)
      if (!resModel || !resId)
        throw new Error(
          t("messages.forms.errors.recordTypeRequired", {
            defaultValue:
              "Enter a record type and an existing record number. Your entries are retained.",
          }),
        )
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
      if (!resModel || !resId)
        throw new Error(
          t("messages.forms.errors.recordTypeRequired", {
            defaultValue:
              "Enter a record type and an existing record number. Your entries are retained.",
          }),
        )
      await unsubscribeFromRecord.mutateAsync({
        resModel,
        resId,
      })
      return
    }
    throw new Error(
      t("messages.forms.errors.unsupportedAction", {
        defaultValue:
          "This message action is unavailable. Close and reopen the form before trying again.",
      }),
    )
  }

  const isFormMutationPending =
    postMessage.isPending ||
    subscribeToRecord.isPending ||
    unsubscribeFromRecord.isPending

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
        config={
          quickActionForm?.action === "createMessage"
            ? mailMessageFormConfig
            : (quickActionForm?.form ?? mailMessageFormConfig)
        }
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit(
              "dashboard",
              quickActionForm.action,
              formData,
            )
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
