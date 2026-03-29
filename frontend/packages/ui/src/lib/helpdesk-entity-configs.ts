import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

/** Matches SpacetimeDB `HelpdeskTicketState` variant names. */
const ticketStateBadges = (t: TFunction) => ({
  badgeVariants: {
    New: "secondary",
    InProgress: "default",
    OnHold: "outline",
    Closed: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    New: t("helpdesk.tickets.states.New"),
    InProgress: t("helpdesk.tickets.states.InProgress"),
    OnHold: t("helpdesk.tickets.states.OnHold"),
    Closed: t("helpdesk.tickets.states.Closed"),
    Cancelled: t("helpdesk.tickets.states.Cancelled"),
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
          { value: "New", label: t("helpdesk.tickets.filters.state.options.New") },
          { value: "InProgress", label: t("helpdesk.tickets.filters.state.options.InProgress") },
          { value: "OnHold", label: t("helpdesk.tickets.filters.state.options.OnHold") },
          { value: "Closed", label: t("helpdesk.tickets.filters.state.options.Closed") },
          { value: "Cancelled", label: t("helpdesk.tickets.filters.state.options.Cancelled") },
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

export const helpdeskTeamsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "helpdesk-teams-table",
  title: t("helpdesk.teams.title"),
  description: t("helpdesk.teams.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("helpdesk.teams.searchPlaceholder"),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("helpdesk.teams.columns.name"), width: "min-w-40" },
      { key: "description", label: t("helpdesk.teams.columns.description"), width: "min-w-48" },
      { key: "isActive", label: t("helpdesk.teams.columns.isActive"), type: "boolean" },
      { key: "createdAt", label: t("helpdesk.teams.columns.createdAt"), type: "date" },
    ],
    emptyMessage: t("helpdesk.teams.emptyMessage"),
  },
})

export const helpdeskStagesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "helpdesk-stages-table",
  title: t("helpdesk.stages.title"),
  description: t("helpdesk.stages.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("helpdesk.stages.searchPlaceholder"),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("helpdesk.stages.columns.name"), width: "min-w-36" },
      { key: "teamId", label: t("helpdesk.stages.columns.teamId"), width: "min-w-24" },
      { key: "sequence", label: t("helpdesk.stages.columns.sequence"), type: "number" },
      { key: "isClosed", label: t("helpdesk.stages.columns.isClosed"), type: "boolean" },
      { key: "createdAt", label: t("helpdesk.stages.columns.createdAt"), type: "date" },
    ],
    emptyMessage: t("helpdesk.stages.emptyMessage"),
  },
})

export const helpdeskSlasTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "helpdesk-slas-table",
  title: t("helpdesk.slas.title"),
  description: t("helpdesk.slas.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("helpdesk.slas.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("helpdesk.slas.columns.name"), width: "min-w-40" },
      { key: "teamId", label: t("helpdesk.slas.columns.teamId"), width: "min-w-24" },
      { key: "stageId", label: t("helpdesk.slas.columns.stageId"), width: "min-w-24" },
      { key: "priority", label: t("helpdesk.slas.columns.priority"), width: "min-w-24" },
      { key: "timeDays", label: t("helpdesk.slas.columns.timeDays"), type: "number" },
      { key: "timeHours", label: t("helpdesk.slas.columns.timeHours"), type: "number" },
      { key: "isActive", label: t("helpdesk.slas.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("helpdesk.slas.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const helpdeskEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "helpdesk-tickets-table": helpdeskTicketsTableConfig(t),
  "helpdesk-teams-table": helpdeskTeamsTableConfig(t),
  "helpdesk-stages-table": helpdeskStagesTableConfig(t),
  "helpdesk-slas-table": helpdeskSlasTableConfig(t),
})
