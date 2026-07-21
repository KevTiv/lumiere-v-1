import type { TFunction } from "i18next"
import { createElement } from "react"
import type { EntityViewConfig } from "./entity-view-types"

export type ProposalsTableConfigOptions = {
  /** Primary label for the title column (title / client / name fallbacks). */
  formatProposalDisplayName?: (row: Record<string, unknown>) => string
}

export const proposalsTableConfig = (
  t: TFunction,
  options?: ProposalsTableConfigOptions & { actions?: import("./entity-view-types").EntityAction[] },
): EntityViewConfig => {
  const formatName = options?.formatProposalDisplayName
  const actions = options?.actions

  const titleColumn = {
    key: "title",
    label: t("proposals.proposals.columns.title"),
    width: "min-w-48",
    ...(formatName
      ? {
          render: (_value: unknown, row: Record<string, unknown>) => {
            const formatted = formatName(row).trim()
            const fallback = String(row.title ?? "").trim()
            const shown = formatted || fallback
            if (!shown)
              return createElement(
                "span",
                { className: "text-muted-foreground" },
                "—",
              )
            return shown
          },
        }
      : {}),
  }

  return {
    id: "proposals-table",
    title: t("proposals.proposals.title"),
    description: t("proposals.proposals.description"),
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("proposals.proposals.searchPlaceholder"),
      searchKeys: ["title", "clientName", "client_name", "name"],
      filters: [
        {
          key: "status",
          label: t("proposals.proposals.filters.status.label"),
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
        titleColumn,
        {
          key: "clientName",
          label: t("proposals.proposals.columns.clientName"),
          width: "min-w-36",
        },
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
        {
          key: "value",
          label: t("proposals.proposals.columns.value"),
          type: "currency",
          align: "right",
          width: "min-w-28",
        },
        {
          key: "deadline",
          label: t("proposals.proposals.columns.deadline"),
          type: "date",
          width: "min-w-28",
        },
        {
          key: "ownerId",
          label: t("proposals.proposals.columns.ownerId"),
          width: "min-w-28",
        },
        {
          key: "versionCount",
          label: t("proposals.proposals.columns.versionCount"),
          type: "number",
          align: "right",
          width: "min-w-20",
        },
        {
          key: "saleOrderId",
          label: t("proposals.proposals.columns.saleOrderId", { defaultValue: "Sale order" }),
          width: "min-w-24",
        },
        {
          key: "projectId",
          label: t("proposals.proposals.columns.projectId", { defaultValue: "Project" }),
          width: "min-w-24",
        },
        {
          key: "writeDate",
          label: t("proposals.proposals.columns.writeDate"),
          type: "date",
          width: "min-w-32",
        },
      ],
      emptyMessage: t("proposals.proposals.emptyMessage"),
      ...(actions?.length ? { actions, rowSelectionToggleOnClick: true } : {}),
    },
  }
}

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
