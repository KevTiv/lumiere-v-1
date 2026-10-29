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
  badgeVariants: { InProgress: "info", ChangesRequested: "warning", Approved: "default", Cancelled: "destructive", Done: "success" },
  badgeLabels: {
    InProgress: t("projects.tasks.states.InProgress"),
    ChangesRequested: t("projects.tasks.states.ChangesRequested"),
    Approved: t("projects.tasks.states.Approved"),
    Cancelled: t("projects.tasks.states.Cancelled"),
    Done: t("projects.tasks.states.Done"),
  },
})

const priorityBadges = (t: TFunction) => ({
  badgeVariants: { "0": "info", "1": "secondary", "2": "warning", "3": "destructive" },
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
        label: t("projects.projects.filters.lastUpdateStatus.label"),
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
    emptyState: {
      title: t("projects.projects.emptyMessage"),
      description: t("projects.projects.emptyState.description", { defaultValue: "Projects group tasks, timesheets and billing for a piece of work, so progress and profitability are visible." }),
      permission: { resource: "project_project", action: "create" },
      secondaryActionId: "csv-project",
      learnHint: t("projects.projects.emptyState.hint", { defaultValue: "Add tasks to a project, then log time against them." }),
    },
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
    selectable: true,
    filters: [
      {
        key: "state",
        label: t("projects.tasks.columns.kanbanState"),
        type: "select",
        faceted: true,
        options: [
          { value: "InProgress", label: t("projects.tasks.states.InProgress") },
          { value: "ChangesRequested", label: t("projects.tasks.states.ChangesRequested") },
          { value: "Approved", label: t("projects.tasks.states.Approved") },
          { value: "Done", label: t("projects.tasks.states.Done") },
          { value: "Cancelled", label: t("projects.tasks.states.Cancelled") },
        ],
      },
      {
        key: "priority",
        label: t("projects.tasks.columns.priority"),
        type: "select",
        faceted: true,
        options: (["0", "1", "2", "3"] as const).map((value) => ({
          value,
          label: t(`projects.tasks.priority.${value}`),
        })),
      },
    ],
    columns: [
      { key: "name", label: t("projects.tasks.columns.name"), width: "min-w-48", sortable: true },
      { key: "projectId", label: t("projects.tasks.columns.projectId"), width: "min-w-32" },
      { key: "state", label: t("projects.tasks.columns.kanbanState"), type: "badge", ...taskStateBadges(t) },
      { key: "priority", label: t("projects.tasks.columns.priority"), type: "badge", sortable: true, ...priorityBadges(t) },
      { key: "plannedHours", label: t("projects.tasks.columns.plannedHours"), type: "number", align: "right", sortable: true },
      { key: "effectiveHours", label: t("projects.tasks.columns.effectiveHours"), type: "number", align: "right", sortable: true },
      { key: "dateDeadline", label: t("projects.tasks.columns.dateDeadline"), type: "date", sortable: true },
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

// ── Rate cards ────────────────────────────────────────────────────────────────
export const rateCardsTableConfig = (_t: TFunction): EntityViewConfig => ({
  id: "rate-cards-table",
  title: _t("projects.builtIn.projectsEntityConfigs.rateCardsTableConfig.rateCardsTable.title", { defaultValue: "Rate cards" }),
  description: _t("projects.builtIn.projectsEntityConfigs.rateCardsTableConfig.rateCardsTable.description", { defaultValue: "Project / employee / task cost and sell rates" }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: _t("projects.builtIn.projectsEntityConfigs.rateCardsTableConfig.view.searchPlaceholder", { defaultValue: "Search rate cards…" }),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: _t("projects.builtIn.projectsEntityConfigs.rateCardsTableConfig.name.label", { defaultValue: "Name" }), width: "min-w-48" },
      { key: "projectId", label: _t("projects.projects.columns.name", { defaultValue: "Project" }), width: "min-w-32" },
      { key: "currencyId", label: _t("projects.forms.logTimesheet.fields.currencyId", { defaultValue: "Currency" }), width: "min-w-24" },
      { key: "active", label: _t("common.active", { defaultValue: "Active" }), type: "badge" },
    ],
    emptyMessage: _t("projects.builtIn.projectsEntityConfigs.rateCardsTableConfig.view.emptyMessage", { defaultValue: "No rate cards yet" }),
  },
})

export const rateCardLinesTableConfig = (_t: TFunction): EntityViewConfig => ({
  id: "rate-card-lines-table",
  title: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.rateCardLinesTable.title", { defaultValue: "Rate card lines" }),
  description: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.rateCardLinesTable.description", { defaultValue: "Scoped rate lines" }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.view.searchPlaceholder", { defaultValue: "Search lines…" }),
    searchKeys: ["scope"],
    columns: [
      { key: "rateCardId", label: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.rateCardId.label", { defaultValue: "Card" }), width: "min-w-24" },
      { key: "scope", label: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.scope.label", { defaultValue: "Scope" }), width: "min-w-24" },
      { key: "employeeId", label: _t("projects.resourceAllocation.columns.employee", { defaultValue: "Employee" }), width: "min-w-24" },
      { key: "taskId", label: _t("projects.tasks.columns.name", { defaultValue: "Task" }), width: "min-w-24" },
      { key: "costRate", label: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.costRate.label", { defaultValue: "Cost" }), type: "number", align: "right" },
      { key: "sellRate", label: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.sellRate.label", { defaultValue: "Sell" }), type: "number", align: "right" },
      { key: "active", label: _t("common.active", { defaultValue: "Active" }), type: "badge" },
    ],
    emptyMessage: _t("projects.builtIn.projectsEntityConfigs.rateCardLinesTableConfig.view.emptyMessage", { defaultValue: "No rate card lines yet" }),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const projectsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "projects-table": projectsTableConfig(t),
  "tasks-table": tasksTableConfig(t),
  "timesheets-table": timesheetsTableConfig(t),
  "rate-cards-table": rateCardsTableConfig(t),
  "rate-card-lines-table": rateCardLinesTableConfig(t),
})
