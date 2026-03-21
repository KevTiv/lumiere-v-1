"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newHelpdeskTicketForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { helpdeskModuleConfig } from "@/lib/module-dashboard-configs"
import { useHelpdeskTickets, useCreateTicket, useStdbConnection, getStdbConnection, helpdeskSubscriptions } from "@lumiere/stdb"
import type { CreateTicketParams } from "@lumiere/stdb"

interface HelpdeskClientProps {
  initialTickets?: Record<string, unknown>[]
  organizationId?: number
}

export function HelpdeskClient({ initialTickets, organizationId }: HelpdeskClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => helpdeskModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] helpdesk subscription error", err))
      .subscribe(helpdeskSubscriptions(orgId))
  }, [connected, orgId])

  const { data: tickets = [] } = useHelpdeskTickets(orgId, initialTickets)
  const createTicket = useCreateTicket(orgId)

  const liveSections = useMemo(() => {
    const open = tickets.filter((t) => String(t.state) === "open" || String(t.state) === "new").length
    const solved = tickets.filter((t) => String(t.state) === "solved").length
    const urgent = tickets.filter((t) => String(t.priority) === "urgent").length

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
                { label: "Total Tickets", value: String(tickets.length), icon: "HelpCircle" },
                { label: "Open", value: String(open), icon: "AlertCircle" },
                { label: "Solved", value: String(solved), icon: "CheckCircle" },
                { label: "Urgent", value: String(urgent), icon: "Zap" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_ticket: () => setQuickActionForm({ form: newHelpdeskTicketForm(t), action: "createTicket" }),
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
  }, [tickets, moduleConfig, t])

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
      tickets: tickets as unknown as Record<string, unknown>[],
    }),
    [tickets],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createTicket") {
      createTicket.mutate({
        teamId: BigInt(formData.teamId as number),
        stageId: BigInt(1),
        name: formData.name as string,
        description: formData.description as string | undefined,
        priority: (formData.priority as CreateTicketParams["priority"]) ?? "normal",
        partnerId: undefined,
        partnerName: formData.partnerName as string | undefined,
        partnerEmail: formData.partnerEmail as string | undefined,
        slaId: undefined,
        slaDeadline: undefined,
      } as unknown as CreateTicketParams)
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
        config={quickActionForm?.form ?? newHelpdeskTicketForm(t)}
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
