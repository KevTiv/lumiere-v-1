"use client"

import { crmModuleConfig } from "@/lib/module-dashboard-configs"
import {
  crmParamsToJson,
  toConvertLeadParams,
  toConvertOpportunityParams,
  toCreateActivityParams,
  toCreateContactParams,
  toCreateLeadParams,
  toCreateOpportunityParams,
} from "@/lib/crm-create-params"
import { groupBy } from "@/lib/utils"
import { useTranslation } from "@lumiere/i18n"
import {
  useActivities,
  useAddContactToSegment,
  useAssignTagToContact,
  useCompleteActivity,
  useContacts,
  useConvertLeadToCustomer,
  useConvertOpportunityToSaleOrder,
  useCreateActivity,
  useCreateContact,
  useCreateLead,
  useCreateOpportunity,
  useDeleteContact,
  useLeads,
  useOpportunities,
  useOpportunityStages,
  useCrmCsvImportMutations,
} from "@lumiere/query-hooks/hooks/crm"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useWarehouses } from "@lumiere/query-hooks/hooks/inventory"
import type { EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  CrmRecordChatterDialog,
  CrmUtmSettings,
  FormModal,
  ModuleView,
  MissingOrganization,
  activitiesTableConfig,
  addContactToSegmentForm,
  assignTagToContactForm,
  convertLeadForm,
  convertOpportunityToOrderForm,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  newActivityForm,
  newContactForm,
  newLeadForm,
  newOpportunityForm,
  contactsTableConfig,
  leadsTableConfig,
  opportunitiesTableConfig,
  csvImportForm,
} from "@lumiere/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
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

type WorkflowModal =
  | { kind: "convertLead"; form: FormConfig; leadId: bigint }
  | { kind: "convertOpp"; form: FormConfig; opportunityId: bigint }
  | { kind: "assignTag"; form: FormConfig; contactId: bigint }
  | { kind: "addSegment"; form: FormConfig; contactId: bigint }
  | null

function rowIdBigInt(row: Record<string, unknown>): bigint {
  const r = row.id
  if (typeof r === "bigint") return r
  return BigInt(String(r ?? 0))
}

function crmTabToResModel(tabId: string): string | null {
  if (tabId === "leads") return "lead"
  if (tabId === "opportunities") return "opportunity"
  if (tabId === "contacts") return "contact"
  if (tabId === "activities") return "activity"
  return null
}

function crmRowChatterLabel(tabId: string, row: Record<string, unknown>): string {
  const id = String(row.id ?? "")
  if (tabId === "activities") {
    const s = String(row.summary ?? row.name ?? "").trim()
    return s || `Activity #${id}`
  }
  if (tabId === "leads") {
    const s = String(
      row.contactName ?? row.contact_name ?? row.name ?? row.emailFrom ?? row.email_from ?? "",
    ).trim()
    return s || `Lead #${id}`
  }
  if (tabId === "opportunities") {
    const s = String(row.name ?? "").trim()
    return s || `Opportunity #${id}`
  }
  if (tabId === "contacts") {
    const s = String(row.name ?? "").trim()
    return s || `Contact #${id}`
  }
  return id ? `Record #${id}` : "Record"
}

function leadStateRaw(row: Record<string, unknown>): string {
  return String(row.state ?? row.State ?? "").toLowerCase()
}

function partnerId(row: Record<string, unknown>): unknown {
  return row.partnerId ?? row.partner_id
}

