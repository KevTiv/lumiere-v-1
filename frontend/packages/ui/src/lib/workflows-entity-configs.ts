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
          { value: "Draft", label: t("workflows.workflows.filters.state.options.Draft", { defaultValue: "Draft" }) },
          { value: "Published", label: t("workflows.versions.states.Published", { defaultValue: "Published" }) },
          { value: "Retired", label: t("workflows.versions.states.Retired", { defaultValue: "Retired" }) },
        ],
      },
    ],
    columns: [
      { key: "workflowId", label: t("workflows.instances.columns.workflowId", { defaultValue: "Workflow" }), width: "min-w-28" },
      { key: "version", label: t("workflows.instances.columns.versionId", { defaultValue: "Version" }), type: "number", align: "right" },
      { key: "name", label: t("workflows.workflows.columns.name", { defaultValue: "Name" }), width: "min-w-40" },
      {
        key: "statusTag",
        label: t("workflows.workflows.columns.state", { defaultValue: "Status" }),
        type: "badge",
        ...versionStatusBadges(t),
      },
      { key: "draftRevision", label: t("workflows.builtIn.workflowsEntityConfigs.workflowVersionsTableConfig.draftRevision.label", { defaultValue: "Draft rev" }), type: "number", align: "right" },
      { key: "schemaVersion", label: t("workflows.builtIn.workflowsEntityConfigs.workflowVersionsTableConfig.schemaVersion.label", { defaultValue: "Schema" }), type: "number", align: "right" },
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
          { value: "Active", label: t("common.active", { defaultValue: "Active" }) },
          { value: "Completed", label: t("workflows.instances.columns.dateEnd", { defaultValue: "Completed" }) },
          { value: "Cancelled", label: t("workflows.instances.filters.state.options.Cancelled", { defaultValue: "Cancelled" }) },
          { value: "Failed", label: t("workflows.builtIn.workflowsEntityConfigs.workflowInstancesTableConfig.failed.label", { defaultValue: "Failed" }) },
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
      { key: "revision", label: t("workflows.builtIn.workflowsEntityConfigs.workflowInstancesTableConfig.revision.label", { defaultValue: "Revision" }), type: "number", align: "right" },
      { key: "startedAt", label: t("workflows.instances.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("workflows.instances.emptyMessage"),
  },
})

export const workflowTimersLateTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-timers-late-table",
  title: t("workflows.operations.timersTitle", { defaultValue: "Pending timers" }),
  description: t("workflows.operations.timersDescription", {
    defaultValue: "Pending workflow timers awaiting fire or cancel",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["instanceId", "instance_id", "semanticKey", "semantic_key"],
    columns: [
      { key: "id", label: t("workflows.builtIn.workflowsEntityConfigs.workflowTimersLateTableConfig.id.label", { defaultValue: "Timer" }), width: "min-w-24" },
      { key: "instanceId", label: t("workflows.rowDialog.instanceTitle", { defaultValue: "Instance" }), width: "min-w-28" },
      { key: "dueAt", label: t("workflows.builtIn.workflowsEntityConfigs.workflowTimersLateTableConfig.dueAt.label", { defaultValue: "Due" }), type: "date", width: "min-w-36" },
      { key: "revision", label: t("workflows.builtIn.workflowsEntityConfigs.workflowTimersLateTableConfig.revision.label", { defaultValue: "Rev" }), type: "number", align: "right" },
      { key: "semanticKey", label: t("workflows.workflows.columns.key", { defaultValue: "Key" }), width: "min-w-40" },
    ],
    emptyMessage: t("workflows.operations.timersEmpty", {
      defaultValue: "No pending timers",
    }),
  },
})

