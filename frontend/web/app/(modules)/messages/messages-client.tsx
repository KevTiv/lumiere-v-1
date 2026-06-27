"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newMailMessageForm,
  subscribeToRecordForm,
  unsubscribeFromRecordForm,
  MissingOrganization,
} from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { messagesModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useMailFollowers,
  useMailMessages,
  usePostMessage,
  useSubscribeToRecord,
  useUnsubscribeFromRecord,
} from "@lumiere/query-hooks/hooks/messages"
import { optionalBigIntU64 } from "@/lib/form-coercion"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

interface MessagesClientProps {
  initialMessages?: Record<string, unknown>[]
  initialFollowers?: Record<string, unknown>[]
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

export function MessagesClient(props: MessagesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <MessagesClientLoaded {...props} organizationId={props.organizationId} />
}

function MessagesClientLoaded({ initialMessages, initialFollowers, organizationId }: MessagesClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => messagesModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { data: messages = [] } = useMailMessages(orgId, initialMessages)
  const { data: followers = [] } = useMailFollowers(orgId, initialFollowers)
  const postMessage = usePostMessage(orgId)
  const subscribeToRecord = useSubscribeToRecord(orgId)
  const unsubscribeFromRecord = useUnsubscribeFromRecord(orgId)

  const liveSections = useMemo(() => {
    const emails = messages.filter((m) => String(m.messageType) === "email").length
    const comments = messages.filter((m) => String(m.messageType) === "comment").length
    const notifications = messages.filter(
      (m) => String(m.messageType) === "notification" || String(m.messageType) === "user_notification",
    ).length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
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
            new_message: () => setQuickActionForm({ form: newMailMessageForm(t), action: "createMessage" }),
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
      }),
    }))
  }, [messages, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
  )

  const data = useMemo(
    () => ({
      messages: messages as unknown as Record<string, unknown>[],
      followers: followers as unknown as Record<string, unknown>[],
    }),
    [messages, followers],
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
        config={quickActionForm?.form ?? newMailMessageForm(t)}
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
