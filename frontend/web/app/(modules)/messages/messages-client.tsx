"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newMailMessageForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { messagesModuleConfig } from "@/lib/module-dashboard-configs"
import { useMailMessages, usePostMessage, useStdbConnection, getStdbConnection, messagesSubscriptions } from "@lumiere/stdb"
import type { PostMessageParams } from "@lumiere/stdb"

interface MessagesClientProps {
  initialMessages?: Record<string, unknown>[]
  organizationId?: number
}

export function MessagesClient({ initialMessages, organizationId }: MessagesClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => messagesModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] messages subscription error", err))
      .subscribe(messagesSubscriptions(orgId))
  }, [connected, orgId])

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
                { label: "Total Messages", value: String(messages.length), icon: "MessageSquare" },
                { label: "Emails", value: String(emails), icon: "Mail" },
                { label: "Comments", value: String(comments), icon: "MessageCircle" },
                { label: "Notifications", value: String(notifications), icon: "Bell" },
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
      postMessage.mutate({
        model: (formData.model as string) ?? "mail.message",
        resId: BigInt(formData.resId as number ?? 0),
        body: formData.body as string,
        parentId: undefined,
        attachmentIds: [],
      } as unknown as PostMessageParams)
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
