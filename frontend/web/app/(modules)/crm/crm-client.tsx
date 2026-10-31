"use client"
import { Button } from "@lumiere/ui/components/button"
import { RecordCreationRecovery } from '../../../components/record-creation-recovery'

import { crmContactListRow, crmLeadListRow } from "@/lib/crm-list-rows"
import { crmContactListFieldAliases, crmLeadListFieldAliases, crmOpportunityListFieldAliases } from "@lumiere/ui/lib/crm-entity-configs"
import { useCurrencyFormat } from "@lumiere/ui"
import { resolveRuntimeFormRoleId } from "@lumiere/ui/lib/runtime-form-role"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { CompanyModuleInsights, type InsightPeriodRange } from "../../../components/module-insights"
import { withDetailInlineEdits, withInlineEdits } from "@lumiere/ui/lib/with-inline-edits"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { currencyCodeMap, type KpiTileDef } from "@lumiere/ui/lib/kpi-tiles"
import { opportunityKpis } from "./opportunity-kpis"
import { inlineNumberAtLeast, requiredInlineEmail, requiredInlineText } from "@/lib/inline-edit-params"

import { CrmDuplicateContacts } from "@/lib/crm-duplicate-contacts-panel"
import { ContactIdentitiesPanel } from "./contact-identities-panel"
import { ContactPaymentsAndMessagesPanel } from "./contact-payments-and-messages-panel"
import { ContactConsentPanel } from "./contact-consent-panel"
import { ContactRelationshipsPanel } from "./contact-relationships-panel"
import { OpportunityPresenceBanner } from "./opportunity-presence-banner"
import { CrmMyWorkPanel } from "./crm-my-work-panel"
import { CrmRecordActions } from "./crm-record-actions"
import { EntityRecordSheet } from "@lumiere/ui/entity-views/entity-record-sheet"
import { crmWorkflowActions, crmLeadState, crmOpportunityClosed, crmOpportunityStatus, type CrmRecordKind, type CrmActionContext, type CrmActionId } from "./crm-workflow"
import { useQuery } from "@tanstack/react-query"
import { CrmPipelineAdminPanel } from "./crm-pipeline-admin-panel"
import { CrmCountryPackPanel } from "./crm-country-pack-panel"
import { LeadScorePanel } from "./lead-score-panel"
import { CrmInboxPanel } from "./crm-inbox-panel"
import { RelationshipInsightPanel } from "./relationship-insight-panel"
import { SegmentRulesPanel } from "./segment-rules-panel"
import { useCrmModuleSubscription } from "@/lib/module-subscription-hooks"
import { phCapture } from "@/lib/posthog-browser"
import {
  customFieldEntriesFromMetadata,
  persistCustomFieldsToEav,
} from "@/lib/persist-record-custom-fields"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import { crmModuleConfig } from "@/lib/module-dashboard-configs"
import {
  toConvertLeadParams,
  toConvertOpportunityParams,
  toCreateActivityParams,
  toCreateContactParams,
  toCreateLeadParams,
  toCreateOpportunityLineParams,
  toCreateOpportunityParams,
} from "@/lib/crm-create-params"
import {
  openOpportunityRowsToSelectOptions,
  productRowsToSelectOptions,
  uomRowsToSelectOptions,
  contactTagRowsToSelectOptions,
  contactCategoryRowsToSelectOptions,
  contactSegmentRowsToSelectOptions,
  taxRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  timestampToDateInputValue,
  toCreateContactSegmentParamsFromForm,
  toCreateContactCategoryParamsFromForm,
  toCreateContactTagParamsFromForm,
  toUpdateContactAddressParams,
  toUpdateContactBusinessParams,
  toUpdateContactDetailsParams,
  toUpdateContactParams,
  toUpdateLeadAddressParams,
  toUpdateLeadDetailsParams,
  toUpdateLeadRevenueParams,
  toUpdateOpportunityParams,
  toUpdateOpportunityStageParams,
} from "@/lib/crm-update-params"
import { groupBy } from "@/lib/utils"
import { useTranslation } from "@lumiere/i18n"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import type { CreateCrmForecastSnapshotParams } from "@lumiere/stdb/types"
import { useRuntimeListConfig } from "@lumiere/ui/forms"
import { formText, recordOptions, useFormDialog } from "@lumiere/ui/forms/use-form-dialog"
import { activeCategories, canArchiveCategory, canManageContactCategories } from "./contact-category-actions"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { contactPrimaryLabel } from "@lumiere/stdb/read-models"
import {
  useActivities,
  useAddContactToSegment,
  useAddContactCategories,
  useArchiveContactCategory,
  useClearContactCategories,
  useRemoveContactCategories,
  useReplaceContactCategories,
  useUpdateContactCategory,
  useAssignTagToContact,
  useCompleteActivity,
  useContactCategories,
  useContacts,
  useContactSegments,
  useContactTags,
  useCreateContactCategory,
  useConvertLeadToCustomer,
  useConvertOpportunityToSaleOrder,
  useCreateActivity,
  useCreateContact,
  useCreateContactSegment,
  useCreateContactTag,
  useCreateLead,
  useCreateOpportunity,
  useCreateOpportunityLine,
  useDeleteContact,
  useDeleteLead,
  useLeads,
  useLeadLostReasons,
  useOpportunities,
  useOpportunityLines,
  useOpportunityStages,
  useUpdateContact,
  useUpdateContactAddress,
  useUpdateContactBusiness,
  useUpdateContactDetails,
  useUpdateLead,
  useUpdateOpportunity,
  useCrmCsvImportMutations,
  useCreateForecastSnapshot,
  useCrmForecastSnapshots,
  type Lead,
  type Opportunity,
  type Contact,
} from "@lumiere/query-hooks/hooks/crm"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useProducts, useUoms, useWarehouses } from "@lumiere/query-hooks/hooks/inventory"
import { useAccountTaxes } from "@lumiere/query-hooks/hooks/accounting"
import { EntityLabelsProvider, labelsFromOptions } from "@lumiere/ui"
import type { EntityRecordSheetConfig, EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import type { EntityAction, EntityRow } from "@lumiere/ui/lib/entity-view-types"
import { entityTableConfigFromView } from "@lumiere/ui/lib/entity-view-types"
import {
  DEFAULT_KANBAN_COLUMN_COLORS,
  CrmRecordChatter,
  CrmUtmSettings,
  ModuleView,
  MissingOrganization,
  RuntimeFormModal,
  useRBAC,
  activitiesTableConfig,
  addContactToSegmentForm,
  addOpportunityLineForm,
  assignCategoryToContactForm,
  assignTagToContactForm,
  contactCategoriesTableConfig,
  contactSegmentsTableConfig,
  contactTagsTableConfig,
  convertLeadForm,
  convertOpportunityToOrderForm,
  changeOpportunityStageForm,
  editContactAddressForm,
  editContactBusinessForm,
  editContactDetailsForm,
  editContactForm,
  editLeadAddressForm,
  editLeadDetailsForm,
  editLeadRevenueForm,
  editOpportunityForm,
  markOpportunityLostForm,
  mergeFieldDefaultValues,
  newContactCategoryForm,
  newContactSegmentForm,
  newContactTagForm,
  mergeSelectOptionsByFieldName,
  mergeSelectOptionsForFields,
  newActivityForm,
  newContactForm,
  newLeadForm,
  newOpportunityForm,
  contactsTableConfig,
  contactDetailConfig,
  leadDetailConfig,
  leadsTableConfig,
  opportunityDetailConfig,
  opportunitiesTableConfig,
  ImportAssistantWizard,
  useIdentityLabelMap,
  buildModuleTabHref,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from "@lumiere/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { canUseModuleData, mergeModuleStates, moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { useRouter } from "next/navigation"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useModuleFilters } from "@/hooks/use-module-filters"

export { CRM_UI_REDUCERS } from "@/lib/crm-ui-reducers"

interface CrmClientProps {
  initialLeads?: Lead[]
  initialOpportunities?: Opportunity[]
  initialContacts?: Contact[]
  organizationId?: number
}

type CrmClientLoadedProps = Omit<CrmClientProps, "organizationId"> & {
  organizationId: number
}

type WorkflowModal =
  | { kind: "convertLead"; form: FormConfig; leadId: bigint }
  | { kind: "convertOpp"; form: FormConfig; opportunityId: bigint; companyId: bigint }
  | { kind: "scheduleActivity"; form: FormConfig; targetKind: CrmRecordKind; targetId: bigint }
  | { kind: "assignTag"; form: FormConfig; contactId: bigint }
  | { kind: "assignCategory"; form: FormConfig; contactId: bigint }
  | { kind: "addSegment"; form: FormConfig; contactId: bigint }
  | { kind: "changeStage"; form: FormConfig; opportunityId: bigint; companyId: bigint }
  | { kind: "editOpportunity"; form: FormConfig; opportunityId: bigint; companyId: bigint }
  | { kind: "markOppLost"; form: FormConfig; opportunityId: bigint; companyId: bigint }
  | { kind: "editContact"; form: FormConfig; contactId: bigint }
  | { kind: "editContactAddress"; form: FormConfig; contactId: bigint }
  | { kind: "editContactBusiness"; form: FormConfig; contactId: bigint }
  | { kind: "editContactDetails"; form: FormConfig; contactId: bigint }
  | { kind: "editLeadDetails"; form: FormConfig; leadId: bigint }
  | { kind: "editLeadAddress"; form: FormConfig; leadId: bigint }
  | { kind: "editLeadRevenue"; form: FormConfig; leadId: bigint }
  | null

function rowIdBigInt(row: Record<string, unknown>): bigint {
  const r = row.id ?? row.Id
  if (typeof r === "bigint") return r
  if (typeof r === "number" && Number.isFinite(r)) return BigInt(Math.trunc(r))
  if (typeof r === "string" && r.trim() !== "") return BigInt(r)
  if (typeof r === "object" && r !== null && !Array.isArray(r)) {
    const obj = r as Record<string, unknown>
    if ("some" in obj) {
      const inner = obj.some
      if (typeof inner === "bigint") return inner
      if (typeof inner === "number" && Number.isFinite(inner)) return BigInt(Math.trunc(inner))
      if (typeof inner === "string" && inner.trim() !== "") return BigInt(inner)
    }
  }
  return BigInt(String(r ?? 0))
}

function attachEmptyStateAction(
  view: EntityViewConfig["view"],
  onAction: () => void,
): EntityViewConfig["view"] {
  if (view.mode === "table") {
    if (!view.emptyState) return view
    return { ...view, emptyState: { ...view.emptyState, onAction } }
  }
  if (view.mode === "table-or-board") {
    if (!view.table.emptyState) return view
    return {
      ...view,
      table: { ...view.table, emptyState: { ...view.table.emptyState, onAction } },
    }
  }
  return view
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
    const label = contactPrimaryLabel(row).trim()
    return label || `Contact #${id}`
  }
  return id ? `Record #${id}` : "Record"
}

function scalarFieldString(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.toLowerCase()
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("some" in obj) return scalarFieldString(obj.some)
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag.toLowerCase()
  }
  return String(value).toLowerCase()
}

function leadStateRaw(row: Record<string, unknown>): string {
  return crmLeadState(row)
}

function oppIsClosed(row: Record<string, unknown>): boolean {
  return crmOpportunityClosed(row)
}

function recordTimestampMs(row: Record<string, unknown>): number {
  const raw = row.writeDate ?? row.write_date ?? row.createDate ?? row.create_date
  if (raw == null) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e15 ? n / 1000 : n
}

function rowCompanyId(row: Record<string, unknown>, fallback: bigint): bigint {
  const raw = row.companyId ?? row.company_id
  if (raw == null || raw === "") return fallback
  if (typeof raw === "bigint") return raw
  return BigInt(String(raw))
}

function partnerId(row: Record<string, unknown>): unknown {
  return row.partnerId ?? row.partner_id
}

function leadStateFilterFromCategory(category: string): string {
  const trimmed = category.trim()
  if (!trimmed || trimmed.toLowerCase() === "unknown") return trimmed
  return trimmed.toLowerCase()
}

function leadStageLabel(row: Record<string, unknown>): string {
  const raw = row.state ?? row.State
  if (raw == null) return "Unknown"
  if (typeof raw === "string") return raw
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
  }
  return String(raw)
}

type CrmCsvImportKind = "contact" | "lead" | "opportunity"

