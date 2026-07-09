import type { TFunction } from "i18next"
import { createElement } from "react"
import type { EntityDetailConfig, EntityViewConfig } from "./entity-view-types"
import { formatTimestampLike, getRowField } from "./entity-row-utils"
import { resolveIdentityLabel } from "./identity-label"

export interface CrmEntityConfigOptions {
  ownerLabelMap?: ReadonlyMap<string, string>
  formatContactDisplayName?: (row: Record<string, unknown>) => string
}

function daysInStageLabel(row: Record<string, unknown>): string {
  const raw =
    getRowField(row, "dateLastStageUpdate") ??
    getRowField(row, "updatedAt")
  const date = formatTimestampLike(raw)
  if (!date) return "—"
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  return days === 1 ? "1d" : `${days}d`
}

const leadEmptyState = (t: TFunction) => ({
  title: t("crm.leads.emptyMessage"),
  description: t("crm.leads.description"),
  actionLabel: t("crm.forms.newLead.title"),
})

const opportunityEmptyState = (t: TFunction) => ({
  title: t("crm.opportunities.emptyMessage"),
  description: t("crm.opportunities.description"),
  actionLabel: t("crm.forms.newOpportunity.title"),
})

const contactEmptyState = (t: TFunction) => ({
  title: t("crm.contacts.emptyMessage"),
  description: t("crm.contacts.description"),
  actionLabel: t("crm.forms.newContact.title"),
})

// ── Badge maps ────────────────────────────────────────────────────────────────
const leadStateBadges = (t: TFunction) => ({
  badgeVariants: {
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
  badgeLabels: {
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
}) as const

const opportunityPriorityBadges = (t: TFunction) => ({
  badgeVariants: { Low: "secondary", Medium: "outline", High: "default" },
  badgeLabels: {
    Low: t("crm.opportunities.states.Low"),
    Medium: t("crm.opportunities.states.Medium"),
    High: t("crm.opportunities.states.High"),
  },
}) as const

// ── Leads ─────────────────────────────────────────────────────────────────────
export const leadsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "leads-table",
  title: t("crm.leads.title"),
  description: t("crm.leads.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.leads.searchPlaceholder"),
    searchKeys: ["contactName", "contact_name", "emailFrom", "email_from", "email", "partnerName", "partner_name", "name"],
    filters: [
      {
        key: "state",
        label: t("crm.leads.filters.state.label"),
        type: "select",
        options: [
          { value: "new", label: t("crm.leads.filters.state.options.New") },
          { value: "qualified", label: t("crm.leads.filters.state.options.Qualified") },
          { value: "won", label: t("crm.leads.filters.state.options.Won") },
          { value: "lost", label: t("crm.leads.filters.state.options.Lost") },
          { value: "converted", label: t("crm.leads.filters.state.options.Converted") },
        ],
      },
    ],
    columns: [
      {
        key: "contactName",
        label: t("crm.leads.columns.contactName"),
        width: "min-w-36",
        sortable: true,
      },
      { key: "partnerName", label: t("crm.leads.columns.partnerName"), width: "min-w-36" },
      { key: "emailFrom", label: t("crm.leads.columns.emailFrom"), width: "min-w-40" },
      { key: "phone", label: t("crm.leads.columns.phone"), width: "min-w-28" },
      { key: "state", label: t("crm.leads.columns.state"), type: "badge", ...leadStateBadges(t) },
      {
        key: "expectedRevenue",
        label: t("crm.leads.columns.expectedRevenue"),
        type: "currency",
        align: "right",
        sortable: true,
      },
      {
        key: "createDate",
        label: t("crm.leads.columns.createDate"),
        type: "relative-date",
        sortable: true,
      },
    ],
    emptyMessage: t("crm.leads.emptyMessage"),
    emptyState: leadEmptyState(t),
  },
})