export const workflowOutboxDeadTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-outbox-dead-table",
  title: t("workflows.operations.outboxTitle", { defaultValue: "Dead-letter outbox" }),
  description: t("workflows.operations.outboxDescription", {
    defaultValue: "Failed or ambiguous external deliveries needing operator action",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["actionKey", "action_key", "instanceId", "instance_id"],
    columns: [
      { key: "id", label: t("workflows.builtIn.workflowsEntityConfigs.workflowOutboxDeadTableConfig.id.label", { defaultValue: "Outbox" }), width: "min-w-24" },
      { key: "instanceId", label: t("workflows.rowDialog.instanceTitle", { defaultValue: "Instance" }), width: "min-w-28" },
      { key: "actionKey", label: t("workflows.builtIn.workflowsEntityConfigs.workflowOutboxDeadTableConfig.actionKey.label", { defaultValue: "Action" }), width: "min-w-40" },
      { key: "status", label: t("workflows.workflows.columns.state", { defaultValue: "Status" }), width: "min-w-32" },
      { key: "errorSummary", label: t("common.error.title", { defaultValue: "Error" }), width: "min-w-48" },
      { key: "revision", label: t("workflows.builtIn.workflowsEntityConfigs.workflowTimersLateTableConfig.revision.label", { defaultValue: "Rev" }), type: "number", align: "right" },
    ],
    emptyMessage: t("workflows.operations.outboxEmpty", {
      defaultValue: "No dead-letter outbox rows",
    }),
  },
})

export const workflowMigrationPlansTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-migration-plans-table",
  title: t("workflows.migration.plansTitle", { defaultValue: "Migration plans" }),
  description: t("workflows.migration.plansDescription", {
    defaultValue: "Version-to-version mappings for active instance cutover",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["workflowId", "workflow_id"],
    columns: [
      { key: "id", label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationPlansTableConfig.id.label", { defaultValue: "Plan" }), width: "min-w-24" },
      { key: "workflowId", label: t("workflows.instances.columns.workflowId", { defaultValue: "Workflow" }), width: "min-w-28" },
      {
        key: "sourceWorkflowVersionId",
        label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationPlansTableConfig.sourceWorkflowVersionId.label", { defaultValue: "From version" }),
        width: "min-w-28",
      },
      {
        key: "targetWorkflowVersionId",
        label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationPlansTableConfig.targetWorkflowVersionId.label", { defaultValue: "To version" }),
        width: "min-w-28",
      },
      { key: "compatibilityTag", label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationPlansTableConfig.compatibilityTag.label", { defaultValue: "Compatibility" }), width: "min-w-32" },
      { key: "active", label: t("common.active", { defaultValue: "Active" }), width: "min-w-20" },
      { key: "revision", label: t("workflows.builtIn.workflowsEntityConfigs.workflowTimersLateTableConfig.revision.label", { defaultValue: "Rev" }), type: "number", align: "right" },
    ],
    emptyMessage: t("workflows.migration.plansEmpty", {
      defaultValue: "No migration plans yet",
    }),
  },
})

export const workflowMigrationResultsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "workflow-migration-results-table",
  title: t("workflows.migration.resultsTitle", { defaultValue: "Migration results" }),
  description: t("workflows.migration.resultsDescription", {
    defaultValue: "Per-instance migration outcomes",
  }),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["instanceId", "instance_id", "planId", "plan_id"],
    columns: [
      { key: "id", label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationResultsTableConfig.id.label", { defaultValue: "Result" }), width: "min-w-24" },
      { key: "planId", label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationPlansTableConfig.id.label", { defaultValue: "Plan" }), width: "min-w-24" },
      { key: "instanceId", label: t("workflows.rowDialog.instanceTitle", { defaultValue: "Instance" }), width: "min-w-28" },
      { key: "outcomeTag", label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationResultsTableConfig.outcomeTag.label", { defaultValue: "Outcome" }), width: "min-w-28" },
      { key: "reason", label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationResultsTableConfig.reason.label", { defaultValue: "Reason" }), width: "min-w-40" },
      {
        key: "priorInstanceRevision",
        label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationResultsTableConfig.priorInstanceRevision.label", { defaultValue: "Prior rev" }),
        type: "number",
        align: "right",
      },
      {
        key: "nextInstanceRevision",
        label: t("workflows.builtIn.workflowsEntityConfigs.workflowMigrationResultsTableConfig.nextInstanceRevision.label", { defaultValue: "Next rev" }),
        type: "number",
        align: "right",
      },
    ],
    emptyMessage: t("workflows.migration.resultsEmpty", {
      defaultValue: "No migration results yet",
    }),
  },
})