const closedWorkflowFormConfig: FormConfig = {
  id: "closed-crm-workflow",
  title: "",
  sections: [],
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
  useCrmModuleSubscription()
  const { t } = useTranslation()
  const router = useRouter()
  const { currentUser, checkPermission, permissionsReady } = useRBAC()
  const runtimeRoleId = resolveRuntimeFormRoleId(currentUser?.roles)
  const { orgId } = orgBigInts(organizationId)
  const ownerLabelMap = useIdentityLabelMap(organizationId)

  const leadsTableRuntime = useRuntimeListConfig({
    base: entityTableConfigFromView(leadsTableConfig(t).view),
    moduleId: "crm",
    formId: "new-lead",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:crm:leads:${organizationId}`,
    fieldAliases: crmLeadListFieldAliases,
  })
  const contactsTableRuntime = useRuntimeListConfig({
    base: entityTableConfigFromView(
      contactsTableConfig(t, { formatContactDisplayName: contactPrimaryLabel }).view,
    ),
    moduleId: "crm",
    formId: "new-contact",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:crm:contacts:${organizationId}`,
    fieldAliases: crmContactListFieldAliases,
  })
  const opportunitiesTableRuntime = useRuntimeListConfig({
    base: entityTableConfigFromView(opportunitiesTableConfig(t, { ownerLabelMap }).view),
    moduleId: "crm",
    formId: "new-opportunity",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:crm:opportunities:${organizationId}`,
    fieldAliases: crmOpportunityListFieldAliases,
  })
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const crmCustomFieldModel = {
    lead: "crm_lead",
    opportunity: "crm_lead",
    contact: "contact",
  } as const

  async function persistCrmCustomFields(args: {
    model: keyof typeof crmCustomFieldModel
    recordId: bigint
    metadata: unknown
  }) {
    if (!operatingCompanyId || operatingCompanyId === 0n) return
    if (customFieldEntriesFromMetadata(args.metadata).length === 0) return
    await persistCustomFieldsToEav({
      organizationId,
      companyId: operatingCompanyId,
      model: crmCustomFieldModel[args.model],
      recordId: args.recordId,
      metadata: args.metadata,
    })
  }

  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [focusedRecord, setFocusedRecord] = useState<{ kind: CrmRecordKind; id: string } | null>(null)
  const [workflowModal, setWorkflowModal] = useState<WorkflowModal>(null)
  const [workflowSubmitError, setWorkflowSubmitError] = useState<string | null>(null)
  const [csvKind, setCsvKind] = useState<CrmCsvImportKind | null>(null)
  const [dashboardTimeRange, setDashboardTimeRange] = useState<TimeRangeValue>("30d")
  const [insightPeriodRange, setInsightPeriodRange] = useState<InsightPeriodRange | null>(null)

  const leadsRead = moduleCollection(useLeads(orgId, initialLeads))
  const leads = leadsRead.rows
  const leadsLoading = leadsRead.state.status === "loading"
  const opportunitiesRead = moduleCollection(useOpportunities(orgId, initialOpportunities))
  const opportunities = opportunitiesRead.rows
  const opportunitiesLoading = opportunitiesRead.state.status === "loading"
  const opportunityLinesRead = moduleCollection(useOpportunityLines(orgId))
  const opportunityLines = opportunityLinesRead.rows
  const contactsRead = moduleCollection(useContacts(orgId, initialContacts))
  const contacts = contactsRead.rows
  const contactNamesForLists = useMemo(() => new Map(contacts.map((row) => [String(row.id), row.name])), [contacts])
  const contactsLoading = contactsRead.state.status === "loading"
  const contactTagsRead = moduleCollection(useContactTags(orgId))
  const contactTags = contactTagsRead.rows
  const contactCategoriesRead = moduleCollection(useContactCategories(orgId))
  const contactCategories = contactCategoriesRead.rows
  const contactSegmentsRead = moduleCollection(useContactSegments(orgId))
  const contactSegments = contactSegmentsRead.rows
  const activitiesRead = moduleCollection(useActivities(orgId))
  const activities = activitiesRead.rows
  const opportunityStagesQuery = useOpportunityStages(orgId)
  const { rows: opportunityStages } = moduleCollection(opportunityStagesQuery)
  const lostReasonsQuery = useLeadLostReasons(orgId)
  const { rows: leadLostReasons } = moduleCollection(lostReasonsQuery)
  const pricelistsQuery = usePricelists(orgId)
  const { rows: pricelists } = moduleCollection(pricelistsQuery)
  const warehousesQuery = useWarehouses(orgId)
  const { rows: warehouses } = moduleCollection(warehousesQuery)
  const activityTypesQuery = useQuery({
    queryKey: ["activity-types", organizationId],
    queryFn: () => fetchQueryList("/api/query/activity-types", "Could not load activity types"),
    staleTime: 60_000,
  })
  const activityTypeOptions = useMemo(() => moduleCollection(activityTypesQuery).rows
    .filter((row) => row.isActive === true)
    .map((row) => ({ value: String(row.id), label: String(row.name) })), [activityTypesQuery.data, activityTypesQuery.isError, activityTypesQuery.isLoading])
  const activityForm = useMemo(() => newActivityForm(t, activityTypeOptions), [t, activityTypeOptions])
  const { data: products = [] } = useProducts(orgId)
  const { data: uoms = [] } = useUoms(orgId)
  const { data: accountTaxes = [] } = useAccountTaxes(orgId)

  const opportunityStageOptions = useMemo(
    () =>
      [...opportunityStages]
        .filter((stage) => stage.isActive !== false)
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

  const stageById = useMemo(
    () =>
      new Map(
        opportunityStages.map((s) => {
          const row = s as Record<string, unknown>
          return [String(row.id ?? ""), String(row.name ?? "—")]
        }),
      ),
    [opportunityStages],
  )

  const partnerSelectOptions = useMemo(
    () =>
      contacts.map((c) => {
        const row = c as Record<string, unknown>
        const label = contactPrimaryLabel(row).trim() || String(row.name ?? row.id ?? "")
        return { value: String(row.id ?? ""), label }
      }),
    [contacts],
  )

  const contactTagSelectOptions = useMemo(() => {
    const fromApi = contactTagRowsToSelectOptions(contactTags as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("crm.contactTags.emptyMessage"), disabled: true }]
  }, [contactTags, t])

  const contactCategorySelectOptions = useMemo(() => {
    const fromApi = contactCategoryRowsToSelectOptions(contactCategories as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("crm.contactCategories.emptyMessage"), disabled: true }]
  }, [contactCategories, t])

  const contactSegmentSelectOptions = useMemo(() => {
    const fromApi = contactSegmentRowsToSelectOptions(contactSegments as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("crm.contactSegments.emptyMessage"), disabled: true }]
  }, [contactSegments, t])

  const assignTagFormConfig = useMemo(
    () => mergeSelectOptionsByFieldName(assignTagToContactForm(t), "tagId", contactTagSelectOptions),
    [t, contactTagSelectOptions],
  )

  const assignCategoryFormConfig = useMemo(
    () => mergeSelectOptionsByFieldName(assignCategoryToContactForm(t), "categoryId", contactCategorySelectOptions),
    [t, contactCategorySelectOptions],
  )

  const addContactToSegmentFormConfig = useMemo(
    () =>
      mergeSelectOptionsByFieldName(addContactToSegmentForm(t), "segmentId", contactSegmentSelectOptions),
    [t, contactSegmentSelectOptions],
  )

  // CRM-RI-011: the backend now requires a valid lost reason before an
  // opportunity may enter the Lost state. If the org hasn't configured any
  // lost reasons, surface that clearly instead of an empty, unusable picker
  // (same fallback convention as contactTagSelectOptions/contactSegmentSelectOptions).
  const lostReasonSelectOptions = useMemo(() => {
    const fromApi = (leadLostReasons as Record<string, unknown>[])
      .filter((row) => row.isActive !== false && row.is_active !== false)
      .map((r) => ({ value: String(r.id ?? ""), label: String(r.name ?? r.id ?? "") }))
      .filter((o) => o.value !== "")
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("crm.forms.markLost.noReasonsConfigured"), disabled: true }]
  }, [leadLostReasons, t])

  const markOpportunityLostFormConfig = useMemo(
    () => mergeSelectOptionsByFieldName(markOpportunityLostForm(t), "lostReasonId", lostReasonSelectOptions),
    [t, lostReasonSelectOptions],
  )

  const wonStageId = useMemo(() => {
    const matches = opportunityStages.filter(
      (s) => (s as Record<string, unknown>).isWon === true,
    )
    const stage = (matches.length === 1 ? matches[0] : undefined) as Record<string, unknown> | undefined
    if (!stage?.id || stage.isActive !== true) return null
    return BigInt(String(stage.id))
  }, [opportunityStages])

  const lostStageId = useMemo(() => {
    const stage = opportunityStages.find(
      (s) => { const row = s as Record<string, unknown>; return String(row.name ?? "") === "Lost" && row.isActive !== false },
    ) as Record<string, unknown> | undefined
    if (!stage?.id) return null
    return BigInt(String(stage.id))
  }, [opportunityStages])

  const enrichedOpportunities = useMemo(
    () =>
      opportunities.map((o) => {
        const row = o as Record<string, unknown>
        const stageId = String(row.stageId ?? row.stage_id ?? "")
        return {
          ...o,
          stageName: stageById.get(stageId) ?? "—",
          workflowStatus: crmOpportunityStatus(row),
          partnerName: contactNamesForLists.get(String(row.partnerId ?? row.partner_id ?? "")),
          contactName: contactNamesForLists.get(String(row.contactId ?? row.contact_id ?? "")),
        }
      }),
    [opportunities, stageById, contactNamesForLists],
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

  const openOpportunityOptions = useMemo(() => {
    const fromApi = openOpportunityRowsToSelectOptions(
      opportunities as Record<string, unknown>[],
    )
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("crm.forms.addOpportunityLine.fields.opportunityPlaceholder"),
        disabled: true,
      },
    ]
  }, [opportunities, t])

  const productFieldOptions = useMemo(() => {
    const fromApi = productRowsToSelectOptions(products as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noProducts"), disabled: true }]
  }, [products, t])

  const entityLabels = useMemo(
    () => ({
      partnerId: labelsFromOptions(partnerSelectOptions),
      productId: labelsFromOptions(productFieldOptions),
    }),
    [partnerSelectOptions, productFieldOptions],
  )

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noUoms"), disabled: true }]
  }, [uoms, t])

  const addOpportunityLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(addOpportunityLineForm(t), {
        opportunityId: openOpportunityOptions,
        productId: productFieldOptions,
        uomId: uomFieldOptions,
        taxIds: taxRowsToSelectOptions(accountTaxes, "Sale"),
      }),
    [t, openOpportunityOptions, productFieldOptions, uomFieldOptions, accountTaxes],
  )

  const createLead = useCreateLead(orgId, { companyId: operatingCompanyId })
  const createOpportunity = useCreateOpportunity(orgId, { companyId: operatingCompanyId ?? undefined })
  const createOpportunityLine = useCreateOpportunityLine(orgId, { companyId: operatingCompanyId ?? undefined })
  const updateOpportunity = useUpdateOpportunity(orgId, { companyId: operatingCompanyId ?? undefined })
  const createContact = useCreateContact(orgId, { companyId: operatingCompanyId ?? undefined })
  const createActivity = useCreateActivity(orgId)
  const convertLead = useConvertLeadToCustomer(orgId)
  const convertOppToOrder = useConvertOpportunityToSaleOrder(orgId, { companyId: operatingCompanyId ?? undefined })
  const deleteContact = useDeleteContact(orgId)
  const deleteLead = useDeleteLead(orgId)
  const assignTag = useAssignTagToContact(orgId)
  const addContactCategories = useAddContactCategories(orgId)
  const createContactCategory = useCreateContactCategory(orgId)
  const addToSegment = useAddContactToSegment(orgId)
  const completeActivity = useCompleteActivity(orgId)
  const createContactTag = useCreateContactTag(orgId)
  const createContactSegment = useCreateContactSegment(orgId)
  const updateContact = useUpdateContact(orgId)
  const updateContactAddress = useUpdateContactAddress(orgId)
  const updateContactBusiness = useUpdateContactBusiness(orgId)
  const updateContactDetails = useUpdateContactDetails(orgId)
  const updateLead = useUpdateLead(orgId)
  const updateContactCategory = useUpdateContactCategory(orgId)
  const archiveContactCategory = useArchiveContactCategory(orgId)
  const replaceContactCategories = useReplaceContactCategories(orgId)
  const removeContactCategories = useRemoveContactCategories(orgId)
  const clearContactCategories = useClearContactCategories(orgId)
  const { askForm, cancelForm, formDialog } = useFormDialog()
  const csvImports = useCrmCsvImportMutations(orgId)
  const { data: forecastSnapshots = [] } = useCrmForecastSnapshots(orgId)
  const createForecastSnapshot = useCreateForecastSnapshot(orgId)

  const csvImportTitle = useMemo(() => {
    if (!csvKind) return ""
    const titleKey: Record<CrmCsvImportKind, string> = {
      contact: "crm.csvImport.contactsTitle",
      lead: "crm.csvImport.leadsTitle",
      opportunity: "crm.csvImport.opportunitiesTitle",
    }
    return t(titleKey[csvKind])
  }, [csvKind, t])

  const buildConvertLeadForm = useCallback(() => {
    const base = convertLeadForm(t, opportunityStageOptions)
    const defaults: Record<string, unknown> = {
      createContact: true,
      createOpportunity: true,
    }
    if (opportunityStageOptions[0]) {
      defaults.opportunityStageId = opportunityStageOptions[0].value
    }
    return mergeFieldDefaultValues(base, defaults)
  }, [t, opportunityStageOptions])

  const buildConvertOppForm = useCallback(() => {
    let base = convertOpportunityToOrderForm(t)
    base = mergeSelectOptionsForFields(base, {
      pricelistId: pricelistSelectOptions,
      warehouseId: warehouseSelectOptions,
    })
    const defaults: Record<string, unknown> = {}
    if (pricelistSelectOptions[0]) defaults.pricelistId = pricelistSelectOptions[0].value
    if (warehouseSelectOptions[0]) defaults.warehouseId = warehouseSelectOptions[0].value
    return mergeFieldDefaultValues(base, defaults)
  }, [t, pricelistSelectOptions, warehouseSelectOptions])

  const openConvertLeadModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (leadStateRaw(row) !== "qualified") {
        showWorkflowToast({ kind: "info", title: t("crm.actions.convertLeadQualifiedOnly") })
        return
      }
      const leadId = rowIdBigInt(row)
      setWorkflowModal({ kind: "convertLead", leadId, form: buildConvertLeadForm() })
    },
    [t, buildConvertLeadForm],
  )

  const openConvertOppModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const pid = partnerId(row)
      if (pid == null || pid === "") {
        showWorkflowToast({ kind: "info", title: t("crm.actions.convertOppNeedsPartner") })
        return
      }
      const opportunityId = rowIdBigInt(row)
      setWorkflowModal({ kind: "convertOpp", opportunityId, companyId: rowCompanyId(row, operatingCompanyId), form: buildConvertOppForm() })
    },
    [t, buildConvertOppForm, operatingCompanyId],
  )

  const openAssignTagModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      setWorkflowModal({
        kind: "assignTag",
        contactId: rowIdBigInt(row),
        form: assignTagFormConfig,
      })
    },
    [assignTagFormConfig],
  )

  const openAssignCategoryModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      setWorkflowModal({
        kind: "assignCategory",
        contactId: rowIdBigInt(row),
        form: assignCategoryFormConfig,
      })
    },
    [assignCategoryFormConfig],
  )

  const openAddSegmentModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      setWorkflowModal({
        kind: "addSegment",
        contactId: rowIdBigInt(row),
        form: addContactToSegmentFormConfig,
      })
    },
    [addContactToSegmentFormConfig],
  )

  const openChangeStageModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (oppIsClosed(row)) {
        showWorkflowToast({ kind: "info", title: t("crm.actions.alreadyClosed") })
        return
      }
      let base = changeOpportunityStageForm(t, opportunityStageOptions)
      base = mergeSelectOptionsByFieldName(base, "stageId", opportunityStageOptions)
      const form = mergeFieldDefaultValues(base, {
        stageId: String(row.stageId ?? row.stage_id ?? ""),
      })
      setWorkflowModal({
        kind: "changeStage",
        opportunityId: rowIdBigInt(row),
        companyId: rowCompanyId(row, operatingCompanyId),
        form,
      })
    },
    [t, opportunityStageOptions, operatingCompanyId],
  )

  const openEditOpportunityModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      let base = editOpportunityForm(t)
      base = mergeSelectOptionsByFieldName(base, "stageId", opportunityStageOptions)
      base = mergeSelectOptionsByFieldName(base, "partnerId", partnerSelectOptions)
      const form = mergeFieldDefaultValues(base, {
        partnerId: String(row.partnerId ?? row.partner_id ?? ""),
        expectedRevenue: Number(row.expectedRevenue ?? row.expected_revenue ?? 0),
        dateDeadline: timestampToDateInputValue(row.dateDeadline ?? row.date_deadline),
        stageId: String(row.stageId ?? row.stage_id ?? ""),
        description: row.description != null ? String(row.description) : "",
      })
      setWorkflowModal({
        kind: "editOpportunity",
        opportunityId: rowIdBigInt(row),
        companyId: rowCompanyId(row, operatingCompanyId),
        form,
      })
    },
    [t, opportunityStageOptions, partnerSelectOptions, operatingCompanyId],
  )

  const openEditContactModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editContactForm(t), {
        name: String(row.name ?? ""),
        email: String(row.email ?? ""),
        phone: String(row.phone ?? ""),
        mobile: String(row.mobile ?? ""),
        isCustomer: Boolean(row.isCustomer ?? row.is_customer),
        isVendor: Boolean(row.isVendor ?? row.is_vendor),
        isProspect: Boolean(row.isProspect ?? row.is_prospect),
      })
      setWorkflowModal({ kind: "editContact", contactId: rowIdBigInt(row), form })
    },
    [t],
  )

  const openEditContactAddressModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editContactAddressForm(t), {
        street: String(row.street ?? ""),
        street2: String(row.street2 ?? row.street_2 ?? ""),
        city: String(row.city ?? ""),
        stateCode: String(row.stateCode ?? row.state_code ?? ""),
        zip: String(row.zip ?? ""),
        countryCode: String(row.countryCode ?? row.country_code ?? ""),
      })
      setWorkflowModal({ kind: "editContactAddress", contactId: rowIdBigInt(row), form })
    },
    [t],
  )

  const openEditContactBusinessModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editContactBusinessForm(t), {
        taxId: String(row.taxId ?? row.tax_id ?? ""),
        companyRegistry: String(row.companyRegistry ?? row.company_registry ?? ""),
        industry: String(row.industry ?? ""),
        employeesCount: Number(row.employeesCount ?? row.employees_count ?? 0),
        annualRevenue: Number(row.annualRevenue ?? row.annual_revenue ?? 0),
      })
      setWorkflowModal({ kind: "editContactBusiness", contactId: rowIdBigInt(row), form })
    },
    [t],
  )

  const openEditContactDetailsModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editContactDetailsForm(t), {
        firstName: String(row.firstName ?? row.first_name ?? ""),
        lastName: String(row.lastName ?? row.last_name ?? ""),
        title: String(row.title ?? ""),
        emailSecondary: String(row.emailSecondary ?? row.email_secondary ?? ""),
        fax: String(row.fax ?? ""),
        website: String(row.website ?? ""),
        description: row.description != null ? String(row.description) : "",
      })
      setWorkflowModal({ kind: "editContactDetails", contactId: rowIdBigInt(row), form })
    },
    [t],
  )

  const openEditLeadDetailsModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editLeadDetailsForm(t), {
        contactName: String(row.contactName ?? row.contact_name ?? ""),
        title: String(row.title ?? ""),
        website: String(row.website ?? ""),
        industry: String(row.industry ?? ""),
        referredBy: String(row.referredBy ?? row.referred_by ?? ""),
        description: row.description != null ? String(row.description) : "",
      })
      setWorkflowModal({ kind: "editLeadDetails", leadId: rowIdBigInt(row), form })
    },
    [t],
  )

  const openEditLeadAddressModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editLeadAddressForm(t), {
        street: String(row.street ?? ""),
        city: String(row.city ?? ""),
        zip: String(row.zip ?? ""),
        countryCode: String(row.countryCode ?? row.country_code ?? ""),
      })
      setWorkflowModal({ kind: "editLeadAddress", leadId: rowIdBigInt(row), form })
    },
    [t],
  )

  const openEditLeadRevenueModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      const form = mergeFieldDefaultValues(editLeadRevenueForm(t), {
        expectedRevenue: Number(row.expectedRevenue ?? row.expected_revenue ?? 0),
        probability: Number(row.probability ?? 0),
      })
      setWorkflowModal({ kind: "editLeadRevenue", leadId: rowIdBigInt(row), form })
    },
    [t],
  )

  const markOpportunityWon = useCallback(
    async (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (oppIsClosed(row)) {
        showWorkflowToast({ kind: "info", title: t("crm.actions.alreadyClosed") })
        return
      }
      // CRM-RI-011: lifecycle is a validated transition, not a raw flag. The
      // backend derives the Won axis from the target stage, so a configured
      // won stage is required for this action to succeed.
      const params: Record<string, unknown> = {
        desiredState: { tag: "Won" },
      }
      if (wonStageId != null) params.stageId = wonStageId
      await updateOpportunity.mutateAsync({
        opportunityId: rowIdBigInt(row),
        companyId: rowCompanyId(row, operatingCompanyId),
        params,
      })
      showWorkflowToast({ kind: "success", title: t("crm.workflow.feedback.won") })
    },
    [t, wonStageId, updateOpportunity, operatingCompanyId],
  )

  const markOpportunityLost = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (oppIsClosed(row)) {
        showWorkflowToast({ kind: "info", title: t("crm.actions.alreadyClosed") })
        return
      }
      // CRM-RI-011: the backend now requires a valid lost reason before an
      // opportunity may enter the Lost state, so this opens a reason picker
      // instead of mutating immediately (see markOpportunityWon for the
      // still-immediate Won path, which has no such requirement).
      setWorkflowModal({
        kind: "markOppLost",
        opportunityId: rowIdBigInt(row),
        companyId: rowCompanyId(row, operatingCompanyId),
        form: markOpportunityLostFormConfig,
      })
    },
    [t, operatingCompanyId, markOpportunityLostFormConfig],
  )

  const handleOpportunityStageMove = useCallback(
    async ({
      opportunityId,
      companyId,
      stageId,
    }: {
      opportunityId: bigint
      companyId: bigint
      stageId: bigint
    }) => {
      await updateOpportunity.mutateAsync({ opportunityId, companyId, params: { stageId } })
      showWorkflowToast({ kind: "success", title: t("crm.workflow.feedback.stageChanged") })
    },
    [t, updateOpportunity],
  )

  const opportunityBoardColumns = useMemo(
    () =>
      [...opportunityStages]
        .filter((s) => {
          const row = s as Record<string, unknown>
          return row.isActive !== false && row.is_active !== false
        })
        .sort(
          (a, b) =>
            Number((a as Record<string, unknown>).sequence ?? 0) -
            Number((b as Record<string, unknown>).sequence ?? 0),
        )
        .map((s, index) => {
          const row = s as Record<string, unknown>
          return {
            id: String(row.id ?? ""),
            title: String(row.name ?? row.id ?? "—"),
            colorClass:
              DEFAULT_KANBAN_COLUMN_COLORS[index % DEFAULT_KANBAN_COLUMN_COLORS.length] ??
              "bg-primary",
          }
        }),
    [opportunityStages],
  )

  const entityBoardContext = useMemo(
    () => ({
      opportunities: {
        columns: opportunityBoardColumns,
        filterItem: (row: Record<string, unknown>) => !oppIsClosed(row),
        onMove: async ({
          item,
          toColumnId,
        }: {
          item: Record<string, unknown>
          toColumnId: string
        }) => {
          await handleOpportunityStageMove({
            opportunityId: rowIdBigInt(item),
            companyId: rowCompanyId(item, operatingCompanyId),
            stageId: BigInt(toColumnId),
          })
        },
      },
    }),
    [handleOpportunityStageMove, opportunityBoardColumns, operatingCompanyId],
  )

  // Click-to-edit on the record sheets: the same update commands the edit forms send, one field at a time.
  const updateLeadAsync = updateLead.mutateAsync
  const updateOpportunityAsync = updateOpportunity.mutateAsync
  const leadDetail = useMemo(
    () =>
      withDetailInlineEdits(leadDetailConfig(t), {
        contactName: {
          kind: "text",
          save: async (row, value) => {
            const contactName = requiredInlineText(
              value,
              t("crm.inlineEdit.leadNameRequired", { defaultValue: "A lead needs a contact name" }),
            )
            await updateLeadAsync({ leadId: rowIdBigInt(row), params: { contactName } })
          },
        },
        expectedRevenue: {
          kind: "number",
          save: async (row, value) => {
            const expectedRevenue = inlineNumberAtLeast(
              value,
              0,
              t("crm.inlineEdit.revenueInvalid", { defaultValue: "Enter a revenue of 0 or more" }),
            )
            await updateLeadAsync({ leadId: rowIdBigInt(row), params: { expectedRevenue } })
          },
        },
        description: {
          kind: "markdown",
          save: async (row, value) => {
            const description = String(value).trim()
            await updateLeadAsync({ leadId: rowIdBigInt(row), params: { description: description || null } })
          },
        },
      }),
    [t, updateLeadAsync],
  )
  const opportunityDetail = useMemo(
    () =>
      withDetailInlineEdits(opportunityDetailConfig(t), {
        name: {
          kind: "text",
          save: async (row, value) => {
            const name = requiredInlineText(
              value,
              t("crm.inlineEdit.opportunityNameRequired", { defaultValue: "An opportunity needs a name" }),
            )
            await updateOpportunityAsync({
              opportunityId: rowIdBigInt(row),
              companyId: rowCompanyId(row, operatingCompanyId),
              params: { name },
            })
          },
        },
        expectedRevenue: {
          kind: "number",
          save: async (row, value) => {
            const expectedRevenue = inlineNumberAtLeast(
              value,
              0,
              t("crm.inlineEdit.revenueInvalid", { defaultValue: "Enter a revenue of 0 or more" }),
            )
            await updateOpportunityAsync({
              opportunityId: rowIdBigInt(row),
              companyId: rowCompanyId(row, operatingCompanyId),
              params: { expectedRevenue },
            })
          },
        },
        description: {
          kind: "markdown",
          save: async (row, value) => {
            await updateOpportunityAsync({
              opportunityId: rowIdBigInt(row),
              companyId: rowCompanyId(row, operatingCompanyId),
              params: { description: String(value).trim() },
            })
          },
        },
      }),
    [t, updateOpportunityAsync, operatingCompanyId],
  )

  const isFormMutationPending =
    createLead.isPending ||
    createOpportunity.isPending ||
    createOpportunityLine.isPending ||
    createContact.isPending ||
    createActivity.isPending ||
    convertLead.isPending ||
    convertOppToOrder.isPending ||
    updateOpportunity.isPending ||
    assignTag.isPending ||
    addContactCategories.isPending ||
    createContactCategory.isPending ||
    addToSegment.isPending ||
    createContactTag.isPending ||
    createContactSegment.isPending ||
    updateContact.isPending ||
    updateContactAddress.isPending ||
    updateContactBusiness.isPending ||
    updateContactDetails.isPending ||
    updateLead.isPending ||
    csvImports.importContact.isPending ||
    csvImports.importLead.isPending ||
    csvImports.importOpportunity.isPending

  const recordActionContext = useCallback((kind: CrmRecordKind): CrmActionContext => ({
    ready: (kind === "lead" ? leadsRead.state.status : kind === "opportunity" ? opportunitiesRead.state.status : contactsRead.state.status) === "ready",
    canWrite: checkPermission(kind, "write").allowed,
    canCreateActivity: checkPermission("activity", "create").allowed,
    canConvertLead: checkPermission("contact", "create").allowed && checkPermission("opportunity", "create").allowed,
    busy: isFormMutationPending,
    companyReady: operatingCompanyId !== 0n,
    stagesReady: moduleQueryState(opportunityStagesQuery).status === "ready" && opportunityStageOptions.length > 0,
    wonStageReady: moduleQueryState(opportunityStagesQuery).status === "ready" && wonStageId != null,
    lostReasonsReady: moduleQueryState(lostReasonsQuery).status === "ready" && lostReasonSelectOptions.some((option) => option.value !== ""),
    orderSetupReady: moduleQueryState(pricelistsQuery).status === "ready" && moduleQueryState(warehousesQuery).status === "ready"
      && pricelistSelectOptions.length > 0 && warehouseSelectOptions.length > 0 && wonStageId != null,
    activityTypesReady: activitiesRead.state.status === "ready" && moduleQueryState(activityTypesQuery).status === "ready" && activityTypeOptions.length > 0,
  }), [leadsRead.state.status, opportunitiesRead.state.status, contactsRead.state.status, checkPermission, isFormMutationPending,
    operatingCompanyId, opportunityStagesQuery, opportunityStageOptions.length, wonStageId, lostReasonsQuery, lostReasonSelectOptions,
    pricelistsQuery, warehousesQuery, pricelistSelectOptions.length, warehouseSelectOptions.length, activitiesRead.state.status, activityTypesQuery, activityTypeOptions.length])

  const handleRecordAction = useCallback(async (kind: CrmRecordKind, action: CrmActionId, row: EntityRow) => {
    const availability = crmWorkflowActions(kind, row, recordActionContext(kind)).find((item) => item.id === action)
    if (!availability || availability.reason) {
      showWorkflowToast({ kind: "info", title: t(`crm.workflow.reasons.${availability?.reason ?? "sourceUnavailable"}`) })
      return
    }
    phCapture("crm_record_action", { organization_id: organizationId, record_kind: kind, action })
    try {
      if (action === "qualify") {
        await updateLead.mutateAsync({ leadId: rowIdBigInt(row), params: { state: "qualified" } })
        showWorkflowToast({ kind: "success", title: t("crm.workflow.feedback.qualified") })
      } else if (action === "convertLead") openConvertLeadModal([row])
      else if (action === "changeStage") openChangeStageModal([row])
      else if (action === "won") await markOpportunityWon([row])
      else if (action === "lost") await markOpportunityLost([row])
      else if (action === "createOrder") openConvertOppModal([row])
      else if (action === "followUp") setWorkflowModal({ kind: "scheduleActivity", targetKind: kind, targetId: rowIdBigInt(row), form: activityForm })
      else if (kind === "lead") openEditLeadDetailsModal([row])
      else if (kind === "opportunity") openEditOpportunityModal([row])
      else openEditContactModal([row])
    } catch (error) {
      showWorkflowToast({ kind: "error", title: t("crm.workflow.feedback.failed"), description: error instanceof Error ? error.message : String(error) })
    }
  }, [recordActionContext, t, organizationId, updateLead, openConvertLeadModal, openChangeStageModal, markOpportunityWon,
    markOpportunityLost, openConvertOppModal, activityForm, openEditLeadDetailsModal, openEditOpportunityModal, openEditContactModal])

  const renderRecordActions = useCallback((kind: CrmRecordKind, row: EntityRow) => (
    <CrmRecordActions kind={kind} record={row} context={recordActionContext(kind)} onAction={(action, record) => handleRecordAction(kind, action, record)} />
  ), [recordActionContext, handleRecordAction])

  const leadRecordSheet = useMemo(
    (): EntityRecordSheetConfig => ({
      titleKey: "contactName",
      actions: (record) => renderRecordActions("lead", record),
      statusKey: "state",
      statusBadgeVariants: {
        new: "secondary",
        qualified: "outline",
        won: "default",
        lost: "destructive",
        converted: "default",
        New: "secondary",
        Qualified: "outline",
        Won: "default",
        Lost: "destructive",
      },
      statusBadgeLabels: {
        new: t("crm.leads.states.New"),
        qualified: t("crm.leads.states.Qualified"),
        won: t("crm.leads.states.Won"),
        lost: t("crm.leads.states.Lost"),
        converted: t("crm.leads.states.Converted"),
        New: t("crm.leads.states.New"),
        Qualified: t("crm.leads.states.Qualified"),
        Won: t("crm.leads.states.Won"),
        Lost: t("crm.leads.states.Lost"),
      },
      detailConfig: leadDetail,
      auditTableName: "lead",
      discussion: {},
      customTabs: [
        {
          id: "score",
          label: t("crm.scoring.tabLabel", "Score"),
          content: (record) => (
            <LeadScorePanel
              organizationId={organizationId}
              leadId={rowIdBigInt(record)}
            />
          ),
        },
        {
          id: "activity",
          label: t("crm.chatter.timeline"),
          content: (record) => (
            <CrmRecordChatter
              organizationId={organizationId}
              resModel="lead"
              resId={rowIdBigInt(record)}
              recordTitle={crmRowChatterLabel("leads", record)}
            />
          ),
        },
      ],
    }),
    [t, organizationId, leadDetail, renderRecordActions],
  )

  const opportunityRecordSheet = useMemo(
    (): EntityRecordSheetConfig => ({
      titleKey: "name",
      actions: (record) => renderRecordActions("opportunity", record),
      statusKey: "workflowStatus",
      statusBadgeVariants: { open: "info", won: "success", lost: "destructive" },
      statusBadgeLabels: {
        open: t("crm.workflow.status.open"), won: t("crm.workflow.status.won"), lost: t("crm.workflow.status.lost"),
      },
      detailConfig: opportunityDetail,
      auditTableName: "opportunity",
      discussion: {},
      customTabs: [
        {
          id: "activity",
          label: t("crm.chatter.timeline"),
          content: (record) => (
            <div className="space-y-3">
              <OpportunityPresenceBanner
                organizationId={organizationId}
                opportunityId={rowIdBigInt(record)}
                userName={t("crm.presence.you", "You")}
              />
              <CrmRecordChatter
                organizationId={organizationId}
                resModel="opportunity"
                resId={rowIdBigInt(record)}
                recordTitle={crmRowChatterLabel("opportunities", record)}
              />
            </div>
          ),
        },
      ],
    }),
    [t, organizationId, opportunityDetail, renderRecordActions],
  )

  const contactRecordSheet = useMemo(
    (): EntityRecordSheetConfig => ({
      titleKey: "name",
      actions: (record) => renderRecordActions("contact", record),
      detailConfig: contactDetailConfig(t),
      auditTableName: "contact",
      discussion: {},
      customTabs: [
        {
          id: "phones-and-roles",
          label: "Phones & roles",
          content: (record) => (
            <ContactIdentitiesPanel
              organizationId={organizationId}
              contactId={rowIdBigInt(record)}
              companyId={rowCompanyId(record, operatingCompanyId)}
            />
          ),
        },
        {
          id: "relationships",
          label: t("crm.relationships.tabLabel", "Relationships"),
          content: (record) => (
            <div className="space-y-4">
              <RelationshipInsightPanel
                organizationId={organizationId}
                contactId={rowIdBigInt(record)}
              />
              <ContactRelationshipsPanel
                organizationId={organizationId}
                contactId={rowIdBigInt(record)}
                companyId={rowCompanyId(record, operatingCompanyId)}
              />
            </div>
          ),
        },
        {
          id: "consent",
          label: t("crm.consent.tabLabel", "Consent"),
          content: (record) => (
            <ContactConsentPanel
              organizationId={organizationId}
              contactId={rowIdBigInt(record)}
            />
          ),
        },
        {
          id: "inbox",
          label: t("crm.inbox.tabLabel", "Inbox"),
          content: (record) => (
            <CrmInboxPanel
              organizationId={organizationId}
              contactId={rowIdBigInt(record)}
            />
          ),
        },
        {
          id: "payments-and-messages",
          label: "Payments & messages",
          content: (record) => (
            <ContactPaymentsAndMessagesPanel
              organizationId={organizationId}
              contactId={rowIdBigInt(record)}
            />
          ),
        },
        {
          id: "activity",
          label: t("crm.chatter.timeline"),
          content: (record) => (
            <CrmRecordChatter
              organizationId={organizationId}
              resModel="contact"
              resId={rowIdBigInt(record)}
              recordTitle={crmRowChatterLabel("contacts", record)}
            />
          ),
        },
      ],
    }),
    [t, organizationId, operatingCompanyId, renderRecordActions],
  )

  const moduleConfig = useMemo((): ModuleConfig => {
    const base = crmModuleConfig(t)

    const workflowTableAction = (kind: CrmRecordKind, action: CrmActionId): Pick<EntityAction, "permission" | "isApplicable" | "onClick"> => ({
      permission: { resource: kind, action: "write" },
      isApplicable: (rows) => rows.length === 1 && crmWorkflowActions(kind, rows[0]!, recordActionContext(kind))
        .some((item) => item.id === action && !item.reason),
      onClick: async (rows) => { if (rows[0]) await handleRecordAction(kind, action, rows[0]) },
    })

    const leadsCfg = leadsTableConfig(t)
    const oppCfg = opportunitiesTableConfig(t, { ownerLabelMap })
    const contactCfg = contactsTableConfig(t, {
      formatContactDisplayName: contactPrimaryLabel,
    })
    const actCfg = activitiesTableConfig(t)

    const leadsEntity: EntityViewConfig = {
      ...leadsCfg,
      view: attachEmptyStateAction(
        {
          ...leadsTableRuntime,
          actions: [
          {
            id: "csv-leads",
            label: t("crm.csvImport.toolbarLeads"),
            permission: { resource: "lead", action: "create" },
            onClick: () => setCsvKind("lead"),
          },
          {
            id: "edit-lead-details",
            label: t("crm.actions.editLeadDetails"),
            requiresSelection: true,
            onClick: openEditLeadDetailsModal,
          },
          {
            id: "edit-lead-address",
            label: t("crm.actions.editLeadAddress"),
            requiresSelection: true,
            onClick: openEditLeadAddressModal,
          },
          {
            id: "edit-lead-revenue",
            label: t("crm.actions.editLeadRevenue"),
            requiresSelection: true,
            onClick: openEditLeadRevenueModal,
          },
          {
            id: "qualify-lead",
            label: t("crm.workflow.actions.qualify"),
            permission: { resource: "lead", action: "write" },
            requiresSelection: true,
            isApplicable: (rows) => rows.length === 1 && crmLeadState(rows[0]!) === "new",
            onClick: async (rows) => { if (rows[0]) await handleRecordAction("lead", "qualify", rows[0]) },
          },
          {
            id: "convert-lead",
            label: t("crm.actions.convertToCustomer"),
            requiresSelection: true,
            ...workflowTableAction("lead", "convertLead"),
          },
          {
            id: "delete-lead",
            label: t("crm.actions.deleteLead"),
            requiresSelection: true,
            variant: "destructive",
            successMessage: t("common.actionCompleted", { action: t("crm.actions.deleteLead") }),
            confirm: {
              title: t("crm.actions.deleteLead"),
              description: t("crm.actions.deleteLeadConfirm"),
              confirmLabel: t("common.confirm"),
              cancelLabel: t("common.cancel"),
            },
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              await deleteLead.mutateAsync(rowIdBigInt(row))
            },
          },
        ],
        },
        () => setQuickActionForm({ form: newLeadForm(t), action: "createLead" }),
      ),
    }

    const oppEntity: EntityViewConfig =
      oppCfg.view.mode === "table-or-board"
        ? {
            ...oppCfg,
            view: attachEmptyStateAction(
              {
                ...oppCfg.view,
                table: {
                  ...opportunitiesTableRuntime,
                  actions: [
                    {
                      id: "csv-opportunities",
                      label: t("crm.csvImport.toolbarOpportunities"),
                      onClick: () => setCsvKind("opportunity"),
                    },
                    {
                      id: "edit-opportunity",
                      label: t("crm.actions.editOpportunity"),
                      requiresSelection: true,
                      onClick: openEditOpportunityModal,
                    },
                    {
                      id: "change-stage",
                      label: t("crm.actions.changeStage"),
                      requiresSelection: true,
                      ...workflowTableAction("opportunity", "changeStage"),
                    },
                    {
                      id: "mark-won",
                      label: t("crm.actions.markWon"),
                      requiresSelection: true,
                      ...workflowTableAction("opportunity", "won"),
                    },
                    {
                      id: "mark-lost",
                      label: t("crm.actions.markLost"),
                      requiresSelection: true,
                      variant: "destructive",
                      ...workflowTableAction("opportunity", "lost"),
                    },
                    {
                      id: "convert-opp-order",
                      label: t("crm.actions.convertToSaleOrder"),
                      requiresSelection: true,
                      ...workflowTableAction("opportunity", "createOrder"),
                    },
                  ],
                },
              },
              () =>
                setQuickActionForm({
                  form: newOpportunityForm(t, opportunityStageOptions),
                  action: "createOpportunity",
                }),
            ),
          }
        : {
            ...oppCfg,
            view: {
              ...opportunitiesTableRuntime,
              actions: [],
            },
          }

    const contactEntity: EntityViewConfig = {
      ...contactCfg,
      view: attachEmptyStateAction(
        {
          ...contactsTableRuntime,
          actions: [
          {
            id: "csv-contacts",
            label: t("crm.csvImport.toolbarContacts"),
            permission: { resource: "contact", action: "create" },
            onClick: () => setCsvKind("contact"),
          },
          {
            id: "edit-contact",
            label: t("crm.actions.editContact"),
            requiresSelection: true,
            onClick: openEditContactModal,
          },
          {
            id: "edit-contact-address",
            label: t("crm.actions.editContactAddress"),
            requiresSelection: true,
            onClick: openEditContactAddressModal,
          },
          {
            id: "edit-contact-business",
            label: t("crm.actions.editContactBusiness"),
            requiresSelection: true,
            onClick: openEditContactBusinessModal,
          },
          {
            id: "edit-contact-details",
            label: t("crm.actions.editContactDetails"),
            requiresSelection: true,
            onClick: openEditContactDetailsModal,
          },
          {
            id: "assign-tag",
            label: t("crm.actions.assignTag"),
            requiresSelection: true,
            onClick: openAssignTagModal,
          },
          {
            id: "assign-category",
            label: t("crm.actions.assignCategory"),
            requiresSelection: true,
            onClick: openAssignCategoryModal,
          },
          {
            id: "replace-contact-categories",
            label: t("crm.actions.replaceContactCategories", { defaultValue: "Replace categories" }),
            requiresSelection: true,
            isApplicable: (rows) => rows.every(canManageContactCategories),
            successMessage: t("common.actionCompleted", {
              action: t("crm.actions.replaceContactCategories", { defaultValue: "Replace categories" }),
            }),
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              const active = activeCategories(contactCategories as Record<string, unknown>[])
              if (active.length === 0) throw new Error(t("crm.contactCategories.emptyMessage"))
              const values = await askForm({
                title: t("crm.actions.replaceContactCategories", { defaultValue: "Replace categories" }),
                description: t("crm.actions.replaceContactCategoriesHint", {
                  defaultValue: "The contact keeps only the categories ticked here. Leave all unticked to clear them.",
                }),
                fields: active.map((c) => ({
                  id: `cat-${String(c.id)}`,
                  name: `cat-${String(c.id)}`,
                  label: String(c.name ?? `#${String(c.id)}`),
                  type: "checkbox" as const,
                })),
              })
              if (!values) return
              await replaceContactCategories.mutateAsync({
                contactId: rowIdBigInt(row).toString(),
                categoryIds: active.filter((c) => values[`cat-${String(c.id)}`] === true).map((c) => String(c.id)),
              })
            },
          },
          {
            id: "remove-contact-category",
            label: t("crm.actions.removeContactCategory", { defaultValue: "Remove category" }),
            requiresSelection: true,
            isApplicable: (rows) => rows.every(canManageContactCategories),
            successMessage: t("common.actionCompleted", {
              action: t("crm.actions.removeContactCategory", { defaultValue: "Remove category" }),
            }),
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              const values = await askForm({
                title: t("crm.actions.removeContactCategory", { defaultValue: "Remove category" }),
                fields: [
                  {
                    id: "categoryId",
                    name: "categoryId",
                    label: t("crm.forms.assignCategory.fields.categoryId", { defaultValue: "Category" }),
                    type: "select",
                    required: true,
                    searchable: true,
                    options: recordOptions(contactCategories as Record<string, unknown>[], (c) => String(c.name ?? `#${String(c.id)}`)),
                  },
                ],
              })
              const categoryId = values ? formText(values.categoryId) : undefined
              if (!categoryId) return
              await removeContactCategories.mutateAsync({
                contactId: rowIdBigInt(row).toString(),
                categoryIds: [categoryId],
              })
            },
          },
          {
            id: "clear-contact-categories",
            label: t("crm.actions.clearContactCategories", { defaultValue: "Clear categories" }),
            requiresSelection: true,
            variant: "destructive",
            isApplicable: (rows) => rows.every(canManageContactCategories),
            successMessage: t("common.actionCompleted", {
              action: t("crm.actions.clearContactCategories", { defaultValue: "Clear categories" }),
            }),
            confirm: {
              title: t("crm.actions.clearContactCategories", { defaultValue: "Clear categories" }),
              description: t("crm.actions.clearContactCategoriesConfirm", {
                defaultValue: "Remove every category from this contact?",
              }),
              confirmLabel: t("common.confirm"),
              cancelLabel: t("common.cancel"),
            },
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              await clearContactCategories.mutateAsync(rowIdBigInt(row).toString())
            },
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
            successMessage: t("common.actionCompleted", { action: t("crm.actions.deleteContact") }),
            confirm: {
              title: t("crm.actions.deleteContact"),
              description: t("crm.actions.deleteContactConfirm"),
              confirmLabel: t("common.confirm"),
              cancelLabel: t("common.cancel"),
            },
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              await deleteContact.mutateAsync(rowIdBigInt(row))
            },
          },
        ],
        },
        () => setQuickActionForm({ form: newContactForm(t), action: "createContact" }),
      ),
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
            isApplicable: (rows) =>
              rows.every((row) => !(row.isDone === true || String(row.state ?? "").toLowerCase() === "done")),
            successMessage: t("common.actionCompleted", { action: t("crm.actions.markComplete") }),
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              if (row.isDone === true || String(row.state ?? "").toLowerCase() === "done") {
                showWorkflowToast({ kind: "info", title: t("crm.actions.alreadyComplete") })
                return
              }
              await completeActivity.mutateAsync(rowIdBigInt(row))
            },
          },
        ],
      },
    }

    const contactCategoriesBase = contactCategoriesTableConfig(t)
    const contactCategoriesEntity: EntityViewConfig = {
      ...contactCategoriesBase,
      view: {
        ...(contactCategoriesBase.view as EntityTableConfig),
        actions: [
          {
            id: "edit-contact-category",
            label: t("crm.actions.editContactCategory", { defaultValue: "Edit category" }),
            requiresSelection: true,
            successMessage: t("common.actionCompleted", {
              action: t("crm.actions.editContactCategory", { defaultValue: "Edit category" }),
            }),
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              const values = await askForm({
                title: t("crm.actions.editContactCategory", { defaultValue: "Edit category" }),
                fields: [
                  {
                    id: "name",
                    name: "name",
                    label: t("crm.contactCategories.columns.name"),
                    type: "text",
                    required: true,
                    defaultValue: String(row.name ?? ""),
                  },
                  {
                    id: "color",
                    name: "color",
                    label: t("crm.contactCategories.columns.color"),
                    type: "text",
                    placeholder: "#3b82f6",
                    defaultValue: String(row.color ?? ""),
                  },
                ],
              })
              if (!values) return
              const name = formText(values.name)
              if (!name) throw new Error(t("crm.inlineEdit.nameRequired", { defaultValue: "A name is required" }))
              await updateContactCategory.mutateAsync({
                categoryId: rowIdBigInt(row).toString(),
                params: { name, color: formText(values.color) },
              })
            },
          },
          {
            id: "archive-contact-category",
            label: t("crm.actions.archiveContactCategory", { defaultValue: "Archive category" }),
            requiresSelection: true,
            variant: "destructive",
            isApplicable: (rows) => rows.every(canArchiveCategory),
            successMessage: t("common.actionCompleted", {
              action: t("crm.actions.archiveContactCategory", { defaultValue: "Archive category" }),
            }),
            confirm: {
              title: t("crm.actions.archiveContactCategory", { defaultValue: "Archive category" }),
              description: t("crm.actions.archiveContactCategoryConfirm", {
                defaultValue: "Archive this category? Contacts already assigned to it keep it.",
              }),
              confirmLabel: t("common.confirm"),
              cancelLabel: t("common.cancel"),
            },
            onClick: async (rows) => {
              const row = rows[0]
              if (!row) return
              await archiveContactCategory.mutateAsync(rowIdBigInt(row).toString())
            },
          },
        ],
      },
    }

    const coreTabs = base.tabs.map((tab) => {
      if (tab.id === "leads") {
        return { ...tab, entityConfig: leadsEntity, recordSheet: leadRecordSheet }
      }
      if (tab.id === "opportunities") {
        return {
          ...tab,
          entityConfig: oppEntity,
          recordSheet: opportunityRecordSheet,
          createForm: newOpportunityForm(t, opportunityStageOptions),
          createLabel: t("crm.opportunities.board.newOpportunity"),
        }
      }
      if (tab.id === "opportunity-lines" && tab.type === "entity" && tab.entityConfig) {
        return {
          ...tab,
          createForm: addOpportunityLineFormConfig,
          createLabel: t("crm.actions.newOpportunityLine"),
          createAction: "createOpportunityLine",
        }
      }
      if (tab.id === "contacts") {
        return {
          ...tab,
          entityConfig: withInlineEdits(contactEntity, {
            // update_contact takes each of these on its own; omitted fields stay as they are.
            name: {
              kind: "text",
              save: async (row, value) => {
                const name = requiredInlineText(
                  value,
                  t("crm.inlineEdit.nameRequired", { defaultValue: "A contact needs a name" }),
                )
                await updateContact.mutateAsync({ contactId: row.id as string | number, params: { name } })
              },
            },
            email: {
              kind: "text",
              save: async (row, value) => {
                const email = requiredInlineEmail(
                  value,
                  t("crm.inlineEdit.emailInvalid", { defaultValue: "Enter a valid email address" }),
                )
                await updateContact.mutateAsync({ contactId: row.id as string | number, params: { email } })
              },
            },
            phone: {
              kind: "text",
              save: async (row, value) => {
                const phone = requiredInlineText(
                  value,
                  t("crm.inlineEdit.phoneRequired", { defaultValue: "Enter a phone number" }),
                )
                await updateContact.mutateAsync({ contactId: row.id as string | number, params: { phone } })
              },
            },
          }),
          recordSheet: contactRecordSheet,
        }
      }
      if (tab.id === "activities") return { ...tab, entityConfig: activitiesEntity, createForm: activityForm, createPermission: { resource: "activity", action: "create" as const } }
      return tab
    })

    return {
      ...base,
      defaultTab: "my-activities",
      tabs: [
        ...coreTabs,
        {
          id: "contact-tags",
          label: t("crm.contactTags.tabLabel"),
          type: "entity" as const,
          entityConfig: contactTagsTableConfig(t),
          createForm: newContactTagForm(t),
          createLabel: t("crm.contactTags.createLabel"),
          createAction: "createContactTag",
        },
        {
          id: "contact-categories",
          label: t("crm.contactCategories.tabLabel"),
          type: "entity" as const,
          entityConfig: contactCategoriesEntity,
          createForm: newContactCategoryForm(t),
          createLabel: t("crm.contactCategories.createLabel"),
          createAction: "createContactCategory",
        },
        {
          id: "contact-segments",
          label: t("crm.contactSegments.tabLabel"),
          type: "entity" as const,
          entityConfig: contactSegmentsTableConfig(t),
          createForm: newContactSegmentForm(t),
          createLabel: t("crm.contactSegments.createLabel"),
          createAction: "createContactSegment",
        },
        {
          id: "attribution",
          label: t("crm.attribution.tabLabel"),
          type: "custom" as const,
          customContent: <CrmUtmSettings organizationId={organizationId} />,
        },
        {
          id: "my-activities",
          label: t("crm.myWork.title"),
          description: t("crm.myWork.description"),
          type: "custom" as const,
          customContent: <CrmMyWorkPanel organizationId={organizationId} companyId={operatingCompanyId}
            activities={activitiesRead} opportunities={{ rows: enrichedOpportunities, state: opportunitiesRead.state }}
            leads={leadsRead} contacts={contactsRead} canComplete={checkPermission("activity", "write").allowed}
            canCreateLead={checkPermission("lead", "create").allowed}
            onCreateLead={() => setQuickActionForm({ form: newLeadForm(t), action: "createLead" })}
            onOpenRecord={(kind, id) => setFocusedRecord({ kind, id })} />,
        },
        {
          id: "pipeline-admin",
          label: t("crm.admin.tabLabel", "Pipeline admin"),
          type: "custom" as const,
          customContent: (
            <div className="space-y-6">
              <CrmPipelineAdminPanel organizationId={organizationId} />
              <SegmentRulesPanel organizationId={organizationId} />
              <CrmCountryPackPanel
                organizationId={organizationId}
                companyId={operatingCompanyId}
              />
            </div>
          ),
        },
        {
          id: "duplicates",
          label: t("crm.duplicates.tabLabel"),
          type: "custom" as const,
          customContent: (
            <CrmDuplicateContacts
              organizationId={organizationId}
              companyId={operatingCompanyId}
              contacts={contacts as Record<string, unknown>[]}
            />
          ),
        },
      ],
    }
  }, [
    activitiesRead.state.status, opportunitiesRead.state.status, leadsRead.state.status, contactsRead.state.status,
    activities, enrichedOpportunities, leads, contacts, checkPermission, activityForm, handleRecordAction, recordActionContext,
    operatingCompanyId,
    contacts,
    t,
    organizationId,
    openConvertLeadModal,
    openConvertOppModal,
    openAssignTagModal,
    openAddSegmentModal,
    openEditOpportunityModal,
    openChangeStageModal,
    openEditContactModal,
    openEditContactAddressModal,
    openEditContactBusinessModal,
    openEditContactDetailsModal,
    openEditLeadDetailsModal,
    openEditLeadAddressModal,
    openEditLeadRevenueModal,
    askForm,
    contactCategories,
    updateContactCategory,
    archiveContactCategory,
    replaceContactCategories,
    removeContactCategories,
    clearContactCategories,
    markOpportunityWon,
    markOpportunityLost,
    opportunityStageOptions,
    addOpportunityLineFormConfig,
    leadsTableRuntime,
    contactsTableRuntime,
    opportunitiesTableRuntime,
    leadRecordSheet,
    opportunityRecordSheet,
    contactRecordSheet,
    updateContact,
  ])

  const crmTabIds = useMemo(() => moduleConfig.tabs.map((tab) => tab.id), [moduleConfig])
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? "dashboard",
    crmTabIds,
  )
  const urlFilters = useModuleFilters()

  const navigateToLeadsByState = useCallback(
    (category: string) => {
      router.push(
        buildModuleTabHref("crm", "leads", { state: leadStateFilterFromCategory(category) }),
      )
    },
    [router],
  )

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const { startMs, endMs } = timeRangeToMs(dashboardTimeRange)
    const previousRange = previousPeriodMs(dashboardTimeRange)

    const inCurrentRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), startMs, endMs)
    const inPreviousRange = (row: Record<string, unknown>) =>
      previousRange != null && isTimestampInRange(recordTimestampMs(row), previousRange.startMs, previousRange.endMs)

    const isActiveLead = (row: Record<string, unknown>) => {
      const s = leadStateRaw(row)
      return s !== "lost" && s !== "won" && s !== "converted"
    }

    const currentActiveLeads = leads.filter((l) =>
      isActiveLead(l as Record<string, unknown>) && inCurrentRange(l as Record<string, unknown>),
    ).length
    const previousActiveLeads = leads.filter((l) =>
      isActiveLead(l as Record<string, unknown>) && inPreviousRange(l as Record<string, unknown>),
    ).length

    const currentOpenOpportunities = opportunities.filter(
      (o) => !oppIsClosed(o as Record<string, unknown>) && inCurrentRange(o as Record<string, unknown>),
    )
    const previousOpenOpportunities = opportunities.filter(
      (o) => !oppIsClosed(o as Record<string, unknown>) && inPreviousRange(o as Record<string, unknown>),
    )

    const currentPipelineValue = currentOpenOpportunities.reduce(
      (s, o) => s + Number(o.expectedRevenue ?? 0),
      0,
    )
    const previousPipelineValue = previousOpenOpportunities.reduce(
      (s, o) => s + Number(o.expectedRevenue ?? 0),
      0,
    )
    const currentWeightedPipeline = currentOpenOpportunities.reduce((s, o) => {
      const revenue = Number(o.expectedRevenue ?? 0)
      const probability = Number(o.probability ?? 0)
      return s + revenue * (probability / 100)
    }, 0)
    const latestSnapshot = (forecastSnapshots as Record<string, unknown>[])[0]
    const latestSnapshotWeighted = latestSnapshot
      ? Number(latestSnapshot.weightedPipeline ?? latestSnapshot.weighted_pipeline ?? 0)
      : null

    const wonWithCampaign = opportunities.filter((o) => {
      const row = o as Record<string, unknown>
      return (
        (row.isWon === true || row.is_won === true) &&
        inCurrentRange(row) &&
        (row.campaignId ?? row.campaign_id) != null
      )
    })
    const attributionByCampaign = Object.entries(
      groupBy(wonWithCampaign, (o) =>
        String((o as Record<string, unknown>).campaignId ?? (o as Record<string, unknown>).campaign_id ?? "—"),
      ),
    )
      .map(([campaignId, items]) => ({
        label: `Campaign ${campaignId}`,
        value: items.reduce(
          (sum, item) =>
            sum + Number((item as Record<string, unknown>).expectedRevenue ?? (item as Record<string, unknown>).expected_revenue ?? 0),
          0,
        ),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4)

    const openOpportunities = currentOpenOpportunities
    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                {
                  label: t("crm.dashboard.activeLeads"),
                  value: String(currentActiveLeads),
                  change: previousRange ? percentChange(currentActiveLeads, previousActiveLeads) : undefined,
                  icon: "Users",
                },
                {
                  label: t("crm.dashboard.pipelineValue"),
                  value: `$${currentPipelineValue.toLocaleString()}`,
                  change: previousRange ? percentChange(currentPipelineValue, previousPipelineValue) : undefined,
                  icon: "TrendingUp",
                },
                {
                  label: t("crm.dashboard.weightedPipeline", "Weighted pipeline"),
                  value: `$${Math.round(currentWeightedPipeline).toLocaleString()}`,
                  icon: "Target",
                },
                {
                  label: t("crm.dashboard.forecastSnapshot", "Last forecast"),
                  value:
                    latestSnapshotWeighted == null
                      ? "—"
                      : `$${Math.round(latestSnapshotWeighted).toLocaleString()}`,
                  icon: "BookUser",
                },
                {
                  label: t("crm.dashboard.openOpportunities"),
                  value: String(openOpportunities.length),
                  change: previousRange ? percentChange(currentOpenOpportunities.length, previousOpenOpportunities.length) : undefined,
                  icon: "Users",
                },
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
            create_forecast_snapshot: () => {
              if (!operatingCompanyId || operatingCompanyId === 0n) return
              const now = Date.now()
              const snapshotStart = insightPeriodRange?.startMs ?? startMs
              const snapshotEnd = insightPeriodRange?.endMs ?? endMs
              if (!Number.isFinite(snapshotStart) || !Number.isFinite(snapshotEnd)) {
                showWorkflowToast({ kind: "error", title: t("common.error.title"), description: t("moduleInsights.forecastFinitePeriod", { defaultValue: "Choose a custom date range or a calendar preset before creating a forecast snapshot." }) })
                return
              }
              const endMsSafe = snapshotEnd > snapshotStart ? snapshotEnd : now
              createForecastSnapshot
                .mutateAsync({
                  companyId: operatingCompanyId,
                  params: {
                    periodStart: stbTimestampFromDate(new Date(snapshotStart)),
                    periodEnd: stbTimestampFromDate(new Date(endMsSafe)),
                    ownerId: undefined,
                    metadata: undefined,
                  } satisfies CreateCrmForecastSnapshotParams,
                })
                .catch((error: unknown) => {
                  showWorkflowToast({
                    kind: "error",
                    title: t("common.error.title"),
                    description: error instanceof Error ? error.message : String(error),
                  })
                })
            },
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
          const stageGroups = groupBy(leads, (l) => leadStageLabel(l as Record<string, unknown>))
          const stageValues = Object.entries(stageGroups)
            .map(([stage, items]) => ({ stage, Count: items.length }))
            .sort((a, b) => b.Count - a.Count)
          return {
            ...w,
            data: {
              ...(w.data as Record<string, unknown>),
              values: stageValues,
              onCategoryClick: navigateToLeadsByState,
            },
          }
        }
        if (w.id === "crm-opportunity-funnel") {
          const funnelColors = ["#6366f1", "#8b5cf6", "#a78bfa", "#22c55e", "#f59e0b", "#ef4444"]
          const orderedStages = [...opportunityStages]
            .filter((s) => {
              const row = s as Record<string, unknown>
              return row.isActive !== false && row.is_active !== false
            })
            .sort(
              (a, b) =>
                Number((a as Record<string, unknown>).sequence ?? 0) -
                Number((b as Record<string, unknown>).sequence ?? 0),
            )
          const oppByStageId = groupBy(openOpportunities, (o) =>
            String((o as Record<string, unknown>).stageId ?? (o as Record<string, unknown>).stage_id ?? ""),
          )
          const stages = orderedStages.map((s, index) => {
            const row = s as Record<string, unknown>
            const stageId = String(row.id ?? "")
            return {
              name: String(row.name ?? "—"),
              value: (oppByStageId[stageId] ?? []).length,
              color: funnelColors[index % funnelColors.length],
            }
          })
          return {
            ...w,
            title: t("crm.dashboard.opportunityFunnel"),
            data: { stages },
          }
        }
        if (w.id === "crm-pipeline-health") {
          const stageGroups = groupBy(openOpportunities, (o) =>
            String((o as Record<string, unknown>).stageId ?? "0"),
          )
          const stages = Object.entries(stageGroups)
            .map(([stageId, items]) => ({
              label: stageById.get(stageId) ?? "—",
              count: items.length,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 4)
          const attributionMetrics = attributionByCampaign.map((row, i) => ({
            label: row.label,
            value: Math.round(row.value),
            max: Math.max(attributionByCampaign[0]?.value ?? 1, 1),
            color: ["#0ea5e9", "#0284c7", "#0369a1", "#075985"][i] ?? "#0ea5e9",
          }))
          const colors = ["#6366f1", "#8b5cf6", "#a78bfa", "#22c55e"]
          const maxCount = stages[0]?.count ?? 1
          const metrics = [
            ...stages.map((s, i) => ({
              label: s.label,
              value: s.count,
              max: maxCount,
              color: colors[i] ?? "#6366f1",
            })),
            ...attributionMetrics,
          ]
          return {
            ...w,
            title: t("crm.dashboard.pipelineHealthAttribution", "Pipeline & attribution"),
            data: { metrics },
          }
        }
        if (w.id === "crm-recent-contacts") {
          const recentRows = contacts.slice(0, 4).map((c) => {
            const row = c as Record<string, unknown>
            const primary = contactPrimaryLabel(row).trim()
            const companyRow =
              c.companyId != null
                ? contacts.find((other) => String(other.id) === String(c.companyId))
                : undefined
            return {
              name: primary || String(c.name ?? ""),
              company: companyRow
                ? contactPrimaryLabel(companyRow as Record<string, unknown>).trim() || "—"
                : "—",
              stage: "—",
              value: "—",
              lastContact: "—",
            }
          })
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows: recentRows } }
        }
        return w
          })
  }, [leads, opportunities, contacts, moduleConfig, opportunityStageOptions, stageById, dashboardTimeRange, insightPeriodRange, t, navigateToLeadsByState, opportunityStages, forecastSnapshots, createForecastSnapshot, operatingCompanyId])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: withDashboardSections(moduleConfig, liveSections).tabs,
      }) as ModuleConfig,
    [moduleConfig, liveSections],
  )

  const data = useMemo(
    () => ({
      leads: leads.map((row) => crmLeadListRow(row, contactNamesForLists)) as unknown as Record<string, unknown>[],
      opportunities: enrichedOpportunities,
      "opportunity-lines": opportunityLines as unknown as Record<string, unknown>[],
      contacts: contacts.map((row) => crmContactListRow(row, contactNamesForLists)) as unknown as Record<string, unknown>[],
      activities: activities as unknown as Record<string, unknown>[],
      "contact-tags": contactTags as unknown as Record<string, unknown>[],
      "contact-categories": contactCategories as unknown as Record<string, unknown>[],
      "contact-segments": contactSegments as unknown as Record<string, unknown>[],
    }),
    [leads, enrichedOpportunities, opportunityLines, contacts, contactNamesForLists, activities, contactTags, contactCategories, contactSegments],
  )

  const currenciesQuery = useCurrencies()
  const { data: kpiCurrencies = [] } = currenciesQuery
  const { locale } = useCurrencyFormat()
  const kpiStrips = useMemo<Record<string, { tiles: KpiTileDef[]; loading?: boolean }>>(
    () => ({
      opportunities: {
        tiles: opportunityKpis(enrichedOpportunities, {
          t,
          now: new Date(),
          locale,
          currencyCodeById: currencyCodeMap(kpiCurrencies as Record<string, unknown>[]),
        }),
        loading: opportunitiesLoading,
      },
    }),
    [enrichedOpportunities, kpiCurrencies, opportunitiesLoading, t, locale],
  )

  const dataState = {
    dashboard: mergeModuleStates([leadsRead.state, opportunitiesRead.state, contactsRead.state, activitiesRead.state]),
    leads: leadsRead.state,
    opportunities: opportunitiesRead.state,
    "opportunity-lines": opportunityLinesRead.state,
    contacts: contactsRead.state,
    activities: activitiesRead.state,
    "contact-tags": contactTagsRead.state,
    "contact-categories": contactCategoriesRead.state,
    "contact-segments": contactSegmentsRead.state,
  }
  type CrmTab = keyof typeof dataState
  const tabUsable = (tab: CrmTab | undefined) => tab == null || canUseModuleData(dataState[tab])
  const actionTabs: Record<string, CrmTab> = {
    createLead: "leads", createOpportunity: "opportunities", createContact: "contacts",
    createActivity: "activities", createContactCategory: "contact-categories",
    createContactTag: "contact-tags", createContactSegment: "contact-segments",
    createOpportunityLine: "opportunity-lines",
  }
  const csvTabs: Record<CrmCsvImportKind, CrmTab> = { contact: "contacts", lead: "leads", opportunity: "opportunities" }
  const quickActionUsable = quickActionForm == null || (tabUsable(actionTabs[quickActionForm.action]) && (quickActionForm.action !== "createActivity" || (moduleQueryState(activityTypesQuery).status === "ready" && activityTypeOptions.length > 0)))
  const quickActionDenied = quickActionForm != null && dataState[actionTabs[quickActionForm.action]]?.status === "denied"
  const workflowTab: CrmTab | undefined = workflowModal == null ? undefined : workflowModal.kind === "scheduleActivity"
    ? workflowModal.targetKind === "lead" ? "leads" : workflowModal.targetKind === "opportunity" ? "opportunities" : "contacts"
    : "leadId" in workflowModal ? "leads" : "opportunityId" in workflowModal ? "opportunities" : "contacts"
  const workflowSourceState = workflowTab ? dataState[workflowTab] : undefined
  const workflowContext = recordActionContext(workflowModal?.kind === "scheduleActivity" ? workflowModal.targetKind : workflowTab === "leads" ? "lead" : workflowTab === "opportunities" ? "opportunity" : "contact")
  const workflowUnavailableReason = workflowSourceState?.status !== "ready" ? "sourceUnavailable"
    : (workflowModal?.kind === "scheduleActivity" ? !workflowContext.canCreateActivity : !workflowContext.canWrite) ? "permissionRequired"
    : workflowModal?.kind === "scheduleActivity" && !workflowContext.activityTypesReady ? "activityTypeRequired"
    : (workflowModal?.kind === "convertLead" || workflowModal?.kind === "changeStage") && !workflowContext.stagesReady ? "stagesRequired"
    : workflowModal?.kind === "convertOpp" && !workflowContext.orderSetupReady ? "orderSetupRequired"
    : workflowModal?.kind === "markOppLost" && !workflowContext.lostReasonsReady ? "lostReasonRequired" : undefined
  const workflowUsable = workflowModal == null || workflowUnavailableReason == null

  const workflowDenied = workflowSourceState?.status === "denied" || (workflowModal?.kind === "scheduleActivity" &&
    (activitiesRead.state.status === "denied" || moduleQueryState(activityTypesQuery).status === "denied"))

  const csvSourceState = csvKind == null ? undefined : dataState[csvTabs[csvKind]]
  // Prompted category dialogs act on selected contacts and their categories.
  const promptsUsable = tabUsable("contacts") && tabUsable("contact-categories")
  useEffect(() => {
    // Creation drafts stay mounted on a source error; denied access closes them.
    if (quickActionDenied) setQuickActionForm(null)
    if (workflowDenied) setWorkflowModal(null)
    if (!promptsUsable) cancelForm()
  }, [quickActionDenied, workflowDenied, promptsUsable, cancelForm])

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!tabUsable(actionTabs[action])) throw new Error(t("crm.forms.sourceUnavailable", { defaultValue: "Required records could not be verified. Retry the source list before saving. Your entries are retained." }))
    if (action === "createLead") {
      const p = toCreateLeadParams(formData)
      if (!p) throw new Error(t("crm.forms.validation.createLead", { defaultValue: "Enter the lead contact name before saving." }))
      if (p) {
        const savedId = await createLead.mutateAsync(p)
        router.push(buildModuleTabHref("crm", "leads", { id: savedId }))
        phCapture("lead_created", { organization_id: organizationId })
      }
    } else if (action === "createOpportunity") {
      if (moduleQueryState(opportunityStagesQuery).status !== "ready") throw new Error(t("crm.forms.pipelineSourceUnavailable", { defaultValue: "Pipeline stages could not be verified. Retry Pipeline setup before saving. Your entries are retained." }))
      const p = toCreateOpportunityParams(formData)
      if (!p) throw new Error(t("crm.forms.validation.createOpportunity", { defaultValue: "Enter an opportunity name and select a pipeline stage." }))
      if (p) {
        const savedId = await createOpportunity.mutateAsync(p)
        router.push(buildModuleTabHref("crm", "opportunities", { id: savedId }))
      }
    } else if (action === "createContact") {
      const p = toCreateContactParams(formData)
      if (!p) throw new Error(t("crm.forms.validation.createContact", { defaultValue: "Enter a contact name before saving." }))
      if (p) {
        const savedId = await createContact.mutateAsync(p)
        router.push(buildModuleTabHref("crm", "contacts", { id: savedId }))
      }
    } else if (action === "createActivity") {
      if (moduleQueryState(activityTypesQuery).status !== "ready" || activityTypeOptions.length === 0) throw new Error(t("crm.workflow.reasons.activityTypeRequired"))
      const p = toCreateActivityParams(formData)
      if (!p) throw new Error(t("crm.forms.validation.createActivity", { defaultValue: "Enter an activity summary and a valid due date." }))
      if (p) await createActivity.mutateAsync(p)
    } else if (action === "createContactCategory") {
      const p = toCreateContactCategoryParamsFromForm(formData)
      if (!p) throw new Error(t("crm.forms.validation.createContactCategory", { defaultValue: "Enter a category name before saving." }))
      if (p) await createContactCategory.mutateAsync(p)
    } else if (action === "createContactTag") {
      const p = toCreateContactTagParamsFromForm(formData)
      if (!p) throw new Error(t("crm.forms.validation.createContactTag", { defaultValue: "Enter a tag name before saving." }))
      if (p) await createContactTag.mutateAsync(p)
    } else if (action === "createContactSegment") {
      const p = toCreateContactSegmentParamsFromForm(formData)
      if (!p) throw new Error(t("crm.forms.validation.createContactSegment", { defaultValue: "Enter a segment name before saving." }))
      if (p) await createContactSegment.mutateAsync(p)
    } else if (action === "createOpportunityLine") {
      const opportunityId = formData.opportunityId
      const params = toCreateOpportunityLineParams(formData)
      if (
        opportunityId == null ||
        String(opportunityId).trim() === "" ||
        params == null
      ) {
        throw new Error(t("crm.forms.addOpportunityLine.validation.requiredFields"))
      }
      await createOpportunityLine.mutateAsync({
        opportunityId: String(opportunityId),
        params,
        companyId: operatingCompanyId ?? undefined,
      })
    } else {
      throw new Error(t("crm.forms.unsupportedAction", { defaultValue: "This form action is unavailable. Close and reopen the form before trying again." }))
    }
    const feedback = action === "createLead" ? "leadCreated" : action === "createOpportunity" ? "opportunityCreated" : action === "createContact" ? "contactCreated" : action === "createActivity" ? "scheduled" : "created"
    const resultTab = ["createLead", "createOpportunity", "createContact", "createActivity"].includes(action) ? actionTabs[action] : undefined
    showWorkflowToast({ kind: "success", title: t(`crm.workflow.feedback.${feedback}`),
      ...(resultTab ? { action: {
        label: t(action === "createLead" ? "crm.workflow.viewLeads" : action === "createOpportunity" ? "crm.workflow.openOpportunities" : action === "createContact" ? "crm.workflow.openContacts" : "crm.workflow.viewActivities"),
        onClick: () => router.push(buildModuleTabHref("crm", resultTab, undefined, "my-activities")),
      } } : {}),
    })
  }



  const handleWorkflowSubmit = async (formData: Record<string, unknown>) => {
    if (!workflowModal) return
    if (!workflowUsable) throw new Error("Required data is unavailable. Refresh and try again.")
    setWorkflowSubmitError(null)
    try {
      if (workflowModal.kind === "scheduleActivity") {
        const p = toCreateActivityParams({ ...formData, resModel: workflowModal.targetKind, resId: workflowModal.targetId.toString() })
        if (!p) throw new Error(t("crm.forms.validation.createActivity"))
        await createActivity.mutateAsync(p)
        phCapture("crm_follow_up_scheduled", { organization_id: organizationId, record_kind: workflowModal.targetKind })
      } else if (workflowModal.kind === "convertLead") {
        if (!formData.createContact && !formData.createOpportunity) throw new Error(t("crm.workflow.chooseConversionResult"))
        const p = toConvertLeadParams({
          ...formData,
          companyId:
            formData.companyId ??
            (operatingCompanyId && operatingCompanyId !== 0n
              ? operatingCompanyId
              : undefined),
        })
        if (!p) throw new Error(t("crm.forms.convertLead.validation.stageRequired"))
        await convertLead.mutateAsync({ leadId: workflowModal.leadId, params: p })
      } else if (workflowModal.kind === "convertOpp") {
        const p = toConvertOpportunityParams(formData)
        if (!p) throw new Error(t("crm.forms.convertToSaleOrder.validation.pricelistWarehouse"))
        await convertOppToOrder.mutateAsync({
          opportunityId: workflowModal.opportunityId,
          params: p,
          companyId: workflowModal.companyId,
        })
        phCapture("opportunity_converted_to_order", { organization_id: organizationId })
      } else if (workflowModal.kind === "assignTag") {
        const tagId = formData.tagId
        if (tagId == null || String(tagId).trim() === "") {
          throw new Error(t("crm.forms.assignTag.validation.tagId"))
        }
        await assignTag.mutateAsync({
          contactId: workflowModal.contactId,
          tagId: String(tagId),
        })
      } else if (workflowModal.kind === "assignCategory") {
        const categoryId = formData.categoryId
        if (categoryId == null || String(categoryId).trim() === "") {
          throw new Error(t("crm.forms.assignCategory.validation.categoryId"))
        }
        await addContactCategories.mutateAsync({
          contactId: workflowModal.contactId,
          categoryIds: [String(categoryId)],
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
      } else if (workflowModal.kind === "changeStage") {
        const p = toUpdateOpportunityStageParams(formData)
        if (!p) throw new Error(t("crm.forms.changeStage.validation.stageRequired"))
        await updateOpportunity.mutateAsync({
          opportunityId: workflowModal.opportunityId,
          companyId: workflowModal.companyId,
          params: p,
        })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "opportunity",
            recordId: workflowModal.opportunityId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "markOppLost") {
        const lostReasonId = formData.lostReasonId
        if (lostReasonId == null || String(lostReasonId).trim() === "") {
          throw new Error(t("crm.forms.markLost.validation.reasonRequired"))
        }
        // CRM-RI-011: `lost_reason_id` is now Option<Option<u64>> on the
        // reducer (three-state: omit=unchanged, Some(None)=clear,
        // Some(Some(v))=set). `stdbParamsToJson`'s `encodeValue` recognizes
        // already-encoded `{ some: X }` / `{ none: [] }` shapes and passes
        // them through as-is, recursing into X WITHOUT re-checking the
        // fieldKey/optionFields auto-wrap (see `isSatsOption` in
        // stdb-params-json.ts) — so a bare bigint here only ever produces a
        // single `{ some: N }` (indistinguishable from the old Option<u64>
        // wire shape), regardless of whether it's pre-wrapped once. Only
        // supplying TWO literal levels of `{ some: ... } }` in source
        // produces the required nested `{ some: { some: N } }` SATS JSON for
        // Some(Some(N)) once run through `encodeValue`. Verified by tracing
        // `encodeValue`/`isSatsOption` in stdb-params-json.ts directly.
        const params: Record<string, unknown> = {
          desiredState: { tag: "Lost" },
          lostReasonId: { some: { some: BigInt(String(lostReasonId)) } },
        }
        if (lostStageId != null) params.stageId = lostStageId
        await updateOpportunity.mutateAsync({
          opportunityId: workflowModal.opportunityId,
          companyId: workflowModal.companyId,
          params,
        })
      } else if (workflowModal.kind === "editOpportunity") {
        const p = toUpdateOpportunityParams(formData)
        if (!p) throw new Error(t("crm.forms.editOpportunity.validation.noChanges"))
        await updateOpportunity.mutateAsync({
          opportunityId: workflowModal.opportunityId,
          companyId: workflowModal.companyId,
          params: p,
        })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "opportunity",
            recordId: workflowModal.opportunityId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editContact") {
        const p = toUpdateContactParams(formData)
        if (!p) throw new Error(t("crm.forms.editContact.validation.noChanges"))
        await updateContact.mutateAsync({ contactId: workflowModal.contactId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "contact",
            recordId: workflowModal.contactId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editContactAddress") {
        const p = toUpdateContactAddressParams(formData)
        if (!p) throw new Error(t("crm.forms.editContactAddress.validation.noChanges"))
        await updateContactAddress.mutateAsync({ contactId: workflowModal.contactId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "contact",
            recordId: workflowModal.contactId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editContactBusiness") {
        const p = toUpdateContactBusinessParams(formData)
        if (!p) throw new Error(t("crm.forms.editContactBusiness.validation.noChanges"))
        await updateContactBusiness.mutateAsync({ contactId: workflowModal.contactId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "contact",
            recordId: workflowModal.contactId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editContactDetails") {
        const p = toUpdateContactDetailsParams(formData)
        if (!p) throw new Error(t("crm.forms.editContactDetails.validation.noChanges"))
        await updateContactDetails.mutateAsync({ contactId: workflowModal.contactId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "contact",
            recordId: workflowModal.contactId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editLeadDetails") {
        const p = toUpdateLeadDetailsParams(formData)
        if (!p) throw new Error(t("crm.forms.editLeadDetails.validation.noChanges"))
        await updateLead.mutateAsync({ leadId: workflowModal.leadId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "lead",
            recordId: workflowModal.leadId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editLeadAddress") {
        const p = toUpdateLeadAddressParams(formData)
        if (!p) throw new Error(t("crm.forms.editLeadAddress.validation.noChanges"))
        await updateLead.mutateAsync({ leadId: workflowModal.leadId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "lead",
            recordId: workflowModal.leadId,
            metadata: formData.metadata,
          })
        }
      } else if (workflowModal.kind === "editLeadRevenue") {
        const p = toUpdateLeadRevenueParams(formData)
        if (!p) throw new Error(t("crm.forms.editLeadRevenue.validation.noChanges"))
        await updateLead.mutateAsync({ leadId: workflowModal.leadId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "lead",
            recordId: workflowModal.leadId,
            metadata: formData.metadata,
          })
        }
      }
      if (workflowModal.kind !== "convertOpp") showWorkflowToast({
        kind: "success",
        title: t(workflowModal.kind === "scheduleActivity" ? "crm.workflow.feedback.scheduled"
          : workflowModal.kind === "convertLead" ? "crm.workflow.feedback.converted"
          : workflowModal.kind === "changeStage" ? "crm.workflow.feedback.stageChanged"
          : workflowModal.kind === "markOppLost" ? "crm.workflow.feedback.lost" : "crm.workflow.feedback.saved"),
        ...(workflowModal.kind === "convertLead" ? {
          action: { label: t(formData.createOpportunity ? "crm.workflow.openOpportunities" : "crm.workflow.openContacts"),
            onClick: () => router.push(formData.createOpportunity ? "/crm?tab=opportunities" : "/crm?tab=contacts") },
        } : {}),
      })
      setWorkflowModal(null)
    } catch (e) {
      setWorkflowSubmitError(e instanceof Error ? e.message : "Action failed")
      throw e
    }
  }

  const workflowStaticConfig = useMemo((): FormConfig => {
    if (!workflowModal) return closedWorkflowFormConfig
    if (workflowModal.kind === "convertLead") return buildConvertLeadForm()
    if (workflowModal.kind === "convertOpp") return buildConvertOppForm()
    if (workflowModal.kind === "scheduleActivity") return activityForm
    if (workflowModal.kind === "changeStage") return mergeSelectOptionsByFieldName(workflowModal.form, "stageId", opportunityStageOptions)
    if (workflowModal.kind === "markOppLost") return mergeSelectOptionsByFieldName(workflowModal.form, "lostReasonId", lostReasonSelectOptions)
    return workflowModal.form
  }, [workflowModal, buildConvertLeadForm, buildConvertOppForm, activityForm, opportunityStageOptions, lostReasonSelectOptions])

  // Drafts of record edits are kept per record so one lead's notes never reopen on another.
  const workflowDraftKey =
    workflowModal == null
      ? undefined
      : workflowModal.kind === "scheduleActivity"
        ? `follow-up-${workflowModal.targetKind}-${workflowModal.targetId}`
      : "leadId" in workflowModal
        ? `lead-${workflowModal.leadId.toString()}`
        : "opportunityId" in workflowModal
          ? `opportunity-${workflowModal.opportunityId.toString()}`
          : `contact-${workflowModal.contactId.toString()}`

  // Source retries update options without remounting the form or losing the user's entries.
  const workflowModalKey = workflowModal == null ? "closed" : `${workflowModal.kind}-${workflowDraftKey}`

  const focusedSource = focusedRecord?.kind === "lead" ? leadsRead : focusedRecord?.kind === "opportunity"
    ? { rows: enrichedOpportunities, state: opportunitiesRead.state } : contactsRead
  const focusedLiveRecord = focusedRecord && focusedSource.state.status === "ready"
    ? focusedSource.rows.find((row) => String(row.id) === focusedRecord.id) ?? null : null

  const dataLoading = useMemo(
    () => ({
      leads: leadsLoading,
      opportunities: opportunitiesLoading,
      contacts: contactsLoading,
    }),
    [leadsLoading, opportunitiesLoading, contactsLoading],
  )

  return (
    <EntityLabelsProvider value={entityLabels}>
      <RecordCreationRecovery organizationId={orgId} companyId={operatingCompanyId} refreshKey={isFormMutationPending} models={[
        { model: 'crm_lead', canRead: permissionsReady === true && checkPermission('lead', 'read').allowed && leadsRead.state.status === 'ready' },
        { model: 'opportunity', canRead: permissionsReady === true && checkPermission('opportunity', 'read').allowed && opportunitiesRead.state.status === 'ready' },
        { model: 'contact', canRead: permissionsReady === true && checkPermission('contact', 'read').allowed && contactsRead.state.status === 'ready' },
      ]} />
      {focusedRecord && <EntityRecordSheet open={focusedLiveRecord != null} onOpenChange={(open) => !open && setFocusedRecord(null)}
        record={focusedLiveRecord} config={focusedRecord.kind === "lead" ? leadRecordSheet : focusedRecord.kind === "opportunity" ? opportunityRecordSheet : contactRecordSheet} />}
      <ModuleView
        config={config}
        dashboardContent={<CompanyModuleInsights input={{ module: "crm", organizationId, companyId: operatingCompanyId, records: { rows: opportunities, state: opportunitiesRead.state }, currencies: { rows: kpiCurrencies, state: moduleQueryState(currenciesQuery) } }} sections={liveSections} onPeriodRangeChange={setInsightPeriodRange} />}
        data={data}
        dataLoading={dataLoading}
        dataState={dataState}
        kpiStrips={kpiStrips}
        entityBoardContext={entityBoardContext}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
        showSubmitSuccessToast={false}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        dashboardTimeRange={dashboardTimeRange}
        onDashboardTimeRangeChange={setDashboardTimeRange}
        urlFilters={urlFilters}
        runtimeForms={{
          organizationId,
          roleId: runtimeRoleId,
        }}
      />
      <RuntimeFormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        staticConfig={quickActionForm?.action === "createOpportunity" ? newOpportunityForm(t, opportunityStageOptions) : quickActionForm?.action === "createActivity" ? activityForm : quickActionForm?.form ?? newLeadForm(t)}
        submissionDisabled={!quickActionUsable || (quickActionForm?.action === "createOpportunity" && moduleQueryState(opportunityStagesQuery).status !== "ready")}
        formLeadingActions={!quickActionUsable || quickActionForm?.action === "createOpportunity" ? <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => {
            const tab = quickActionForm ? actionTabs[quickActionForm.action] : undefined
            const state = tab ? dataState[tab] : undefined
            if (state && "onRetry" in state) state.onRetry?.()
            if (quickActionForm?.action === "createOpportunity") void opportunityStagesQuery.refetch()
            if (quickActionForm?.action === "createActivity") void activityTypesQuery.refetch()
          }}>{t("common.retry", { defaultValue: "Retry" })}</Button>
          {quickActionForm?.action === "createOpportunity" ? <a className="text-sm text-primary underline" href="/crm?tab=pipeline-admin">{t("crm.forms.openPipelineSetup", { defaultValue: "Open Pipeline setup" })}</a> : null}
        </div> : undefined}
        submitError={!quickActionUsable ? t("crm.forms.sourceUnavailable", { defaultValue: "Required records could not be verified. Retry the source list before saving. Your entries are retained." }) : quickActionForm?.action === "createOpportunity" && moduleQueryState(opportunityStagesQuery).status !== "ready" ? t("crm.forms.pipelineSourceUnavailable", { defaultValue: "Pipeline stages could not be verified. Retry Pipeline setup before saving. Your entries are retained." }) : null}
        moduleId="crm"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        preferStdbVisibility
        isPending={isFormMutationPending}
        showSubmitSuccessToast={false}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {promptsUsable && formDialog}
      <RuntimeFormModal
        key={workflowModalKey}
        open={workflowModal !== null}
        submissionDisabled={!workflowUsable}
        formLeadingActions={!workflowUsable ? <Button type="button" variant="outline" onClick={() => {
          if (workflowSourceState && "onRetry" in workflowSourceState) workflowSourceState.onRetry?.()
          if (workflowModal?.kind === "scheduleActivity") {
            if ("onRetry" in activitiesRead.state) activitiesRead.state.onRetry?.()
            void activityTypesQuery.refetch()
          }
          if (workflowModal?.kind === "convertLead" || workflowModal?.kind === "changeStage") void opportunityStagesQuery.refetch()
          if (workflowModal?.kind === "markOppLost") void lostReasonsQuery.refetch()
          if (workflowModal?.kind === "convertOpp") {
            void pricelistsQuery.refetch()
            void warehousesQuery.refetch()
            void opportunityStagesQuery.refetch()
          }
        }}>{t("common.retry")}</Button> : undefined}
        onOpenChange={(open) => {
          if (!open) {
            setWorkflowModal(null)
            setWorkflowSubmitError(null)
          }
        }}
        staticConfig={workflowStaticConfig}
        moduleId="crm"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        preferStdbVisibility
        isPending={isFormMutationPending}
        showSubmitSuccessToast={false}
        submitError={!workflowUsable ? t(`crm.workflow.reasons.${workflowUnavailableReason}`) : workflowSubmitError}
        draftKey={workflowDraftKey}
        onSubmit={(formData) => {
          return handleWorkflowSubmit(formData)
        }}
      />
      {csvKind ? (
        <ImportAssistantWizard
          sourceState={csvSourceState}
          key={csvKind}
          open
          organizationId={organizationId}
          onOpenChange={(open) => !open && setCsvKind(null)}
          targetEntity={csvKind}
          title={csvImportTitle}
          isImportPending={
            csvImports.importContact.isPending ||
            csvImports.importLead.isPending ||
            csvImports.importOpportunity.isPending
          }
          onImport={async (csvData) => {
            if (csvKind === "contact") await csvImports.importContact.mutateAsync(csvData)
            else if (csvKind === "lead") await csvImports.importLead.mutateAsync(csvData)
            else await csvImports.importOpportunity.mutateAsync(csvData)
          }}
        />
      ) : null}
    </EntityLabelsProvider>
  )
}