export const leadDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "contact",
      title: t("crm.forms.newLead.sections.contact"),
      fields: [
        { key: "contactName", label: t("crm.leads.columns.contactName"), width: "1/2" },
        { key: "partnerName", label: t("crm.leads.columns.partnerName"), width: "1/2" },
        { key: "emailFrom", label: t("crm.leads.columns.emailFrom"), width: "1/2" },
        { key: "phone", label: t("crm.leads.columns.phone"), width: "1/2" },
      ],
    },
    {
      id: "details",
      title: t("crm.forms.newLead.sections.details"),
      fields: [
        {
          key: "state",
          label: t("crm.leads.columns.state"),
          type: "badge",
          ...leadStateBadges(t),
          width: "1/2",
        },
        {
          key: "expectedRevenue",
          label: t("crm.leads.columns.expectedRevenue"),
          type: "currency",
          width: "1/2",
        },
        {
          key: "probability",
          label: t("crm.forms.newLead.fields.probability"),
          type: "progress",
          width: "1/2",
        },
        {
          key: "createDate",
          label: t("crm.leads.columns.createDate"),
          type: "relative-date",
          width: "1/2",
        },
        { key: "description", label: t("crm.forms.newLead.fields.description"), width: "full" },
      ],
    },
  ],
})

// ── Opportunities ─────────────────────────────────────────────────────────────
export const opportunitiesTableConfig = (
  t: TFunction,
  options?: CrmEntityConfigOptions,
): EntityViewConfig => ({
  id: "opportunities-table",
  entityType: "opportunity",
  title: t("crm.opportunities.title"),
  description: t("crm.opportunities.description"),
  view: {
    mode: "table-or-board",
    table: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("crm.opportunities.searchPlaceholder"),
      searchKeys: ["name"],
      columns: [
        {
          key: "name",
          label: t("crm.opportunities.columns.name"),
          width: "min-w-48",
          sortable: true,
        },
        {
          key: "stageName",
          label: t("crm.opportunities.columns.stageName"),
          type: "status",
          width: "min-w-28",
        },
        {
          key: "priority",
          label: t("crm.opportunities.columns.priority"),
          type: "badge",
          ...opportunityPriorityBadges(t),
        },
        {
          key: "expectedRevenue",
          label: t("crm.opportunities.columns.expectedRevenue"),
          type: "currency",
          align: "right",
          sortable: true,
        },
        {
          key: "probability",
          label: t("crm.opportunities.columns.probability"),
          type: "progress",
          align: "right",
        },
        {
          key: "dateDeadline",
          label: t("crm.opportunities.columns.dateDeadline"),
          type: "relative-date",
          sortable: true,
        },
      ],
      emptyMessage: t("crm.opportunities.emptyMessage"),
      emptyState: opportunityEmptyState(t),
    },
    board: {
      groupKey: "stageId",
      rowKey: "id",
      emptyColumnMessage: t("crm.opportunities.board.emptyColumn"),
      card: {
        titleKey: "name",
        fields: [
          { key: "expectedRevenue", label: t("crm.opportunities.columns.expectedRevenue"), type: "currency" },
          { key: "probability", label: t("crm.opportunities.columns.probability"), type: "percent" },
        ],
        footerFields: [
          {
            key: "expectedRevenue",
            label: t("crm.opportunities.columns.expectedRevenue"),
            type: "currency",
          },
          {
            key: "userId",
            label: t("crm.activities.columns.userId"),
            render: (_value, row) =>
              createElement(
                "span",
                { className: "text-xs text-muted-foreground truncate max-w-[5rem]" },
                resolveIdentityLabel(
                  getRowField(row, "userId") ?? getRowField(row, "createdBy"),
                  options?.ownerLabelMap,
                ),
              ),
          },
          {
            key: "daysInStage",
            label: t("crm.opportunities.columns.stageName"),
            render: (_value, row) =>
              createElement(
                "span",
                { className: "text-xs text-muted-foreground tabular-nums" },
                daysInStageLabel(row),
              ),
          },
        ],
      },
    },
    viewToggleLabels: {
      table: t("crm.opportunities.board.viewTable"),
      board: t("crm.opportunities.board.viewKanban"),
      ariaLabel: t("crm.opportunities.board.viewToggleLabel"),
    },
    defaultView: "table",
  },
})

