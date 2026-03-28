"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newHelpdeskTicketForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { helpdeskModuleConfig } from "@/lib/module-dashboard-configs"
import { useHelpdeskTickets, useHelpdeskTeams, useHelpdeskStages, useCreateTicket } from "@/hooks/helpdesk"
import type { CreateTicketParams } from "@/hooks/helpdesk"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { helpdeskTeamRowsToSelectOptions, helpdeskStageRowsToSelectOptions } from "@/lib/form-lookup"

interface HelpdeskClientProps {
  initialTickets?: Record<string, unknown>[]
  initialTeams?: Record<string, unknown>[]
  initialStages?: Record<string, unknown>[]
  organizationId?: number
}

type HelpdeskClientLoadedProps = Omit<HelpdeskClientProps, "organizationId"> & {
  organizationId: number
}

export function HelpdeskClient(props: HelpdeskClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <HelpdeskClientLoaded {...props} organizationId={props.organizationId} />
}

function HelpdeskClientLoaded({
  initialTickets,
  initialTeams,
  initialStages,
  organizationId,
}: HelpdeskClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => helpdeskModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: tickets = [] } = useHelpdeskTickets(orgId, initialTickets)
  const { data: teams = [] } = useHelpdeskTeams(orgId, initialTeams)
  const { data: stages = [] } = useHelpdeskStages(orgId, initialStages)
  const createTicket = useCreateTicket(orgId)

  const teamFieldOptions = useMemo(() => {
    const fromApi = helpdeskTeamRowsToSelectOptions(teams)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noTeams"), disabled: true }]
  }, [teams, t])

  const stageFieldOptions = useMemo(() => {
    const fromApi = helpdeskStageRowsToSelectOptions(stages)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noStages"), disabled: true }]
  }, [stages, t])

  const ticketFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newHelpdeskTicketForm(t), {
        teamId: teamFieldOptions,
        stageId: stageFieldOptions,
      }),
    [t, teamFieldOptions, stageFieldOptions],
  )

  const liveSections = useMemo(() => {
    const open = tickets.filter((tk) => String(tk.state) === "open" || String(tk.state) === "new").length
    const solved = tickets.filter((tk) => String(tk.state) === "solved").length
    const urgent = tickets.filter((tk) => String(tk.priority) === "urgent").length

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
                { label: t("helpdesk.dashboard.totalTickets"), value: String(tickets.length), icon: "HelpCircle" },
                { label: t("helpdesk.dashboard.open"), value: String(open), icon: "AlertCircle" },
                { label: t("helpdesk.dashboard.solved"), value: String(solved), icon: "CheckCircle" },
                { label: t("helpdesk.dashboard.urgent"), value: String(urgent), icon: "Zap" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_ticket: () => setQuickActionForm({ form: ticketFormConfig, action: "createTicket" }),
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
  }, [tickets, moduleConfig, t, ticketFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "tickets") return { ...tab, createForm: ticketFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [liveSections, moduleConfig, ticketFormConfig],
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
      const teamRaw = formData.teamId
      const stageRaw = formData.stageId
      if (teamRaw === "" || teamRaw == null || stageRaw === "" || stageRaw == null) return
      const name = String(formData.name ?? "").trim()
      if (!name) return
      createTicket.mutate({
        teamId: BigInt(String(teamRaw)),
        stageId: BigInt(String(stageRaw)),
        name,
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
        config={quickActionForm?.form ?? ticketFormConfig}
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
