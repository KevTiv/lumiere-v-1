"use client"

import { crmModuleConfig } from "@/lib/module-dashboard-configs"
import {
  crmParamsToJson,
  toCreateActivityParams,
  toCreateContactParams,
  toCreateLeadParams,
  toCreateOpportunityParams,
} from "@/lib/crm-create-params"
import { groupBy } from "@/lib/utils"
import { useTranslation } from "@lumiere/i18n"
import {
  useActivities,
  useContacts,
  useCreateActivity,
  useCreateContact,
  useCreateLead,
  useCreateOpportunity,
  useLeads,
  useOpportunities,
  useOpportunityStages,
} from "@/hooks/crm"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { FormModal, ModuleView, newActivityForm, newContactForm, newLeadForm, newOpportunityForm, MissingOrganization } from "@lumiere/ui"
import { useMemo, useState } from "react"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

interface CrmClientProps {
  initialLeads?: Record<string, unknown>[]
  initialOpportunities?: Record<string, unknown>[]
  initialContacts?: Record<string, unknown>[]
  organizationId?: number
}

type CrmClientLoadedProps = Omit<CrmClientProps, "organizationId"> & {
  organizationId: number
}

export function CrmClient(props: CrmClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <CrmClientLoaded {...props} organizationId={props.organizationId} />
}

function CrmClientLoaded({
  initialLeads,
  initialOpportunities,
  initialContacts,
  organizationId,
}: CrmClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: leads = [] } = useLeads(orgId, initialLeads)
  const { data: opportunities = [] } = useOpportunities(orgId, initialOpportunities)
  const { data: contacts = [] } = useContacts(orgId, initialContacts)
  const { data: activities = [] } = useActivities(orgId)
  const { data: opportunityStages = [] } = useOpportunityStages(orgId)

  const opportunityStageOptions = useMemo(
    () =>
      [...opportunityStages]
        .sort(
          (a, b) =>
            Number((a as Record<string, unknown>).sequence ?? 0) -
            Number((b as Record<string, unknown>).sequence ?? 0),
        )
        .map((s) => {
          const row = s as Record<string, unknown>
          return {
            value: String(row.id ?? ""),
            label: String(row.name ?? row.id ?? ""),
          }
        }),
    [opportunityStages],
  )

  const createLead = useCreateLead(orgId)
  const createOpportunity = useCreateOpportunity(orgId)
  const createContact = useCreateContact(orgId)
  const createActivity = useCreateActivity(orgId)

  const moduleConfig = useMemo(() => crmModuleConfig(t), [t])

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const activeLeads = leads.filter((l) => String(l.state) !== "Lost" && String(l.state) !== "Won").length
    const pipelineValue = opportunities.reduce((s, o) => s + Number(o.expectedRevenue ?? 0), 0)
    const wonOpps = opportunities.filter((o) => Number(o.probability) === 100)
    const totalOpps = opportunities.length
    const winRate = totalOpps > 0 ? Math.round((wonOpps.length / totalOpps) * 100) : 0

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
                { label: t("crm.dashboard.activeLeads"), value: String(activeLeads), icon: "Users" },
                { label: t("crm.dashboard.pipelineValue"), value: `$${pipelineValue.toLocaleString()}`, icon: "TrendingUp" },
                { label: t("crm.dashboard.openOpportunities"), value: String(opportunities.length), icon: "Target" },
                { label: t("crm.dashboard.totalContacts"), value: String(contacts.length), icon: "BookUser" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_lead: () => setQuickActionForm({ form: newLeadForm(t), action: "createLead" }),
            create_opportunity: () =>
              setQuickActionForm({
                form: newOpportunityForm(t, opportunityStageOptions),
                action: "createOpportunity",
              }),
            create_contact: () => setQuickActionForm({ form: newContactForm(t), action: "createContact" }),
            log_activity: () => setQuickActionForm({ form: newActivityForm(t), action: "createActivity" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "crm-by-stage") {
          const stageGroups = groupBy(leads, (l) => String(l.state ?? "Unknown"))
          const stageValues = Object.entries(stageGroups)
            .map(([stage, items]) => ({ stage, Count: items.length }))
            .sort((a, b) => b.Count - a.Count)
          return { ...w, data: { ...(w.data as Record<string, unknown>), values: stageValues } }
        }
        if (w.id === "crm-pipeline-health") {
          const stageGroups = groupBy(opportunities, (o) => String(o.stageId ?? "0"))
          const stages = Object.entries(stageGroups)
            .map(([stage, items]) => ({ label: `Stage ${stage.slice(-4)}`, count: items.length }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 4)
          const colors = ["#6366f1", "#8b5cf6", "#a78bfa", "#22c55e"]
          const maxCount = stages[0]?.count ?? 1
          const metrics = stages.map((s, i) => ({
            label: s.label,
            value: s.count,
            max: maxCount,
            color: colors[i] ?? "#6366f1",
          }))
          return { ...w, data: { metrics } }
        }
        if (w.id === "crm-recent-contacts") {
          const recentRows = contacts.slice(0, 4).map((c) => ({
            name: String(c.name ?? ""),
            company: c.companyId ? `ID ${String(c.companyId).slice(-4)}` : "—",
            stage: "—",
            value: "—",
            lastContact: "—",
          }))
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows: recentRows } }
        }
        return w
      }),
    }))
  }, [leads, opportunities, contacts, moduleConfig, opportunityStageOptions, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }) as ModuleConfig,
    [moduleConfig, liveSections],
  )

  const data = useMemo(
    () => ({
      leads: leads as unknown as Record<string, unknown>[],
      opportunities: opportunities as unknown as Record<string, unknown>[],
      contacts: contacts as unknown as Record<string, unknown>[],
      activities: activities as unknown as Record<string, unknown>[],
    }),
    [leads, opportunities, contacts, activities],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createLead") {
      const p = toCreateLeadParams(formData)
      if (p) createLead.mutate(crmParamsToJson(p))
    } else if (action === "createOpportunity") {
      const p = toCreateOpportunityParams(formData)
      if (p) createOpportunity.mutate(crmParamsToJson(p))
    } else if (action === "createContact") {
      const p = toCreateContactParams(formData)
      if (p) createContact.mutate(crmParamsToJson(p))
    } else if (action === "createActivity") {
      const p = toCreateActivityParams(formData)
      if (p) createActivity.mutate(crmParamsToJson(p))
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
        config={quickActionForm?.form ?? newLeadForm(t)}
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
