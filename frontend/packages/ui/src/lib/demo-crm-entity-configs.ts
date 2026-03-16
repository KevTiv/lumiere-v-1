import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const leadStateBadges = {
  badgeVariants: { New: "secondary", Qualified: "outline", Won: "default", Lost: "destructive" },
  badgeLabels: { New: "New", Qualified: "Qualified", Won: "Won", Lost: "Lost" },
} as const

const opportunityPriorityBadges = {
  badgeVariants: { Low: "secondary", Medium: "outline", High: "default" },
  badgeLabels: { Low: "Low", Medium: "Medium", High: "High" },
} as const

// ── Leads ─────────────────────────────────────────────────────────────────────
export const leadsTableConfig: EntityViewConfig = {
  id: "leads-table",
  title: "Leads",
  description: "Incoming leads and prospects",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by name, email, or company…",
    searchKeys: ["contactName", "emailFrom", "partnerName"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "New", label: "New" },
          { value: "Qualified", label: "Qualified" },
          { value: "Won", label: "Won" },
          { value: "Lost", label: "Lost" },
        ],
      },
    ],
    columns: [
      { key: "contactName", label: "Name", width: "min-w-36" },
      { key: "partnerName", label: "Company", width: "min-w-36" },
      { key: "emailFrom", label: "Email", width: "min-w-40" },
      { key: "phone", label: "Phone", width: "min-w-28" },
      { key: "state", label: "Status", type: "badge", ...leadStateBadges },
      { key: "expectedRevenue", label: "Expected Revenue", type: "currency", align: "right" },
      { key: "createDate", label: "Created", type: "date" },
    ],
    emptyMessage: "No leads found.",
  },
}

// ── Opportunities ─────────────────────────────────────────────────────────────
export const opportunitiesTableConfig: EntityViewConfig = {
  id: "opportunities-table",
  title: "Opportunities",
  description: "Active pipeline and deals in progress",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search opportunities…",
    searchKeys: ["name"],
    columns: [
      { key: "name", label: "Opportunity", width: "min-w-48" },
      { key: "stageName", label: "Stage", width: "min-w-28" },
      { key: "priority", label: "Priority", type: "badge", ...opportunityPriorityBadges },
      { key: "expectedRevenue", label: "Expected Revenue", type: "currency", align: "right" },
      { key: "probability", label: "Win %", type: "percent", align: "right" },
      { key: "dateDeadline", label: "Close Date", type: "date" },
    ],
    emptyMessage: "No opportunities found.",
  },
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export const contactsTableConfig: EntityViewConfig = {
  id: "contacts-table",
  title: "Contacts",
  description: "Customers, vendors, and partners",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by name or email…",
    searchKeys: ["name", "email"],
    columns: [
      { key: "name", label: "Name", width: "min-w-40" },
      { key: "companyName", label: "Company", width: "min-w-36" },
      { key: "email", label: "Email", width: "min-w-44" },
      { key: "phone", label: "Phone", width: "min-w-28" },
      { key: "isCompany", label: "Type", type: "boolean" },
      { key: "city", label: "City", width: "min-w-24" },
      { key: "countryId", label: "Country", width: "min-w-20" },
    ],
    emptyMessage: "No contacts found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const crmEntityConfigs: Record<string, EntityViewConfig> = {
  "leads-table": leadsTableConfig,
  "opportunities-table": opportunitiesTableConfig,
  "contacts-table": contactsTableConfig,
}