export const opportunityDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "opportunity",
      title: t("crm.forms.newOpportunity.sections.opportunity"),
      fields: [
        { key: "name", label: t("crm.opportunities.columns.name"), width: "full" },
        {
          key: "stageName",
          label: t("crm.opportunities.columns.stageName"),
          type: "status",
          width: "1/2",
        },
        {
          key: "priority",
          label: t("crm.opportunities.columns.priority"),
          type: "badge",
          ...opportunityPriorityBadges(t),
          width: "1/2",
        },
        {
          key: "expectedRevenue",
          label: t("crm.opportunities.columns.expectedRevenue"),
          type: "currency",
          width: "1/2",
        },
        {
          key: "probability",
          label: t("crm.opportunities.columns.probability"),
          type: "progress",
          width: "1/2",
        },
        {
          key: "dateDeadline",
          label: t("crm.opportunities.columns.dateDeadline"),
          type: "relative-date",
          width: "1/2",
        },
        {
          key: "description",
          label: t("crm.forms.editOpportunity.fields.description"),
          width: "full",
        },
      ],
    },
  ],
})

// ── Contacts ──────────────────────────────────────────────────────────────────
export type ContactsTableConfigOptions = {
  /** Preferred display for the name column (e.g. partner > company > contact). */
  formatContactDisplayName?: (row: Record<string, unknown>) => string
}

export const contactsTableConfig = (
  t: TFunction,
  options?: ContactsTableConfigOptions,
): EntityViewConfig => {
  const formatName = options?.formatContactDisplayName

  const nameColumn = {
    key: "name",
    label: t("crm.contacts.columns.name"),
    width: "min-w-40",
    sortable: true,
    ...(formatName
      ? {
          render: (_value: unknown, row: Record<string, unknown>) => {
            const formatted = formatName(row).trim()
            const fallback = String(row.name ?? "").trim()
            const shown = formatted || fallback
            if (!shown)
              return createElement(
                "span",
                { className: "text-muted-foreground" },
                "—",
              )
            return shown
          },
        }
      : {}),
  }

  return {
    id: "contacts-table",
    entityType: "contact",
    title: t("crm.contacts.title"),
    description: t("crm.contacts.description"),
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("crm.contacts.searchPlaceholder"),
      searchKeys: [
        "name",
        "partnerName",
        "partner_name",
        "companyName",
        "company_name",
        "contactName",
        "contact_name",
        "email",
        "phone",
      ],
      columns: [
        nameColumn,
        {
          key: "companyName",
          label: t("crm.contacts.columns.companyName"),
          width: "min-w-36",
        },
        {
          key: "email",
          label: t("crm.contacts.columns.email"),
          width: "min-w-44",
          sortable: true,
        },
        {
          key: "phone",
          label: t("crm.contacts.columns.phone"),
          width: "min-w-28",
        },
        {
          key: "isCompany",
          label: t("crm.contacts.columns.isCompany"),
          type: "boolean",
        },
        { key: "city", label: t("crm.contacts.columns.city"), width: "min-w-24" },
        {
          key: "countryId",
          label: t("crm.contacts.columns.countryId"),
          width: "min-w-20",
        },
      ],
      emptyMessage: t("crm.contacts.emptyMessage"),
      emptyState: contactEmptyState(t),
    },
  }
}

export const contactDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "identity",
      title: t("crm.forms.newContact.sections.identity"),
      fields: [
        { key: "name", label: t("crm.contacts.columns.name"), width: "1/2" },
        { key: "companyName", label: t("crm.contacts.columns.companyName"), width: "1/2" },
        { key: "email", label: t("crm.contacts.columns.email"), width: "1/2" },
        { key: "phone", label: t("crm.contacts.columns.phone"), width: "1/2" },
        { key: "isCompany", label: t("crm.contacts.columns.isCompany"), type: "boolean", width: "1/2" },
        { key: "city", label: t("crm.contacts.columns.city"), width: "1/2" },
        { key: "countryId", label: t("crm.contacts.columns.countryId"), width: "1/2" },
      ],
    },
    {
      id: "details",
      title: t("crm.forms.editContactDetails.sections.details"),
      fields: [
        { key: "firstName", label: t("crm.forms.editContactDetails.fields.firstName"), width: "1/2" },
        { key: "lastName", label: t("crm.forms.editContactDetails.fields.lastName"), width: "1/2" },
        { key: "title", label: t("crm.forms.editContactDetails.fields.title"), width: "1/2" },
        { key: "website", label: t("crm.forms.editContactDetails.fields.website"), width: "1/2" },
        {
          key: "description",
          label: t("crm.forms.editContactDetails.fields.description"),
          width: "full",
        },
      ],
    },
  ],
})

