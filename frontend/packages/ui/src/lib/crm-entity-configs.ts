import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const leadStateBadges = (t: TFunction) => ({
  badgeVariants: { New: "secondary", Qualified: "outline", Won: "default", Lost: "destructive" },
  badgeLabels: {
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

const activityStateBadges = (t: TFunction) => ({
  badgeVariants: { false: "outline", today: "default", overdue: "destructive" },
  badgeLabels: {
    false: t("crm.activities.filters.activityCategory.options.default"),
    today: t("crm.activities.columns.dateDeadline"),
    overdue: t("crm.activities.columns.dateDeadline"),
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
    searchKeys: ["contactName", "emailFrom", "partnerName"],
    filters: [
      {
        key: "state",
        label: t("crm.leads.filters.state"),
        type: "select",
        options: [
          { value: "New", label: t("crm.leads.filters.state.options.New") },
          { value: "Qualified", label: t("crm.leads.filters.state.options.Qualified") },
          { value: "Won", label: t("crm.leads.filters.state.options.Won") },
          { value: "Lost", label: t("crm.leads.filters.state.options.Lost") },
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
  title: t("crm.opportunities.title"),
  description: t("crm.opportunities.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.opportunities.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("crm.opportunities.columns.name"), width: "min-w-48" },
      { key: "stageName", label: t("crm.opportunities.columns.stageName"), width: "min-w-28" },
      { key: "priority", label: t("crm.opportunities.columns.priority"), type: "badge", ...opportunityPriorityBadges(t) },
      { key: "expectedRevenue", label: t("crm.opportunities.columns.expectedRevenue"), type: "currency", align: "right" },
      { key: "probability", label: t("crm.opportunities.columns.probability"), type: "percent", align: "right" },
      { key: "dateDeadline", label: t("crm.opportunities.columns.dateDeadline"), type: "date" },
    ],
    emptyMessage: t("crm.opportunities.emptyMessage"),
  },
})

// ── Contacts ──────────────────────────────────────────────────────────────────
export const contactsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "contacts-table",
  title: t("crm.contacts.title"),
  description: t("crm.contacts.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("crm.contacts.searchPlaceholder"),
    searchKeys: ["name", "email"],
    columns: [
      { key: "name", label: t("crm.contacts.columns.name"), width: "min-w-40" },
      { key: "companyName", label: t("crm.contacts.columns.companyName"), width: "min-w-36" },
      { key: "email", label: t("crm.contacts.columns.email"), width: "min-w-44" },
      { key: "phone", label: t("crm.contacts.columns.phone"), width: "min-w-28" },
      { key: "isCompany", label: t("crm.contacts.columns.isCompany"), type: "boolean" },
      { key: "city", label: t("crm.contacts.columns.city"), width: "min-w-24" },
      { key: "countryId", label: t("crm.contacts.columns.countryId"), width: "min-w-20" },
    ],
    emptyMessage: t("crm.contacts.emptyMessage"),
  },
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
        key: "activityCategory",
        label: t("crm.activities.filters.activityCategory"),
        type: "select",
        options: [
          { value: "default", label: t("crm.activities.filters.activityCategory.options.default") },
          { value: "upload_file", label: t("crm.activities.filters.activityCategory.options.upload_file") },
        ],
      },
    ],
    columns: [
      { key: "summary", label: t("crm.activities.columns.summary"), width: "min-w-48" },
      { key: "activityTypeId", label: t("crm.activities.columns.activityTypeId"), width: "min-w-28" },
      { key: "dateDeadline", label: t("crm.activities.columns.dateDeadline"), type: "date" },
      { key: "userId", label: t("crm.activities.columns.userId"), width: "min-w-36" },
      { key: "resName", label: t("crm.activities.columns.resName"), width: "min-w-36" },
    ],
    emptyMessage: t("crm.activities.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const crmEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "leads-table": leadsTableConfig(t),
  "opportunities-table": opportunitiesTableConfig(t),
  "contacts-table": contactsTableConfig(t),
  "activities-table": activitiesTableConfig(t),
})
