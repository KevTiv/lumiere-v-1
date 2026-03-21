import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const ticketStateBadges = (t: TFunction) => ({
  badgeVariants: { new: "secondary", open: "default", pending: "outline", solved: "default", cancelled: "destructive" },
  badgeLabels: {
    new: t("helpdesk.tickets.states.new"),
    open: t("helpdesk.tickets.states.open"),
    pending: t("helpdesk.tickets.states.pending"),
    solved: t("helpdesk.tickets.states.solved"),
    cancelled: t("helpdesk.tickets.states.cancelled"),
  },
}) as const

const priorityBadges = (t: TFunction) => ({
  badgeVariants: { low: "secondary", normal: "outline", high: "default", urgent: "destructive" },
  badgeLabels: {
    low: t("helpdesk.tickets.priority.low"),
    normal: t("helpdesk.tickets.priority.normal"),
    high: t("helpdesk.tickets.priority.high"),
    urgent: t("helpdesk.tickets.priority.urgent"),
  },
}) as const

// ── Helpdesk Tickets ──────────────────────────────────────────────────────────
export const helpdeskTicketsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "helpdesk-tickets-table",
  title: t("helpdesk.tickets.title"),
  description: t("helpdesk.tickets.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("helpdesk.tickets.searchPlaceholder"),
    searchKeys: ["name", "description", "partnerName"],
    filters: [
      {
        key: "state",
        label: t("helpdesk.tickets.filters.state"),
        type: "select",
        options: [
          { value: "new", label: t("helpdesk.tickets.filters.state.options.new") },
          { value: "open", label: t("helpdesk.tickets.filters.state.options.open") },
          { value: "pending", label: t("helpdesk.tickets.filters.state.options.pending") },
          { value: "solved", label: t("helpdesk.tickets.filters.state.options.solved") },
          { value: "cancelled", label: t("helpdesk.tickets.filters.state.options.cancelled") },
        ],
      },
      {
        key: "priority",
        label: t("helpdesk.tickets.filters.priority"),
        type: "select",
        options: [
          { value: "low", label: t("helpdesk.tickets.filters.priority.options.low") },
          { value: "normal", label: t("helpdesk.tickets.filters.priority.options.normal") },
          { value: "high", label: t("helpdesk.tickets.filters.priority.options.high") },
          { value: "urgent", label: t("helpdesk.tickets.filters.priority.options.urgent") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("helpdesk.tickets.columns.name"), width: "min-w-48" },
      { key: "partnerName", label: t("helpdesk.tickets.columns.partnerName"), width: "min-w-36" },
      { key: "partnerEmail", label: t("helpdesk.tickets.columns.partnerEmail"), width: "min-w-40" },
      { key: "state", label: t("helpdesk.tickets.columns.state"), type: "badge", ...ticketStateBadges(t) },
      { key: "priority", label: t("helpdesk.tickets.columns.priority"), type: "badge", ...priorityBadges(t) },
      { key: "slaReached", label: t("helpdesk.tickets.columns.slaReached"), type: "boolean" },
      { key: "slaDeadline", label: t("helpdesk.tickets.columns.slaDeadline"), type: "date" },
      { key: "createdAt", label: t("helpdesk.tickets.columns.createdAt"), type: "date" },
    ],
    emptyMessage: t("helpdesk.tickets.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const helpdeskEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "helpdesk-tickets-table": helpdeskTicketsTableConfig(t),
})
