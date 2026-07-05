"use client"

import { phCapture } from "@/lib/posthog-browser"
import {
  customFieldEntriesFromMetadata,
  findNewestRowByField,
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
} from "@/lib/form-lookup"
import {
  timestampToDateInputValue,
  toCreateContactSegmentParamsFromForm,
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
import { useRuntimeListConfig } from "@lumiere/ui/forms"
import { contactPrimaryLabel } from "@lumiere/stdb/read-models"
import {
  useActivities,
  useAddContactToSegment,
  useAssignTagToContact,
  useCompleteActivity,
  useContacts,
  useContactSegments,
  useContactTags,
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
  useOpportunities,
  useOpportunityLines,
  useOpportunityStages,
  useUpdateContact,
  useUpdateContactAddress,
  useUpdateContactBusiness,
  useUpdateContactDetails,
  useUpdateLeadAddress,
  useUpdateLeadDetails,
  useUpdateLeadRevenue,
  useUpdateOpportunity,
  useCrmCsvImportMutations,
} from "@lumiere/query-hooks/hooks/crm"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useProducts, useUoms, useWarehouses } from "@lumiere/query-hooks/hooks/inventory"
import type { EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  DEFAULT_KANBAN_COLUMN_COLORS,
  CrmRecordChatterDialog,
  CrmUtmSettings,
  ModuleView,
  MissingOrganization,
  RuntimeFormModal,
  useRBAC,
  activitiesTableConfig,
  addContactToSegmentForm,
  addOpportunityLineForm,
  assignTagToContactForm,
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
  mergeFieldDefaultValues,
  newContactSegmentForm,
  newContactTagForm,
  mergeSelectOptionsByFieldName,
  mergeSelectOptionsForFields,
  newActivityForm,
  newContactForm,
  newLeadForm,
  newOpportunityForm,
  contactsTableConfig,
  leadsTableConfig,
  opportunitiesTableConfig,
  ImportAssistantWizard,
} from "@lumiere/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"

export { CRM_UI_REDUCERS } from "@/lib/crm-ui-reducers"

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
  | { kind: "changeStage"; form: FormConfig; opportunityId: bigint; companyId: bigint }
  | { kind: "editOpportunity"; form: FormConfig; opportunityId: bigint; companyId: bigint }
  | { kind: "editContact"; form: FormConfig; contactId: bigint }
  | { kind: "editContactAddress"; form: FormConfig; contactId: bigint }
  | { kind: "editContactBusiness"; form: FormConfig; contactId: bigint }
  | { kind: "editContactDetails"; form: FormConfig; contactId: bigint }
  | { kind: "editLeadDetails"; form: FormConfig; leadId: bigint }
  | { kind: "editLeadAddress"; form: FormConfig; leadId: bigint }
  | { kind: "editLeadRevenue"; form: FormConfig; leadId: bigint }
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
    const label = contactPrimaryLabel(row).trim()
    return label || `Contact #${id}`
  }
  return id ? `Record #${id}` : "Record"
}

function leadStateRaw(row: Record<string, unknown>): string {
  return String(row.state ?? row.State ?? "").toLowerCase()
}

