"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newHelpdeskTicketForm,
  newHelpdeskTeamForm,
  newHelpdeskStageForm,
  newHelpdeskSlaForm,
  helpdeskCsvImportForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  helpdeskTicketDetailForm,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig, EntityAction, EntityTableConfig, EntityViewConfig } from "@lumiere/ui"
import { helpdeskModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useHelpdeskTickets,
  useHelpdeskTeams,
  useHelpdeskStages,
  useHelpdeskSlas,
  useCreateTicket,
  useCreateHelpdeskTeam,
  useCreateHelpdeskStage,
  useCreateHelpdeskSla,
  useUpdateTicket,
  useAssignTicket,
  useCloseTicket,
  useReopenTicket,
  useImportHelpdeskTicketCsv,
} from "@lumiere/query-hooks/hooks/helpdesk"
import type { UpdateTicketParams } from "@lumiere/query-hooks/hooks/helpdesk"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  toCreateHelpdeskSlaParams,
  toCreateHelpdeskStageParams,
  toCreateHelpdeskTeamParams,
  toCreateTicketParams,
} from "@/lib/helpdesk-create-params"
import {
  helpdeskTeamRowsToSelectOptions,
  helpdeskStageRowsToSelectOptionsWithTeams,
  helpdeskSlaRowsToSelectOptions,
} from "@/lib/form-lookup"
import { helpdeskEnumTag, identityToHex, normalizeHelpdeskTicketRow } from "@/lib/helpdesk-display"
import { useOrgUsers } from "@lumiere/query-hooks/hooks/inventory"
import { HelpdeskTicketDialog } from "./helpdesk-ticket-dialog"
import { XCircle, RotateCcw, Pencil } from "lucide-react"

interface HelpdeskClientProps {
  initialTickets?: Record<string, unknown>[]
  initialTeams?: Record<string, unknown>[]
  initialStages?: Record<string, unknown>[]
  initialSlas?: Record<string, unknown>[]
  organizationId?: number
}

type HelpdeskClientLoadedProps = Omit<HelpdeskClientProps, "organizationId"> & {
  organizationId: number
}

type MutableUpdateTicketParams = {
  -readonly [K in keyof UpdateTicketParams]?: UpdateTicketParams[K]
}

function helpdeskPriorityValue(priority: unknown): string {
  if (typeof priority === "string") return priority.toLowerCase()
  if (priority && typeof priority === "object" && "tag" in priority) {
    return String((priority as { tag?: unknown }).tag ?? "normal").toLowerCase()
  }
  return String(priority ?? "normal").toLowerCase()
}

