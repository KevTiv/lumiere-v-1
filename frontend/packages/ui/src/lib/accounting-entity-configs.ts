import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const assetStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Open: "default",
    Close: "outline",
  },
  badgeLabels: {
    Draft: t("accounting.entities.fixedAssets.states.Draft"),
    Open: t("accounting.entities.fixedAssets.states.Open"),
    Close: t("accounting.entities.fixedAssets.states.Close"),
  },
}) as const

const bankStatementStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Open: "outline",
    Posted: "default",
    Confirm: "default",
  },
  badgeLabels: {
    Open: t("accounting.entities.bankStatements.states.Open"),
    Posted: t("accounting.entities.bankStatements.states.Posted"),
    Confirm: t("accounting.entities.bankStatements.states.Confirm"),
  },
}) as const

// ── Bank Statements ───────────────────────────────────────────────────────────
export const bankStatementsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "bank-statements-table",
  title: t("accounting.entities.bankStatements.title"),
  description: t("accounting.entities.bankStatements.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.bankStatements.searchPlaceholder"),
    searchKeys: ["name", "reference"],
    filters: [
      {
        key: "state",
        label: t("accounting.entities.bankStatements.filters.state"),
        type: "select",
        options: [
          { value: "Open", label: t("accounting.entities.bankStatements.filters.state.options.Open") },
          { value: "Posted", label: t("accounting.entities.bankStatements.filters.state.options.Posted") },
          { value: "Confirm", label: t("accounting.entities.bankStatements.filters.state.options.Confirm") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.bankStatements.columns.name"), width: "min-w-32" },
      { key: "journalId", label: t("accounting.entities.bankStatements.columns.journalId"), width: "min-w-32" },
      { key: "state", label: t("accounting.entities.bankStatements.columns.state"), type: "badge", ...bankStatementStateBadges(t) },
      { key: "date", label: t("accounting.entities.bankStatements.columns.date"), type: "date" },
      { key: "balanceStart", label: t("accounting.entities.bankStatements.columns.balanceStart"), type: "currency", align: "right" },
      { key: "balanceEndReal", label: t("accounting.entities.bankStatements.columns.balanceEndReal"), type: "currency", align: "right" },
      { key: "lineIds", label: t("accounting.entities.bankStatements.columns.lineIds"), type: "number", align: "right" },
    ],
    emptyMessage: t("accounting.entities.bankStatements.emptyMessage"),
  },
})

// ── Fixed Assets ──────────────────────────────────────────────────────────────
export const fixedAssetsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "fixed-assets-table",
  title: t("accounting.entities.fixedAssets.title"),
  description: t("accounting.entities.fixedAssets.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.fixedAssets.searchPlaceholder"),
    searchKeys: ["name", "codePrefix"],
    filters: [
      {
        key: "state",
        label: t("accounting.entities.fixedAssets.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("accounting.entities.fixedAssets.filters.state.options.Draft") },
          { value: "Open", label: t("accounting.entities.fixedAssets.filters.state.options.Open") },
          { value: "Close", label: t("accounting.entities.fixedAssets.filters.state.options.Close") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.fixedAssets.columns.name"), width: "min-w-48" },
      { key: "state", label: t("accounting.entities.fixedAssets.columns.state"), type: "badge", ...assetStateBadges(t) },
      { key: "acquisitionDate", label: t("accounting.entities.fixedAssets.columns.acquisitionDate"), type: "date" },
      { key: "originalValue", label: t("accounting.entities.fixedAssets.columns.originalValue"), type: "currency", align: "right" },
      { key: "bookValue", label: t("accounting.entities.fixedAssets.columns.bookValue"), type: "currency", align: "right" },
      { key: "depreciatedValue", label: t("accounting.entities.fixedAssets.columns.depreciatedValue"), type: "currency", align: "right" },
      { key: "methodNumberMonth", label: t("accounting.entities.fixedAssets.columns.methodNumberMonth"), type: "number", align: "right" },
    ],
    emptyMessage: t("accounting.entities.fixedAssets.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const accountingEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "bank-statements-table": bankStatementsTableConfig(t),
  "fixed-assets-table": fixedAssetsTableConfig(t),
})