function oppIsClosed(row: Record<string, unknown>): boolean {
  return row.isWon === true || row.is_won === true || row.isLost === true || row.is_lost === true
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
  const { t } = useTranslation()
  const { currentUser } = useRBAC()
  const runtimeRoleId = currentUser?.roles[0]
  const { orgId } = orgBigInts(organizationId)

  const leadsTableRuntime = useRuntimeListConfig({
    base: leadsTableConfig(t).view as EntityTableConfig,
    moduleId: "crm",
    formId: "new-lead",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:crm:leads:${organizationId}`,
  })
  const contactsTableRuntime = useRuntimeListConfig({
    base: contactsTableConfig(t, { formatContactDisplayName: contactPrimaryLabel }).view as EntityTableConfig,
    moduleId: "crm",
    formId: "new-contact",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:crm:contacts:${organizationId}`,
  })
  const opportunitiesTableRuntime = useRuntimeListConfig({
    base: opportunitiesTableConfig(t).view as EntityTableConfig,
    moduleId: "crm",
    formId: "new-opportunity",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:crm:opportunities:${organizationId}`,
  })
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n

  async function persistCrmCustomFields(args: {
    model: "lead" | "contact" | "opportunity"
    recordId: bigint
    metadata: unknown
  }) {
    if (!operatingCompanyId || operatingCompanyId === 0n) return
    if (customFieldEntriesFromMetadata(args.metadata).length === 0) return
    await persistCustomFieldsToEav({
      organizationId,
      companyId: operatingCompanyId,
      model: args.model,
      recordId: args.recordId,
      metadata: args.metadata,
    })
  }

  async function persistCrmCustomFieldsAfterCreate(args: {
    model: "lead" | "contact" | "opportunity"
    metadata: unknown
    queryPath: string
    matchField: string
    matchValue: string
  }) {
    if (customFieldEntriesFromMetadata(args.metadata).length === 0) return
    const rows = await fetchQueryList(args.queryPath, "Failed to fetch records")
    const row = findNewestRowByField(rows, args.matchField, args.matchValue)
    if (!row?.id) return
    await persistCrmCustomFields({
      model: args.model,
      recordId: BigInt(String(row.id)),
      metadata: args.metadata,
    })
  }
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [workflowModal, setWorkflowModal] = useState<WorkflowModal>(null)
  const [csvKind, setCsvKind] = useState<CrmCsvImportKind | null>(null)
  const [chatterTarget, setChatterTarget] = useState<{
    resModel: string
    resId: bigint
    recordTitle: string
  } | null>(null)

  const { data: leads = [] } = useLeads(orgId, initialLeads)
  const { data: opportunities = [] } = useOpportunities(orgId, initialOpportunities)
  const { data: opportunityLines = [] } = useOpportunityLines(orgId)
  const { data: contacts = [] } = useContacts(orgId, initialContacts)
  const { data: contactTags = [] } = useContactTags(orgId)
  const { data: contactSegments = [] } = useContactSegments(orgId)
  const { data: activities = [] } = useActivities(orgId)
  const { data: opportunityStages = [] } = useOpportunityStages(orgId)
  const { data: pricelists = [] } = usePricelists(orgId)
  const { data: warehouses = [] } = useWarehouses(orgId)
  const { data: products = [] } = useProducts(orgId)
  const { data: uoms = [] } = useUoms(orgId)

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

  const wonStageId = useMemo(() => {
    const stage = opportunityStages.find(
      (s) => (s as Record<string, unknown>).isWon === true,
    ) as Record<string, unknown> | undefined
    if (!stage?.id) return null
    return BigInt(String(stage.id))
  }, [opportunityStages])

  const lostStageId = useMemo(() => {
    const stage = opportunityStages.find(
      (s) => String((s as Record<string, unknown>).name ?? "") === "Lost",
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
          ...row,
          stageName: stageById.get(stageId) ?? "—",
        }
      }),
    [opportunities, stageById],
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
      }),
    [t, openOpportunityOptions, productFieldOptions, uomFieldOptions],
  )

  const createLead = useCreateLead(orgId)
  const createOpportunity = useCreateOpportunity(orgId, { companyId: operatingCompanyId ?? undefined })
  const createOpportunityLine = useCreateOpportunityLine(orgId)
  const updateOpportunity = useUpdateOpportunity(orgId, { companyId: operatingCompanyId ?? undefined })
  const createContact = useCreateContact(orgId, { companyId: operatingCompanyId ?? undefined })
  const createActivity = useCreateActivity(orgId)
  const convertLead = useConvertLeadToCustomer(orgId)
  const convertOppToOrder = useConvertOpportunityToSaleOrder(orgId)
  const deleteContact = useDeleteContact(orgId)
  const deleteLead = useDeleteLead(orgId)
  const assignTag = useAssignTagToContact(orgId)
  const addToSegment = useAddContactToSegment(orgId)
  const completeActivity = useCompleteActivity(orgId)
  const createContactTag = useCreateContactTag(orgId)
  const createContactSegment = useCreateContactSegment(orgId)
  const updateContact = useUpdateContact(orgId)
  const updateContactAddress = useUpdateContactAddress(orgId)
  const updateContactBusiness = useUpdateContactBusiness(orgId)
  const updateContactDetails = useUpdateContactDetails(orgId)
  const updateLeadDetails = useUpdateLeadDetails(orgId)
  const updateLeadAddress = useUpdateLeadAddress(orgId)
  const updateLeadRevenue = useUpdateLeadRevenue(orgId)
  const csvImports = useCrmCsvImportMutations(orgId)

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

  useEffect(() => {
    setWorkflowModal((prev) => {
      if (!prev) return prev
      if (prev.kind === "convertLead" && opportunityStageOptions.length > 0) {
        return { ...prev, form: buildConvertLeadForm() }
      }
      if (
        prev.kind === "convertOpp" &&
        pricelistSelectOptions.length > 0 &&
        warehouseSelectOptions.length > 0
      ) {
        return { ...prev, form: buildConvertOppForm() }
      }
      return prev
    })
  }, [
    buildConvertLeadForm,
    buildConvertOppForm,
    opportunityStageOptions.length,
    pricelistSelectOptions.length,
    warehouseSelectOptions.length,
  ])

  const openConvertLeadModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (leadStateRaw(row) !== "qualified") {
        window.alert(t("crm.actions.convertLeadQualifiedOnly"))
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
        window.alert(t("crm.actions.convertOppNeedsPartner"))
        return
      }
      const opportunityId = rowIdBigInt(row)
      setWorkflowModal({ kind: "convertOpp", opportunityId, form: buildConvertOppForm() })
    },
    [t, buildConvertOppForm],
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

  const openChangeStageModal = useCallback(
    (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (oppIsClosed(row)) {
        window.alert(t("crm.actions.alreadyClosed"))
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
        window.alert(t("crm.actions.alreadyClosed"))
        return
      }
      const params: Record<string, unknown> = { isWon: true }
      if (wonStageId != null) params.stageId = wonStageId
      try {
        await updateOpportunity.mutateAsync({
          opportunityId: rowIdBigInt(row),
          companyId: rowCompanyId(row, operatingCompanyId),
          params,
        })
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Action failed")
      }
    },
    [t, wonStageId, updateOpportunity, operatingCompanyId],
  )

  const markOpportunityLost = useCallback(
    async (rows: Record<string, unknown>[]) => {
      const row = rows[0]
      if (!row) return
      if (oppIsClosed(row)) {
        window.alert(t("crm.actions.alreadyClosed"))
        return
      }
      const params: Record<string, unknown> = { isLost: true }
      if (lostStageId != null) params.stageId = lostStageId
      try {
        await updateOpportunity.mutateAsync({
          opportunityId: rowIdBigInt(row),
          companyId: rowCompanyId(row, operatingCompanyId),
          params,
        })
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Action failed")
      }
    },
    [t, lostStageId, updateOpportunity, operatingCompanyId],
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
      try {
        await updateOpportunity.mutateAsync({
          opportunityId,
          companyId,
          params: { stageId },
        })
      } catch (e) {
        window.alert(
          e instanceof Error ? e.message : t("crm.opportunities.board.moveFailed"),
        )
      }
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

  const moduleConfig = useMemo((): ModuleConfig => {
    const base = crmModuleConfig(t)

    const leadsCfg = leadsTableConfig(t)
    const oppCfg = opportunitiesTableConfig(t)
    const contactCfg = contactsTableConfig(t, {
      formatContactDisplayName: contactPrimaryLabel,
    })
    const actCfg = activitiesTableConfig(t)

    const leadsEntity: EntityViewConfig = {
      ...leadsCfg,
      view: {
        ...leadsTableRuntime,
        actions: [
          {
            id: "csv-leads",
            label: t("crm.csvImport.toolbarLeads"),
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
            id: "convert-lead",
            label: t("crm.actions.convertToCustomer"),
            requiresSelection: true,
            onClick: openConvertLeadModal,
          },
          {
            id: "delete-lead",
            label: t("crm.actions.deleteLead"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              const row = rows[0]
              if (!row) return
              if (!window.confirm(t("crm.actions.deleteLeadConfirm"))) return
              deleteLead.mutate(rowIdBigInt(row))
            },
          },
        ],
      },
    }

    const oppEntity: EntityViewConfig =
      oppCfg.view.mode === "table-or-board"
        ? {
            ...oppCfg,
            view: {
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
                    onClick: openChangeStageModal,
                  },
                  {
                    id: "mark-won",
                    label: t("crm.actions.markWon"),
                    requiresSelection: true,
                    onClick: (rows) => {
                      void markOpportunityWon(rows)
                    },
                  },
                  {
                    id: "mark-lost",
                    label: t("crm.actions.markLost"),
                    requiresSelection: true,
                    variant: "destructive",
                    onClick: (rows) => {
                      void markOpportunityLost(rows)
                    },
                  },
                  {
                    id: "convert-opp-order",
                    label: t("crm.actions.convertToSaleOrder"),
                    requiresSelection: true,
                    onClick: openConvertOppModal,
                  },
                ],
              },
            },
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
      view: {
        ...contactsTableRuntime,
        actions: [
          {
            id: "csv-contacts",
            label: t("crm.csvImport.toolbarContacts"),
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
      if (tab.id === "opportunities") {
        return {
          ...tab,
          entityConfig: oppEntity,
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
      if (tab.id === "contacts") return { ...tab, entityConfig: contactEntity }
      if (tab.id === "activities") return { ...tab, entityConfig: activitiesEntity }
      return tab
    })

    return {
      ...base,
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
      ],
    }
  }, [
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
    markOpportunityWon,
    markOpportunityLost,
    opportunityStageOptions,
    addOpportunityLineFormConfig,
    leadsTableRuntime,
    contactsTableRuntime,
    opportunitiesTableRuntime,
  ])

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const activeLeads = leads.filter((l) => {
      const s = leadStateRaw(l as Record<string, unknown>)
      return s !== "lost" && s !== "won" && s !== "converted"
    }).length
    const openOpportunities = opportunities.filter(
      (o) => !oppIsClosed(o as Record<string, unknown>),
    )
    const pipelineValue = openOpportunities.reduce(
      (s, o) => s + Number(o.expectedRevenue ?? 0),
      0,
    )
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
                { label: t("crm.dashboard.openOpportunities"), value: String(openOpportunities.length), icon: "Target" },
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
      }),
    }))
  }, [leads, opportunities, contacts, moduleConfig, opportunityStageOptions, stageById, t])

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
      opportunities: enrichedOpportunities,
      "opportunity-lines": opportunityLines as unknown as Record<string, unknown>[],
      contacts: contacts as unknown as Record<string, unknown>[],
      activities: activities as unknown as Record<string, unknown>[],
      "contact-tags": contactTags as unknown as Record<string, unknown>[],
      "contact-segments": contactSegments as unknown as Record<string, unknown>[],
    }),
    [leads, enrichedOpportunities, opportunityLines, contacts, activities, contactTags, contactSegments],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createLead") {
      const p = toCreateLeadParams(formData)
      if (p) {
        await createLead.mutateAsync(p)
        phCapture("lead_created", { organization_id: organizationId })
        if (p.metadata && p.name) {
          await persistCrmCustomFieldsAfterCreate({
            model: "lead",
            metadata: p.metadata,
            queryPath: "/api/query/leads",
            matchField: "name",
            matchValue: p.name,
          })
        }
      }
    } else if (action === "createOpportunity") {
      const p = toCreateOpportunityParams(formData)
      if (p) {
        await createOpportunity.mutateAsync(p)
        if (p.metadata && p.name) {
          await persistCrmCustomFieldsAfterCreate({
            model: "opportunity",
            metadata: p.metadata,
            queryPath: "/api/query/opportunities",
            matchField: "name",
            matchValue: p.name,
          })
        }
      }
    } else if (action === "createContact") {
      const p = toCreateContactParams(formData)
      if (p) {
        await createContact.mutateAsync(p)
        if (p.metadata && p.name) {
          await persistCrmCustomFieldsAfterCreate({
            model: "contact",
            metadata: p.metadata,
            queryPath: "/api/query/contacts",
            matchField: "name",
            matchValue: p.name,
          })
        }
      }
    } else if (action === "createActivity") {
      const p = toCreateActivityParams(formData)
      if (p) await createActivity.mutateAsync(p)
    } else if (action === "createContactTag") {
      const p = toCreateContactTagParamsFromForm(formData)
      if (p) await createContactTag.mutateAsync(p)
    } else if (action === "createContactSegment") {
      const p = toCreateContactSegmentParamsFromForm(formData)
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
      })
    }
  }

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
    addToSegment.isPending ||
    createContactTag.isPending ||
    createContactSegment.isPending ||
    updateContact.isPending ||
    updateContactAddress.isPending ||
    updateContactBusiness.isPending ||
    updateContactDetails.isPending ||
    updateLeadDetails.isPending ||
    updateLeadAddress.isPending ||
    updateLeadRevenue.isPending ||
    csvImports.importContact.isPending ||
    csvImports.importLead.isPending ||
    csvImports.importOpportunity.isPending

  const handleWorkflowSubmit = async (formData: Record<string, unknown>) => {
    if (!workflowModal) return
    try {
      if (workflowModal.kind === "convertLead") {
        const p = toConvertLeadParams(formData)
        if (!p) throw new Error(t("crm.forms.convertLead.validation.stageRequired"))
        await convertLead.mutateAsync({ leadId: workflowModal.leadId, params: p })
      } else if (workflowModal.kind === "convertOpp") {
        const p = toConvertOpportunityParams(formData)
        if (!p) throw new Error(t("crm.forms.convertToSaleOrder.validation.pricelistWarehouse"))
        await convertOppToOrder.mutateAsync({
          opportunityId: workflowModal.opportunityId,
          params: p,
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
        await updateLeadDetails.mutateAsync({ leadId: workflowModal.leadId, params: p })
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
        await updateLeadAddress.mutateAsync({ leadId: workflowModal.leadId, params: p })
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
        await updateLeadRevenue.mutateAsync({ leadId: workflowModal.leadId, params: p })
        if (formData.metadata) {
          await persistCrmCustomFields({
            model: "lead",
            recordId: workflowModal.leadId,
            metadata: formData.metadata,
          })
        }
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
            : workflowModal.kind === "changeStage"
              ? `cs-${workflowModal.opportunityId.toString()}`
              : workflowModal.kind === "editOpportunity"
                ? `eo-${workflowModal.opportunityId.toString()}`
                : workflowModal.kind === "editContact"
                  ? `ec-${workflowModal.contactId.toString()}`
                  : workflowModal.kind === "editContactAddress"
                    ? `eca-${workflowModal.contactId.toString()}`
                    : workflowModal.kind === "editContactBusiness"
                      ? `ecb-${workflowModal.contactId.toString()}`
                      : workflowModal.kind === "editContactDetails"
                        ? `ecd-${workflowModal.contactId.toString()}`
                        : workflowModal.kind === "editLeadDetails"
                          ? `eld-${workflowModal.leadId.toString()}`
                          : workflowModal.kind === "editLeadAddress"
                            ? `ela-${workflowModal.leadId.toString()}`
                            : workflowModal.kind === "editLeadRevenue"
                              ? `elr-${workflowModal.leadId.toString()}`
                : `as-${workflowModal.contactId.toString()}`

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        entityBoardContext={entityBoardContext}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
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
      <RuntimeFormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        staticConfig={quickActionForm?.form ?? newLeadForm(t)}
        moduleId="crm"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <RuntimeFormModal
        key={workflowModalKey}
        open={workflowModal !== null}
        onOpenChange={(open) => !open && setWorkflowModal(null)}
        staticConfig={workflowModal?.form ?? closedWorkflowFormConfig}
        moduleId="crm"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        isPending={isFormMutationPending}
        onSubmit={(formData) => {
          return handleWorkflowSubmit(formData)
        }}
      />
      {csvKind ? (
        <ImportAssistantWizard
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
    </>
  )
}
