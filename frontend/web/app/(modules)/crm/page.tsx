"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { crmModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useLeads,
  useOpportunities,
  useContacts,
  useCreateLead,
  useCreateOpportunity,
  useCreateContact,
} from "@lumiere/stdb"
import type {
  CreateLeadParams,
  CreateOpportunityParams,
  CreateContactParams,
} from "@lumiere/stdb"

// TODO: replace with real org ID from auth context
const ORG_ID = 1n

export default function CrmPage() {
  const { data: leads = [] } = useLeads(ORG_ID)
  const { data: opportunities = [] } = useOpportunities(ORG_ID)
  const { data: contacts = [] } = useContacts(ORG_ID)

  const createLead = useCreateLead(ORG_ID)
  const createOpportunity = useCreateOpportunity(ORG_ID)
  const createContact = useCreateContact(ORG_ID)

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const activeLeads = leads.filter((l) => String(l.state) !== "Lost" && String(l.state) !== "Won").length
    const pipelineValue = opportunities.reduce((s, o) => s + Number(o.expectedRevenue ?? 0), 0)
    const wonOpps = opportunities.filter((o) => String(o.active) === "false" && Number(o.probability) === 100)
    const totalOpps = opportunities.length
    const winRate = totalOpps > 0 ? Math.round((wonOpps.length / totalOpps) * 100) : 0

    const dashboardTab = crmModuleConfig.tabs.find((t) => t.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Active Leads", value: String(activeLeads), icon: "Users" },
                { label: "Pipeline Value", value: `$${pipelineValue.toLocaleString()}`, icon: "TrendingUp" },
                { label: "Open Opportunities", value: String(opportunities.length), icon: "Target" },
                { label: "Total Contacts", value: String(contacts.length), icon: "BookUser" },
              ],
            },
          }
        }
        return w
      }),
    }))
  }, [leads, opportunities, contacts])

  const config = useMemo(
    () => ({
      ...crmModuleConfig,
      tabs: crmModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections],
  )

  const data = useMemo(
    () => ({
      leads: leads as unknown as Record<string, unknown>[],
      opportunities: opportunities as unknown as Record<string, unknown>[],
      contacts: contacts as unknown as Record<string, unknown>[],
    }),
    [leads, opportunities, contacts],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createLead") {
      createLead.mutate(formData as unknown as CreateLeadParams)
    } else if (action === "createOpportunity") {
      createOpportunity.mutate(formData as unknown as CreateOpportunityParams)
    } else if (action === "createContact") {
      createContact.mutate(formData as unknown as CreateContactParams)
    }
  }

  return (
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
