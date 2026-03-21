import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

export const proposalsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "proposals-table",
  title: t("proposals.proposals.title"),
  description: t("proposals.proposals.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("proposals.proposals.searchPlaceholder"),
    searchKeys: ["title", "clientName"],
    filters: [
      {
        key: "status",
        label: t("proposals.proposals.filters.status"),
        type: "select",
        options: [
          { value: "Draft", label: t("proposals.proposals.filters.status.options.Draft") },
          { value: "Review", label: t("proposals.proposals.filters.status.options.Review") },
          { value: "Submitted", label: t("proposals.proposals.filters.status.options.Submitted") },
          { value: "Awarded", label: t("proposals.proposals.filters.status.options.Awarded") },
          { value: "Rejected", label: t("proposals.proposals.filters.status.options.Rejected") },
          { value: "Archived", label: t("proposals.proposals.filters.status.options.Archived") },
        ],
      },
    ],
    columns: [
      { key: "title", label: t("proposals.proposals.columns.title"), width: "min-w-48" },
      { key: "clientName", label: t("proposals.proposals.columns.clientName"), width: "min-w-36" },
      {
        key: "status",
        label: t("proposals.proposals.columns.status"),
        type: "badge",
        badgeVariants: {
          Draft: "secondary",
          Review: "outline",
          Submitted: "default",
          Awarded: "default",
          Rejected: "destructive",
          Archived: "secondary",
        },
        badgeLabels: {
          Draft: t("proposals.proposals.states.Draft"),
          Review: t("proposals.proposals.states.Review"),
          Submitted: t("proposals.proposals.states.Submitted"),
          Awarded: t("proposals.proposals.states.Awarded"),
          Rejected: t("proposals.proposals.states.Rejected"),
          Archived: t("proposals.proposals.states.Archived"),
        },
      },
      { key: "value", label: t("proposals.proposals.columns.value"), type: "currency", align: "right", width: "min-w-28" },
      { key: "deadline", label: t("proposals.proposals.columns.deadline"), type: "date", width: "min-w-28" },
      { key: "ownerId", label: t("proposals.proposals.columns.ownerId"), width: "min-w-28" },
      { key: "versionCount", label: t("proposals.proposals.columns.versionCount"), type: "number", align: "right", width: "min-w-20" },
      { key: "writeDate", label: t("proposals.proposals.columns.writeDate"), type: "date", width: "min-w-32" },
    ],
    emptyMessage: t("proposals.proposals.emptyMessage"),
  },
})

export const proposalTemplatesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "proposal-templates-table",
  title: t("proposals.templates.title"),
  description: t("proposals.templates.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("proposals.templates.searchPlaceholder"),
    searchKeys: ["name", "category", "description"],
    columns: [
      { key: "name", label: t("proposals.templates.columns.name"), width: "min-w-40" },
      { key: "category", label: t("proposals.templates.columns.category"), width: "min-w-28" },
      { key: "sectionCount", label: t("proposals.templates.columns.sectionCount"), type: "number", align: "right", width: "min-w-20" },
      { key: "description", label: t("proposals.templates.columns.description"), width: "min-w-48" },
      { key: "usageCount", label: t("proposals.templates.columns.usageCount"), type: "number", align: "right", width: "min-w-16" },
      { key: "createdAt", label: t("proposals.templates.columns.createdAt"), type: "date", width: "min-w-28" },
    ],
    emptyMessage: t("proposals.templates.emptyMessage"),
  },
})

export const proposalsEntityConfigs = (t: TFunction) => ({
  [proposalsTableConfig(t).id]: proposalsTableConfig(t),
  [proposalTemplatesTableConfig(t).id]: proposalTemplatesTableConfig(t),
})
