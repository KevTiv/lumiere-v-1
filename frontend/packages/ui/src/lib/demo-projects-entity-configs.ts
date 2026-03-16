import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const projectStateBadges = {
  badgeVariants: { InProgress: "default", Paused: "outline", Done: "secondary", Cancelled: "destructive" },
  badgeLabels: { InProgress: "In Progress", Paused: "Paused", Done: "Done", Cancelled: "Cancelled" },
} as const

const taskStateBadges = {
  badgeVariants: { InProgress: "default", Changes: "outline", Approved: "default", Cancelled: "destructive", Done: "secondary" },
  badgeLabels: { InProgress: "In Progress", Changes: "Changes Requested", Approved: "Approved", Cancelled: "Cancelled", Done: "Done" },
} as const

const priorityBadges = {
  badgeVariants: { "0": "secondary", "1": "outline", "2": "default", "3": "destructive" },
  badgeLabels: { "0": "Normal", "1": "Low", "2": "High", "3": "Urgent" },
} as const

// ── Projects ──────────────────────────────────────────────────────────────────
export const projectsTableConfig: EntityViewConfig = {
  id: "projects-table",
  title: "Projects",
  description: "All active and completed projects",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search projects…",
    searchKeys: ["name"],
    filters: [
      {
        key: "lastUpdateStatus",
        label: "Status",
        type: "select",
        options: [
          { value: "InProgress", label: "In Progress" },
          { value: "Paused", label: "Paused" },
          { value: "Done", label: "Done" },
          { value: "Cancelled", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Project", width: "min-w-48" },
      { key: "lastUpdateStatus", label: "Status", type: "badge", ...projectStateBadges },
      { key: "partnerId", label: "Customer", width: "min-w-32" },
      { key: "dateStart", label: "Start", type: "date" },
      { key: "dateEnd", label: "Deadline", type: "date" },
      { key: "allocatedHours", label: "Budget (h)", type: "number", align: "right" },
      { key: "taskCount", label: "Tasks", type: "number", align: "right" },
    ],
    emptyMessage: "No projects found.",
  },
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const tasksTableConfig: EntityViewConfig = {
  id: "tasks-table",
  title: "Tasks",
  description: "All project tasks",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search tasks…",
    searchKeys: ["name"],
    filters: [
      {
        key: "kanbanState",
        label: "Status",
        type: "select",
        options: [
          { value: "InProgress", label: "In Progress" },
          { value: "Changes", label: "Changes Requested" },
          { value: "Approved", label: "Approved" },
          { value: "Done", label: "Done" },
          { value: "Cancelled", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Task", width: "min-w-48" },
      { key: "projectId", label: "Project", width: "min-w-32" },
      { key: "kanbanState", label: "Status", type: "badge", ...taskStateBadges },
      { key: "priority", label: "Priority", type: "badge", ...priorityBadges },
      { key: "plannedHours", label: "Planned (h)", type: "number", align: "right" },
      { key: "effectiveHours", label: "Spent (h)", type: "number", align: "right" },
      { key: "dateDeadline", label: "Deadline", type: "date" },
    ],
    emptyMessage: "No tasks found.",
  },
}

// ── Timesheets ────────────────────────────────────────────────────────────────
export const timesheetsTableConfig: EntityViewConfig = {
  id: "timesheets-table",
  title: "Timesheets",
  description: "Time entries logged against projects and tasks",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search timesheets…",
    searchKeys: ["name"],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "projectId", label: "Project", width: "min-w-32" },
      { key: "taskId", label: "Task", width: "min-w-32" },
      { key: "name", label: "Description", width: "min-w-48" },
      { key: "unitAmount", label: "Hours", type: "number", align: "right" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
    ],
    emptyMessage: "No timesheet entries found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const projectsEntityConfigs: Record<string, EntityViewConfig> = {
  "projects-table": projectsTableConfig,
  "tasks-table": tasksTableConfig,
  "timesheets-table": timesheetsTableConfig,
}
