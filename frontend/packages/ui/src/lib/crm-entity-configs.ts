import type { TFunction } from "i18next"
import { createElement } from "react"
import type { EntityViewConfig } from "./entity-view-types"

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
      { key: "contactName", label: t("crm.leads.columns.contactName"), width: "min-w-36" },
      { key: "partnerName", label: t("crm.leads.columns.partnerName"), width: "min-w-36" },
      { key: "emailFrom", label: t("crm.leads.columns.emailFrom"), width: "min-w-40" },
      { key: "phone", label: t("crm.leads.columns.phone"), width: "min-w-28" },
      { key: "state", label: t("crm.leads.columns.state"), type: "badge", ...leadStateBadges(t) },
      { key: "expectedRevenue", label: t("crm.leads.columns.expectedRevenue"), type: "currency", align: "right" },
      { key: "createDate", label: t("crm.leads.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("crm.leads.emptyMessage"),
  },
})

// ── Opportunities ─────────────────────────────────────────────────────────────
export const opportunitiesTableConfig = (t: TFunction): EntityViewConfig => ({
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
        { key: "name", label: t("crm.opportunities.columns.name"), width: "min-w-48" },
        { key: "stageName", label: t("crm.opportunities.columns.stageName"), width: "min-w-28" },
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
        },
        {
          key: "probability",
          label: t("crm.opportunities.columns.probability"),
          type: "percent",
          align: "right",
        },
        {
          key: "dateDeadline",
          label: t("crm.opportunities.columns.dateDeadline"),
          type: "date",
        },
      ],
      emptyMessage: t("crm.opportunities.emptyMessage"),
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
            key: "priority",
            label: t("crm.opportunities.columns.priority"),
            type: "badge",
            ...opportunityPriorityBadges(t),
          },
          {
            key: "dateDeadline",
            label: t("crm.opportunities.columns.dateDeadline"),
            type: "date",
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
    },
  }
}

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