// ── Activities ────────────────────────────────────────────────────────────────
export const activitiesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "activities-table",
  title: t("crm.activities.title"),
  description: t("crm.activities.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.activities.searchPlaceholder"),
    searchKeys: ["summary", "note"],
    filters: [
      {
        key: "state",
        label: t("crm.activities.filters.state.label"),
        type: "select",
        options: [
          { value: "planned", label: t("crm.activities.filters.state.options.planned") },
          { value: "done", label: t("crm.activities.filters.state.options.done") },
        ],
      },
    ],
    columns: [
      { key: "summary", label: t("crm.activities.columns.summary"), width: "min-w-48" },
      { key: "activityType", label: t("crm.activities.columns.activityType"), width: "min-w-28" },
      { key: "state", label: t("crm.activities.columns.state"), type: "badge", badgeVariants: { planned: "outline", done: "default" }, badgeLabels: { planned: t("crm.activities.states.planned"), done: t("crm.activities.states.done") } },
      { key: "dateDeadline", label: t("crm.activities.columns.dateDeadline"), type: "date" },
      { key: "isDone", label: t("crm.activities.columns.isDone"), type: "boolean" },
    ],
    emptyMessage: t("crm.activities.emptyMessage"),
  },
})

// ── Contact tags & segments ───────────────────────────────────────────────────
export const contactTagsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "contact-tags-table",
  title: t("crm.contactTags.title"),
  description: t("crm.contactTags.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.contactTags.searchPlaceholder"),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("crm.contactTags.columns.name"), width: "min-w-36" },
      { key: "color", label: t("crm.contactTags.columns.color"), width: "min-w-24" },
      { key: "description", label: t("crm.contactTags.columns.description"), width: "min-w-48" },
    ],
    emptyMessage: t("crm.contactTags.emptyMessage"),
  },
})

export const contactSegmentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "contact-segments-table",
  title: t("crm.contactSegments.title"),
  description: t("crm.contactSegments.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.contactSegments.searchPlaceholder"),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("crm.contactSegments.columns.name"), width: "min-w-36" },
      { key: "isDynamic", label: t("crm.contactSegments.columns.isDynamic"), type: "boolean", align: "center" },
      { key: "isActive", label: t("crm.contactSegments.columns.isActive"), type: "boolean", align: "center" },
      { key: "memberCount", label: t("crm.contactSegments.columns.memberCount"), type: "number", align: "right" },
      { key: "description", label: t("crm.contactSegments.columns.description"), width: "min-w-48" },
    ],
    emptyMessage: t("crm.contactSegments.emptyMessage"),
  },
})

// ── Opportunity lines ─────────────────────────────────────────────────────────
export const opportunityLinesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "opportunity-lines-table",
  title: t("crm.opportunityLines.title"),
  description: t("crm.opportunityLines.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.opportunityLines.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "opportunityId", label: t("crm.opportunityLines.columns.opportunityId"), width: "min-w-20" },
      { key: "name", label: t("crm.opportunityLines.columns.name"), width: "min-w-48" },
      { key: "quantity", label: t("crm.opportunityLines.columns.quantity"), type: "number", align: "right" },
      { key: "priceUnit", label: t("crm.opportunityLines.columns.priceUnit"), type: "currency", align: "right" },
      { key: "priceSubtotal", label: t("crm.opportunityLines.columns.priceSubtotal"), type: "currency", align: "right" },
      { key: "discount", label: t("crm.opportunityLines.columns.discount"), type: "percent", align: "right" },
    ],
    emptyMessage: t("crm.opportunityLines.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const crmEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "leads-table": leadsTableConfig(t),
  "opportunities-table": opportunitiesTableConfig(t),
  "contacts-table": contactsTableConfig(t),
  "activities-table": activitiesTableConfig(t),
  "contact-tags-table": contactTagsTableConfig(t),
  "contact-segments-table": contactSegmentsTableConfig(t),
  "opportunity-lines-table": opportunityLinesTableConfig(t),
})
