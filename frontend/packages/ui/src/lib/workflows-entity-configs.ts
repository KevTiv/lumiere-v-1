import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const instanceStateBadges = (t: TFunction) => ({
  badgeVariants: { running: "default", done: "outline", cancelled: "destructive" },
  badgeLabels: {
    running: t("workflows.instances.states.running"),
    done: t("workflows.instances.states.done"),
    cancelled: t("workflows.instances.states.cancelled"),
  },
}) as const

// ── Workflows ─────────────────────────────────────────────────────────────────
export const workflowsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflows-table",
  title: t("workflows.workflows.title"),
  description: t("workflows.workflows.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("workflows.workflows.searchPlaceholder"),
    searchKeys: ["name", "description", "model"],
    filters: [
      {
        key: "isActive",
        label: t("workflows.workflows.filters.isActive"),
        type: "select",
        options: [
          { value: "true", label: t("workflows.workflows.filters.isActive.options.true") },
          { value: "false", label: t("workflows.workflows.filters.isActive.options.false") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("workflows.workflows.columns.name"), width: "min-w-48" },
      { key: "description", label: t("workflows.workflows.columns.description"), width: "min-w-40" },
      { key: "model", label: t("workflows.workflows.columns.model"), width: "min-w-32" },
      { key: "stateField", label: t("workflows.workflows.columns.stateField"), width: "min-w-28" },
      { key: "transitionCount", label: t("workflows.workflows.columns.transitionCount"), type: "number", align: "right" },
      { key: "isActive", label: t("workflows.workflows.columns.isActive"), type: "boolean" },
      { key: "onCreate", label: t("workflows.workflows.columns.onCreate"), type: "boolean" },
      { key: "createDate", label: t("workflows.workflows.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("workflows.workflows.emptyMessage"),
  },
})

// ── Workflow Instances ────────────────────────────────────────────────────────
export const workflowInstancesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-instances-table",
  title: t("workflows.instances.title"),
  description: t("workflows.instances.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("workflows.instances.searchPlaceholder"),
    searchKeys: ["resType"],
    filters: [
      {
        key: "state",
        label: t("workflows.instances.filters.state"),
        type: "select",
        options: [
          { value: "running", label: t("workflows.instances.filters.state.options.running") },
          { value: "done", label: t("workflows.instances.filters.state.options.done") },
          { value: "cancelled", label: t("workflows.instances.filters.state.options.cancelled") },
        ],
      },
    ],
    columns: [
      { key: "workflowId", label: t("workflows.instances.columns.workflowId"), width: "min-w-28" },
      { key: "resType", label: t("workflows.instances.columns.resType"), width: "min-w-32" },
      { key: "resId", label: t("workflows.instances.columns.resId"), type: "number", align: "right" },
      { key: "state", label: t("workflows.instances.columns.state"), type: "badge", ...instanceStateBadges(t) },
      { key: "createDate", label: t("workflows.instances.columns.createDate"), type: "date" },
      { key: "writeDate", label: t("workflows.instances.columns.writeDate"), type: "date" },
    ],
    emptyMessage: t("workflows.instances.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const workflowsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "workflows-table": workflowsTableConfig(t),
  "workflow-instances-table": workflowInstancesTableConfig(t),
})
