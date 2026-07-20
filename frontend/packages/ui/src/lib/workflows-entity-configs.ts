import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const instanceStateBadges = (t: TFunction) =>
  ({
    badgeVariants: {
      Active: "default",
      Completed: "secondary",
      Cancelled: "outline",
      Failed: "destructive",
    },
    badgeLabels: {
      Active: t("workflows.instances.states.Active", { defaultValue: "Active" }),
      Completed: t("workflows.instances.states.Complete", { defaultValue: "Completed" }),
      Cancelled: t("workflows.instances.states.Cancelled", { defaultValue: "Cancelled" }),
      Failed: t("workflows.instances.states.Exception", { defaultValue: "Failed" }),
    },
  }) as const

const versionStatusBadges = (t: TFunction) =>
  ({
    badgeVariants: {
      Draft: "outline",
      Published: "default",
      Retired: "secondary",
    },
    badgeLabels: {
      Draft: t("workflows.versions.states.Draft", { defaultValue: "Draft" }),
      Published: t("workflows.versions.states.Published", { defaultValue: "Published" }),
      Retired: t("workflows.versions.states.Retired", { defaultValue: "Retired" }),
    },
  }) as const

export const workflowsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflows-table",
  title: t("workflows.workflows.title"),
  description: t("workflows.workflows.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("workflows.workflows.searchPlaceholder"),
    searchKeys: ["workflowKey", "workflow_key", "name", "model"],
    columns: [
      {
        key: "workflowKey",
        label: t("workflows.workflows.columns.key", { defaultValue: "Key" }),
        width: "min-w-40",
      },
      {
        key: "model",
        label: t("workflows.workflows.columns.model"),
        width: "min-w-32",
      },
      {
        key: "companyId",
        label: t("workflows.workflows.columns.companyId", { defaultValue: "Company" }),
        width: "min-w-28",
      },
      {
        key: "createDate",
        label: t("workflows.workflows.columns.createDate"),
        type: "date",
      },
    ],
    emptyMessage: t("workflows.workflows.emptyMessage"),
  },
})

export const workflowVersionsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-versions-table",
  title: t("workflows.versions.title", { defaultValue: "Versions" }),
  description: t("workflows.versions.description", {
    defaultValue: "Draft, published, and retired workflow versions",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("workflows.versions.searchPlaceholder", {
      defaultValue: "Search versions…",
    }),
    searchKeys: ["name", "workflowId", "workflow_id"],
    filters: [
      {
        key: "statusTag",
        label: t("workflows.versions.filters.statusLabel", { defaultValue: "Status" }),
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Published", label: "Published" },
          { value: "Retired", label: "Retired" },
        ],
      },
    ],
    columns: [
      { key: "workflowId", label: "Workflow", width: "min-w-28" },
      { key: "version", label: "Version", type: "number", align: "right" },
      { key: "name", label: "Name", width: "min-w-40" },
      {
        key: "statusTag",
        label: "Status",
        type: "badge",
        ...versionStatusBadges(t),
      },
      { key: "draftRevision", label: "Draft rev", type: "number", align: "right" },
      { key: "schemaVersion", label: "Schema", type: "number", align: "right" },
    ],
    emptyMessage: t("workflows.versions.emptyMessage", {
      defaultValue: "No workflow versions yet",
    }),
  },
})

export const workflowInstancesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-instances-table",
  title: t("workflows.instances.title"),
  description: t("workflows.instances.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("workflows.instances.searchPlaceholder"),
    searchKeys: ["subjectModel", "subject_model", "stateTag"],
    filters: [
      {
        key: "stateTag",
        label: t("workflows.instances.filters.stateLabel"),
        type: "select",
        options: [
          { value: "Active", label: "Active" },
          { value: "Completed", label: "Completed" },
          { value: "Cancelled", label: "Cancelled" },
          { value: "Failed", label: "Failed" },
        ],
      },
    ],
    columns: [
      { key: "workflowId", label: t("workflows.instances.columns.workflowId"), width: "min-w-28" },
      {
        key: "workflowVersionId",
        label: t("workflows.instances.columns.versionId", { defaultValue: "Version" }),
        width: "min-w-28",
      },
      {
        key: "subjectModel",
        label: t("workflows.instances.columns.resType", { defaultValue: "Subject" }),
        width: "min-w-32",
      },
      {
        key: "subjectId",
        label: t("workflows.instances.columns.resId", { defaultValue: "Subject ID" }),
        type: "number",
        align: "right",
      },
      {
        key: "stateTag",
        label: t("workflows.instances.columns.state"),
        type: "badge",
        ...instanceStateBadges(t),
      },
      { key: "revision", label: "Revision", type: "number", align: "right" },
      { key: "startedAt", label: t("workflows.instances.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("workflows.instances.emptyMessage"),
  },
})