type CrmCsvImportKind = "contact" | "lead" | "opportunity"

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
  const [workflowModal, setWorkflowModal] = useState<WorkflowModal>(null)
  const [csvKind, setCsvKind] = useState<CrmCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [chatterTarget, setChatterTarget] = useState<{
    resModel: string
    resId: bigint
    recordTitle: string
  } | null>(null)

  const { data: leads = [] } = useLeads(orgId, initialLeads)
  const { data: opportunities = [] } = useOpportunities(orgId, initialOpportunities)
  const { data: contacts = [] } = useContacts(orgId, initialContacts)
  const { data: activities = [] } = useActivities(orgId)
  const { data: opportunityStages = [] } = useOpportunityStages(orgId)
  const { data: pricelists = [] } = usePricelists(orgId)
  const { data: warehouses = [] } = useWarehouses(orgId)

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

  const pricelistSelectOptions = useMemo(
    () =>
      pricelists.map((p) => {
        const row = p as Record<string, unknown>
        return {
          value: String(row.id ?? ""),
          label: String(row.name ?? row.id ?? ""),
        }
      }),
    [pricelists],
  )

  const warehouseSelectOptions = useMemo(
    () =>
      warehouses.map((w) => {
        const row = w as Record<string, unknown>
        return {
          value: String(row.id ?? ""),
          label: String(row.name ?? row.id ?? ""),
        }
      }),
    [warehouses],
  )

  const createLead = useCreateLead(orgId)
  const createOpportunity = useCreateOpportunity(orgId)
  const createContact = useCreateContact(orgId)
  const createActivity = useCreateActivity(orgId)
  const convertLead = useConvertLeadToCustomer(orgId)
  const convertOppToOrder = useConvertOpportunityToSaleOrder(orgId)
  const deleteContact = useDeleteContact(orgId)
  const assignTag = useAssignTagToContact(orgId)
  const addToSegment = useAddContactToSegment(orgId)
  const completeActivity = useCompleteActivity(orgId)
  const csvImports = useCrmCsvImportMutations(orgId)

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<CrmCsvImportKind, string> = {
      contact: "crm.csvImport.contactsTitle",
      lead: "crm.csvImport.leadsTitle",
      opportunity: "crm.csvImport.opportunitiesTitle",
    }
    return csvImportForm(t, t(titleKey[csvKind]))
  }, [csvKind, t])

  const openConvertLeadModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (leadStateRaw(row) !== "qualified") {
        window.alert(t("crm.actions.convertLeadQualifiedOnly"))
        return
      }
      const leadId = rowIdBigInt(row)
      const base = convertLeadForm(t, opportunityStageOptions)
      const form = mergeFieldDefaultValues(base, {
        createContact: true,
        createOpportunity: true,
      })
      setWorkflowModal({ kind: "convertLead", leadId, form })
    },
    [t, opportunityStageOptions],
  )

  const openConvertOppModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const pid = partnerId(row)
      if (pid == null || pid === "") {
        window.alert(t("crm.actions.convertOppNeedsPartner"))
        return
      }
      const opportunityId = rowIdBigInt(row)
      let base = convertOpportunityToOrderForm(t)
      base = mergeSelectOptionsForFields(base, {
        pricelistId: pricelistSelectOptions,
        warehouseId: warehouseSelectOptions,
      })
      const defaults: Record<string, unknown> = {}
      if (pricelistSelectOptions[0]) defaults.pricelistId = pricelistSelectOptions[0].value
      if (warehouseSelectOptions[0]) defaults.warehouseId = warehouseSelectOptions[0].value
      const form = mergeFieldDefaultValues(base, defaults)
      setWorkflowModal({ kind: "convertOpp", opportunityId, form })
    },
    [t, pricelistSelectOptions, warehouseSelectOptions],
  )

  const openAssignTagModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      setWorkflowModal({
        kind: "assignTag",
        contactId: rowIdBigInt(row),
        form: assignTagToContactForm(t),
      })
    },
    [t],
  )

  const openAddSegmentModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      setWorkflowModal({
        kind: "addSegment",
        contactId: rowIdBigInt(row),
        form: addContactToSegmentForm(t),
      })
    },
    [t],
  )

  const moduleConfig = useMemo((): ModuleConfig => {
    const base = crmModuleConfig(t)

    const leadsCfg = leadsTableConfig(t)
    const oppCfg = opportunitiesTableConfig(t)
    const contactCfg = contactsTableConfig(t)
    const actCfg = activitiesTableConfig(t)

    const leadsEntity: EntityViewConfig = {
      ...leadsCfg,
      view: {
        ...(leadsCfg.view as EntityTableConfig),
        actions: [
          {
            id: "csv-leads",
            label: t("crm.csvImport.toolbarLeads"),
            onClick: () => setCsvKind("lead"),
          },
          {
            id: "convert-lead",
            label: t("crm.actions.convertToCustomer"),
            requiresSelection: true,
            onClick: openConvertLeadModal,
          },
        ],
      },
    }

    const oppEntity: EntityViewConfig = {
      ...oppCfg,
      view: {
        ...(oppCfg.view as EntityTableConfig),
        actions: [
          {
            id: "csv-opportunities",
            label: t("crm.csvImport.toolbarOpportunities"),
            onClick: () => setCsvKind("opportunity"),
          },
          {
            id: "convert-opp-order",
            label: t("crm.actions.convertToSaleOrder"),
            requiresSelection: true,
            onClick: openConvertOppModal,
          },
        ],
      },
    }

    const contactEntity: EntityViewConfig = {
      ...contactCfg,
      view: {
        ...(contactCfg.view as EntityTableConfig),
        actions: [
          {
            id: "csv-contacts",
            label: t("crm.csvImport.toolbarContacts"),
            onClick: () => setCsvKind("contact"),
          },
          {
            id: "assign-tag",
            label: t("crm.actions.assignTag"),
            requiresSelection: true,
            onClick: openAssignTagModal,
          },
          {
            id: "add-segment",
            label: t("crm.actions.addToSegment"),
            requiresSelection: true,
            onClick: openAddSegmentModal,
          },
          {
            id: "delete-contact",
            label: t("crm.actions.deleteContact"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              const row = rows[0]
              if (!row) return
              if (!window.confirm(t("crm.actions.deleteContactConfirm"))) return
              deleteContact.mutate(rowIdBigInt(row))
            },
          },
        ],
      },
    }

    const activitiesEntity: EntityViewConfig = {
      ...actCfg,
      view: {
        ...(actCfg.view as EntityTableConfig),
        actions: [
          {
            id: "complete-activity",
            label: t("crm.actions.markComplete"),
            requiresSelection: true,
            onClick: (rows) => {
              const row = rows[0]
              if (!row) return
              if (row.isDone === true || String(row.state ?? "").toLowerCase() === "done") {
                window.alert(t("crm.actions.alreadyComplete"))
                return
              }
              completeActivity.mutate(rowIdBigInt(row))
            },
          },
        ],
      },
    }

    const coreTabs = base.tabs.map((tab) => {
      if (tab.id === "leads") return { ...tab, entityConfig: leadsEntity }
      if (tab.id === "opportunities") return { ...tab, entityConfig: oppEntity }
      if (tab.id === "contacts") return { ...tab, entityConfig: contactEntity }
      if (tab.id === "activities") return { ...tab, entityConfig: activitiesEntity }
      return tab
    })

    return {
      ...base,
      tabs: [
        ...coreTabs,
        {
          id: "attribution",
          label: t("crm.attribution.tabLabel"),
          type: "custom" as const,
          customContent: <CrmUtmSettings organizationId={organizationId} />,
        },
      ],
    }
  }, [
    t,
    organizationId,
    openConvertLeadModal,
    openConvertOppModal,
    openAssignTagModal,
    openAddSegmentModal,
    deleteContact,
    completeActivity,
  ])

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const activeLeads = leads.filter((l) => {
      const s = leadStateRaw(l as Record<string, unknown>)
      return s !== "lost" && s !== "won" && s !== "converted"
    }).length
    const pipelineValue = opportunities.reduce((s, o) => s + Number(o.expectedRevenue ?? 0), 0)
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
          const stageGroups = groupBy(leads, (l) => String((l as Record<string, unknown>).state ?? "Unknown"))
          const stageValues = Object.entries(stageGroups)
            .map(([stage, items]) => ({ stage, Count: items.length }))
            .sort((a, b) => b.Count - a.Count)
          return { ...w, data: { ...(w.data as Record<string, unknown>), values: stageValues } }
        }
        if (w.id === "crm-pipeline-health") {
          const stageGroups = groupBy(opportunities, (o) => String((o as Record<string, unknown>).stageId ?? "0"))
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
    () =>
      ({
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

  const handleWorkflowSubmit = async (formData: Record<string, unknown>) => {
    if (!workflowModal) return
    try {
      if (workflowModal.kind === "convertLead") {
        const p = toConvertLeadParams(formData)
        if (!p) throw new Error(t("crm.forms.convertLead.validation.stageRequired"))
        await convertLead.mutateAsync({ leadId: workflowModal.leadId, params: crmParamsToJson(p) })
      } else if (workflowModal.kind === "convertOpp") {
        const p = toConvertOpportunityParams(formData)
        if (!p) throw new Error(t("crm.forms.convertToSaleOrder.validation.pricelistWarehouse"))
        await convertOppToOrder.mutateAsync({
          opportunityId: workflowModal.opportunityId,
          params: crmParamsToJson(p),
        })
      } else if (workflowModal.kind === "assignTag") {
        const tagId = formData.tagId
        if (tagId == null || String(tagId).trim() === "") {
          throw new Error(t("crm.forms.assignTag.validation.tagId"))
        }
        await assignTag.mutateAsync({
          contactId: workflowModal.contactId,
          tagId: String(tagId),
        })
      } else if (workflowModal.kind === "addSegment") {
        const segmentId = formData.segmentId
        if (segmentId == null || String(segmentId).trim() === "") {
          throw new Error(t("crm.forms.addToSegment.validation.segmentId"))
        }
        await addToSegment.mutateAsync({
          segmentId: String(segmentId),
          contactId: workflowModal.contactId,
        })
      }
      setWorkflowModal(null)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Action failed")
      throw e
    }
  }

  const workflowModalKey =
    workflowModal == null
      ? "closed"
      : workflowModal.kind === "convertLead"
        ? `cl-${workflowModal.leadId.toString()}`
        : workflowModal.kind === "convertOpp"
          ? `co-${workflowModal.opportunityId.toString()}`
          : workflowModal.kind === "assignTag"
            ? `at-${workflowModal.contactId.toString()}`
            : `as-${workflowModal.contactId.toString()}`

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={(tabId, row) => {
          const resModel = crmTabToResModel(tabId)
          if (!resModel) return
          setChatterTarget({
            resModel,
            resId: rowIdBigInt(row),
            recordTitle: crmRowChatterLabel(tabId, row),
          })
        }}
      />
      {chatterTarget ? (
        <CrmRecordChatterDialog
          key={`${chatterTarget.resModel}-${chatterTarget.resId.toString()}`}
          open
          onOpenChange={(open) => {
            if (!open) setChatterTarget(null)
          }}
          organizationId={organizationId}
          resModel={chatterTarget.resModel}
          resId={chatterTarget.resId}
          recordTitle={chatterTarget.recordTitle}
        />
      ) : null}
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
      <FormModal
        key={workflowModalKey}
        open={workflowModal !== null}
        onOpenChange={(open) => !open && setWorkflowModal(null)}
        config={workflowModal?.form ?? newLeadForm(t)}
        onSubmit={(formData) => {
          handleWorkflowSubmit(formData)
        }}
      />
      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "contact") await csvImports.importContact.mutateAsync(text)
              else if (csvKind === "lead") await csvImports.importLead.mutateAsync(text)
              else await csvImports.importOpportunity.mutateAsync(text)
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </>
  )
}
