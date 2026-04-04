"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newMailMessageForm, MissingOrganization } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { messagesModuleConfig } from "@/lib/module-dashboard-configs"
import { useMailMessages, usePostMessage } from "@/hooks/messages"
import type { PostMessageParams } from "@/hooks/messages"
import { optionalBigIntU64 } from "@/lib/form-coercion"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

interface MessagesClientProps {
  initialMessages?: Record<string, unknown>[]
  organizationId?: number
}

type MessagesClientLoadedProps = Omit<MessagesClientProps, "organizationId"> & {
  organizationId: number
}

export function MessagesClient(props: MessagesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <MessagesClientLoaded {...props} organizationId={props.organizationId} />
}

function MessagesClientLoaded({ initialMessages, organizationId }: MessagesClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => messagesModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { data: messages = [] } = useMailMessages(orgId, initialMessages)
  const postMessage = usePostMessage(orgId)

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
    }),
    [messages],
  )

  const handleFormSubmit = (
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
      postMessage.mutate({
        model: formData.model ? String(formData.model) : "mail.message",
        resId: BigInt(Math.floor(resNum)),
        body,
        parentId: optionalBigIntU64(formData.parentId),
        attachmentIds: [],
      })
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newMailMessageForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