function toUpdateTicketPriority(priority: string): UpdateTicketParams["priority"] {
  if (priority === "low") return { tag: "Low" }
  if (priority === "high") return { tag: "High" }
  if (priority === "urgent") return { tag: "Urgent" }
  return { tag: "Normal" }
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
  initialSlas,
  organizationId,
}: HelpdeskClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => helpdeskModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [csvImportKind, setCsvImportKind] = useState<"ticket" | "team" | "stage" | "sla" | null>(null)

  const { data: ticketsRaw = [] } = useHelpdeskTickets(orgId, initialTickets)
  const { data: teams = [] } = useHelpdeskTeams(orgId, initialTeams)
  const { data: stages = [] } = useHelpdeskStages(orgId, initialStages)
  const { data: slas = [] } = useHelpdeskSlas(orgId, initialSlas)
  const { data: orgUsers = [] } = useOrgUsers()

  const tickets = useMemo(
    () => (ticketsRaw as Record<string, unknown>[]).map(normalizeHelpdeskTicketRow),
    [ticketsRaw],
  )

  const createTicket = useCreateTicket(orgId)
  const createTeam = useCreateHelpdeskTeam(orgId)
  const createStage = useCreateHelpdeskStage(orgId)
  const createSla = useCreateHelpdeskSla(orgId)
  const updateTicket = useUpdateTicket(orgId)
  const assignTicket = useAssignTicket(orgId)
  const closeTicket = useCloseTicket(orgId)
  const reopenTicket = useReopenTicket(orgId)
  const importTicketsCsv = useImportHelpdeskTicketCsv(orgId)

  const [selectedTicket, setSelectedTicket] = useState<Record<string, unknown> | null>(null)
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false)
  const [ticketBusy, setTicketBusy] = useState(false)

  const teamFieldOptions = useMemo(() => {
    const fromApi = helpdeskTeamRowsToSelectOptions(teams)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noTeams"), disabled: true }]
  }, [teams, t])

  const stageFieldOptions = useMemo(
    () =>
      helpdeskStageRowsToSelectOptionsWithTeams(stages, teams).length > 0
        ? helpdeskStageRowsToSelectOptionsWithTeams(stages, teams)
        : [{ value: "", label: t("common.lookup.noStages"), disabled: true }],
    [stages, teams, t],
  )

  const slaFieldOptions = useMemo(() => {
    const fromApi = helpdeskSlaRowsToSelectOptions(slas)
    if (fromApi.length > 0) return [{ value: "", label: t("helpdesk.forms.newTicket.fields.slaPlaceholder") }, ...fromApi]
    return [{ value: "", label: t("helpdesk.forms.newTicket.fields.slaPlaceholder"), disabled: true }]
  }, [slas, t])

  const stageOptionsForSlaTab = useMemo(() => {
    const o = helpdeskStageRowsToSelectOptionsWithTeams(stages, teams)
    return o.length > 0 ? o : [{ value: "", label: t("common.lookup.noStages"), disabled: true }]
  }, [stages, teams, t])

  const teamFormConfig = useMemo(() => newHelpdeskTeamForm(t), [t])
  const stageFormConfig = useMemo(
    () => mergeSelectOptionsForFields(newHelpdeskStageForm(t), { teamId: teamFieldOptions }),
    [t, teamFieldOptions],
  )
  const slaFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newHelpdeskSlaForm(t), {
        teamId: teamFieldOptions,
        stageId: stageOptionsForSlaTab,
      }),
    [t, teamFieldOptions, stageOptionsForSlaTab],
  )

  const ticketFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newHelpdeskTicketForm(t), {
        teamId: teamFieldOptions,
        stageId: stageFieldOptions,
        slaId: slaFieldOptions,
      }),
    [t, teamFieldOptions, stageFieldOptions, slaFieldOptions],
  )

  const priorityOptions = useMemo(
    () => [
      { value: "low", label: t("helpdesk.forms.newTicket.fields.options.low") },
      { value: "normal", label: t("helpdesk.forms.newTicket.fields.options.normal") },
      { value: "high", label: t("helpdesk.forms.newTicket.fields.options.high") },
      { value: "urgent", label: t("helpdesk.forms.newTicket.fields.options.urgent") },
    ],
    [t],
  )

  const agentSelectOptions = useMemo(() => {
    return (orgUsers as Record<string, unknown>[]).map((u) => {
      const raw = u.identity ?? u.identityHex ?? u.userIdentity
      const value =
        typeof raw === "string"
          ? raw
          : identityToHex(raw)
            ? `0x${identityToHex(raw)}`
            : ""
      const label = String(u.name ?? u.email ?? value.slice(0, 10))
      return { value, label }
    }).filter((o) => o.value !== "")
  }, [orgUsers])

  const ticketDetailFormConfig = useMemo(() => {
    if (!selectedTicket) return null
    const id = String(selectedTicket.id ?? "")
    const st = helpdeskEnumTag(selectedTicket.state)
    const pr = helpdeskPriorityValue(selectedTicket.priority)
    const stageId = String(selectedTicket.stageId ?? "")
    const uid = selectedTicket.userId
    const agentValue =
      typeof uid === "string"
        ? uid
        : identityToHex(uid)
          ? `0x${identityToHex(uid)}`
          : ""
    return helpdeskTicketDetailForm(t, {
      ticketId: id,
      name: String(selectedTicket.name ?? ""),
      description: String(selectedTicket.description ?? ""),
      stageId,
      priority: pr,
      agentIdentityHex: agentValue,
      stateTag: st,
      stageOptions: stageFieldOptions.filter((o) => !("disabled" in o && o.disabled)),
      priorityOptions,
      agentOptions: agentSelectOptions,
    })
  }, [selectedTicket, t, stageFieldOptions, priorityOptions, agentSelectOptions])

  const ticketRowActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "edit-ticket",
        label: t("helpdesk.actions.editTicket"),
        icon: Pencil,
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0]
          if (!row) return
          setSelectedTicket(row)
          setTicketDialogOpen(true)
        },
      },
      {
        id: "close-ticket",
        label: t("helpdesk.forms.ticketDetail.closeTicket"),
        icon: XCircle,
        requiresSelection: true,
        onClick: async (rows) => {
          const row = rows[0]
          if (!row?.id) return
          if (helpdeskEnumTag(row.state) === "Closed") return
          await closeTicket.mutateAsync({ ticketId: Number(row.id) })
        },
      },
      {
        id: "reopen-ticket",
        label: t("helpdesk.forms.ticketDetail.reopenTicket"),
        icon: RotateCcw,
        requiresSelection: true,
        onClick: async (rows) => {
          const row = rows[0]
          if (!row?.id) return
          const st = helpdeskEnumTag(row.state)
          if (st !== "Closed" && st !== "Cancelled") return
          await reopenTicket.mutateAsync({ ticketId: Number(row.id) })
        },
      },
    ]
  }, [t, closeTicket, reopenTicket])

  const ticketsEntityConfig = useMemo((): EntityViewConfig => {
    const tab = moduleConfig.tabs.find((x) => x.id === "tickets")
    const base = tab?.entityConfig
    if (!base || base.view.mode !== "table") {
      return {
        id: "helpdesk-tickets-table",
        title: t("helpdesk.tickets.title"),
        view: { mode: "table", rowKey: "id", columns: [], actions: ticketRowActions },
      }
    }
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: ticketRowActions,
      },
    }
  }, [moduleConfig.tabs, t, ticketRowActions])

  const liveSections = useMemo(() => {
    const active = tickets.filter((tk) => {
      const s = String(tk.state)
      return s === "New" || s === "InProgress" || s === "OnHold"
    }).length
    const closed = tickets.filter((tk) => String(tk.state) === "Closed").length
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
                { label: t("helpdesk.dashboard.open"), value: String(active), icon: "AlertCircle" },
                { label: t("helpdesk.dashboard.solved"), value: String(closed), icon: "CheckCircle" },
                { label: t("helpdesk.dashboard.urgent"), value: String(urgent), icon: "Zap" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_ticket: () => setQuickActionForm({ form: ticketFormConfig, action: "createTicket" }),
            import_tickets_csv: () => setCsvImportKind("ticket"),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: (w.data.actions as { id: string; label: string; icon?: string; color?: string }[]).map(
                (a) => ({
                  ...a,
                  onClick: handlers[a.id] ?? (() => {}),
                }),
              ),
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
          if (tab.id === "tickets") return { ...tab, createForm: ticketFormConfig, entityConfig: ticketsEntityConfig }
          if (tab.id === "teams") return { ...tab, createForm: teamFormConfig }
          if (tab.id === "stages") return { ...tab, createForm: stageFormConfig }
          if (tab.id === "slas") return { ...tab, createForm: slaFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [liveSections, moduleConfig, ticketFormConfig, teamFormConfig, stageFormConfig, slaFormConfig, ticketsEntityConfig],
  )

  const data = useMemo(
    () => ({
      tickets,
      teams,
      stages,
      slas,
    }),
    [tickets, teams, stages, slas],
  )

  const handleFormSubmit = async (tabId: string, action: string, formData: Record<string, unknown>) => {
    if (action === "createTicket") {
      const params = toCreateTicketParams(formData)
      if (!params) return
      await createTicket.mutateAsync(params)
      return
    }

    if (action === "createHelpdeskTeam") {
      const params = toCreateHelpdeskTeamParams(formData)
      if (!params) return
      await createTeam.mutateAsync(params)
      return
    }

    if (action === "createHelpdeskStage") {
      const params = toCreateHelpdeskStageParams(formData)
      if (!params) return
      await createStage.mutateAsync(params)
      return
    }

    if (action === "createHelpdeskSla") {
      const params = toCreateHelpdeskSlaParams(formData)
      if (!params) return
      await createSla.mutateAsync(params)
    }
  }

  const isFormMutationPending =
    createTicket.isPending ||
    createTeam.isPending ||
    createStage.isPending ||
    createSla.isPending ||
    updateTicket.isPending ||
    assignTicket.isPending ||
    closeTicket.isPending ||
    reopenTicket.isPending ||
    importTicketsCsv.isPending

  const onRowClick = (tabId: string, row: Record<string, unknown>) => {
    if (tabId !== "tickets") return
    setSelectedTicket(row)
    setTicketDialogOpen(true)
  }

  const handleTicketSave = async (formData: Record<string, unknown>) => {
    if (!selectedTicket) return
    const ticketId = Number(selectedTicket.id)
    const origName = String(selectedTicket.name ?? "")
    const origDesc = selectedTicket.description != null ? String(selectedTicket.description) : ""
    const origStage = String(selectedTicket.stageId ?? "")
    const origPr = helpdeskPriorityValue(selectedTicket.priority)
    const origAgent = identityToHex(selectedTicket.userId)
    const name = String(formData.name ?? "").trim()
    const desc = formData.description != null ? String(formData.description) : ""
    const stageId = String(formData.stageId ?? "")
    const pr = String(formData.priority ?? "normal").toLowerCase()
    const agentVal = String(formData.agentIdentityHex ?? "")
    const agentHex = agentVal.replace(/^0x/i, "").toLowerCase()

    setTicketBusy(true)
    try {
      const params: MutableUpdateTicketParams = {}
      if (name !== origName) params.name = name
      if (desc !== origDesc) params.description = (desc === "" ? null : desc) as UpdateTicketParams["description"]
      if (stageId !== origStage && stageId !== "") params.stageId = BigInt(stageId)
      if (pr !== origPr) params.priority = toUpdateTicketPriority(pr)
      if (Object.keys(params).length > 0) {
        await updateTicket.mutateAsync({ ticketId, params })
      }
      if (agentHex !== origAgent && String(helpdeskEnumTag(selectedTicket.state)) !== "Closed") {
        if (agentVal !== "") {
          await assignTicket.mutateAsync({
            ticketId,
            agentIdentityHex: agentVal,
          })
        }
      }
      setTicketDialogOpen(false)
      setSelectedTicket(null)
    } finally {
      setTicketBusy(false)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={onRowClick}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? ticketFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <FormModal
        open={csvImportKind !== null}
        onOpenChange={(open) => !open && setCsvImportKind(null)}
        config={csvImportKind ? helpdeskCsvImportForm(t, csvImportKind) : helpdeskCsvImportForm(t, "ticket")}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          const csv = String(formData.csvData ?? "")
          if (!csv.trim() || !csvImportKind) return
          if (csvImportKind === "ticket") await importTicketsCsv.mutateAsync(csv)
          setCsvImportKind(null)
        }}
      />
      {ticketDetailFormConfig && selectedTicket ? (
        <HelpdeskTicketDialog
          open={ticketDialogOpen}
          onOpenChange={(open) => {
            setTicketDialogOpen(open)
            if (!open) setSelectedTicket(null)
          }}
          formConfig={ticketDetailFormConfig}
          stateTag={helpdeskEnumTag(selectedTicket.state)}
          isBusy={ticketBusy}
          onSave={handleTicketSave}
          onCloseTicket={async () => {
            if (!selectedTicket) return
            setTicketBusy(true)
            try {
              await closeTicket.mutateAsync({ ticketId: Number(selectedTicket.id) })
              setTicketDialogOpen(false)
              setSelectedTicket(null)
            } finally {
              setTicketBusy(false)
            }
          }}
          onReopenTicket={async () => {
            if (!selectedTicket) return
            setTicketBusy(true)
            try {
              await reopenTicket.mutateAsync({ ticketId: Number(selectedTicket.id) })
              setTicketDialogOpen(false)
              setSelectedTicket(null)
            } finally {
              setTicketBusy(false)
            }
          }}
        />
      ) : null}
    </>
  )
}
