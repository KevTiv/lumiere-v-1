import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const projectStateBadges = (t: TFunction) => ({
  badgeVariants: { InProgress: "default", Paused: "outline", Done: "secondary", Cancelled: "destructive" },
  badgeLabels: {
    InProgress: t("projects.projects.states.InProgress"),
    Paused: t("projects.projects.states.Paused"),
    Done: t("projects.projects.states.Done"),
    Cancelled: t("projects.projects.states.Cancelled"),
  },
})

const taskStateBadges = (t: TFunction) => ({
  badgeVariants: { InProgress: "default", Changes: "outline", Approved: "default", Cancelled: "destructive", Done: "secondary" },
  badgeLabels: {
    InProgress: t("projects.tasks.states.InProgress"),
    Changes: t("projects.tasks.states.Changes"),
    Approved: t("projects.tasks.states.Approved"),
    Cancelled: t("projects.tasks.states.Cancelled"),
    Done: t("projects.tasks.states.Done"),
  },
})

const priorityBadges = (t: TFunction) => ({
  badgeVariants: { "0": "secondary", "1": "outline", "2": "default", "3": "destructive" },
  badgeLabels: {
    "0": t("projects.tasks.priority.0"),
    "1": t("projects.tasks.priority.1"),
    "2": t("projects.tasks.priority.2"),
    "3": t("projects.tasks.priority.3"),
  },
})

// ── Projects ──────────────────────────────────────────────────────────────────
export const projectsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "projects-table",
  title: t("projects.projects.title"),
  description: t("projects.projects.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("projects.projects.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "lastUpdateStatus",
        label: t("projects.projects.filters.lastUpdateStatus"),
        type: "select",
        options: [
          { value: "InProgress", label: t("projects.projects.filters.lastUpdateStatus.options.InProgress") },
          { value: "Paused", label: t("projects.projects.filters.lastUpdateStatus.options.Paused") },
          { value: "Done", label: t("projects.projects.filters.lastUpdateStatus.options.Done") },
          { value: "Cancelled", label: t("projects.projects.filters.lastUpdateStatus.options.Cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("projects.projects.columns.name"), width: "min-w-48" },
      { key: "lastUpdateStatus", label: t("projects.projects.columns.lastUpdateStatus"), type: "badge", ...projectStateBadges(t) },
      { key: "partnerId", label: t("projects.projects.columns.partnerId"), width: "min-w-32" },
      { key: "dateStart", label: t("projects.projects.columns.dateStart"), type: "date" },
      { key: "dateEnd", label: t("projects.projects.columns.dateEnd"), type: "date" },
      { key: "allocatedHours", label: t("projects.projects.columns.allocatedHours"), type: "number", align: "right" },
      { key: "taskCount", label: t("projects.projects.columns.taskCount"), type: "number", align: "right" },
    ],
    emptyMessage: t("projects.projects.emptyMessage"),
  },
})

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const tasksTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "tasks-table",
  title: t("projects.tasks.title"),
  description: t("projects.tasks.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("projects.tasks.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "kanbanState",
        label: t("projects.tasks.filters.kanbanState"),
        type: "select",
        options: [
          { value: "InProgress", label: t("projects.tasks.filters.kanbanState.options.InProgress") },
          { value: "Changes", label: t("projects.tasks.filters.kanbanState.options.Changes") },
          { value: "Approved", label: t("projects.tasks.filters.kanbanState.options.Approved") },
          { value: "Done", label: t("projects.tasks.filters.kanbanState.options.Done") },
          { value: "Cancelled", label: t("projects.tasks.filters.kanbanState.options.Cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("projects.tasks.columns.name"), width: "min-w-48" },
      { key: "projectId", label: t("projects.tasks.columns.projectId"), width: "min-w-32" },
      { key: "kanbanState", label: t("projects.tasks.columns.kanbanState"), type: "badge", ...taskStateBadges(t) },
      { key: "priority", label: t("projects.tasks.columns.priority"), type: "badge", ...priorityBadges(t) },
      { key: "plannedHours", label: t("projects.tasks.columns.plannedHours"), type: "number", align: "right" },
      { key: "effectiveHours", label: t("projects.tasks.columns.effectiveHours"), type: "number", align: "right" },
      { key: "dateDeadline", label: t("projects.tasks.columns.dateDeadline"), type: "date" },
    ],
    emptyMessage: t("projects.tasks.emptyMessage"),
  },
})

// ── Timesheets ────────────────────────────────────────────────────────────────
export const timesheetsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "timesheets-table",
  title: t("projects.timesheets.title"),
  description: t("projects.timesheets.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("projects.timesheets.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "date", label: t("projects.timesheets.columns.date"), type: "date" },
      { key: "projectId", label: t("projects.timesheets.columns.projectId"), width: "min-w-32" },
      { key: "taskId", label: t("projects.timesheets.columns.taskId"), width: "min-w-32" },
      { key: "name", label: t("projects.timesheets.columns.name"), width: "min-w-48" },
      { key: "unitAmount", label: t("projects.timesheets.columns.unitAmount"), type: "number", align: "right" },
      { key: "amount", label: t("projects.timesheets.columns.amount"), type: "currency", align: "right" },
    ],
    emptyMessage: t("projects.timesheets.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const projectsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "projects-table": projectsTableConfig(t),
  "tasks-table": tasksTableConfig(t),
  "timesheets-table": timesheetsTableConfig(t),
})
