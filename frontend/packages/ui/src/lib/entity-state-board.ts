import type { TFunction } from "i18next"
import type {
  EntityBoardCardConfig,
  EntityPivotConfig,
  EntityTableConfig,
  EntityViewConfig,
} from "./entity-view-types"

/**
 * Turns a plain table entity into a table / read-only board hybrid grouped by
 * its state column. Board columns are derived from that column's badge labels
 * (see EntityView), so there is no drag and drop: a state machine entity must
 * only change state through its workflow actions.
 */
export function withReadOnlyStateBoard(
  t: TFunction,
  config: EntityViewConfig,
  options: {
    groupKey: string
    rowKey?: string
    card: EntityBoardCardConfig
    /** Also offers a pivot (summary) view in the toggle. */
    pivot?: Pick<EntityPivotConfig, "groupKeys" | "measureKeys" | "currencyKey">
  },
): EntityViewConfig {
  if (config.view.mode !== "table") return config
  const table: EntityTableConfig = config.view
  return {
    ...config,
    view: {
      mode: "table-or-board",
      table,
      board: {
        groupKey: options.groupKey,
        rowKey: options.rowKey ?? table.rowKey ?? "id",
        card: options.card,
        emptyColumnMessage: t("common.entityView.emptyColumn", { defaultValue: "No records" }),
        otherColumnLabel: t("common.entityView.otherColumn", { defaultValue: "Other" }),
        searchPlaceholder: t("common.entityView.boardSearch", { defaultValue: "Search cards" }),
      },
      viewToggleLabels: {
        table: t("common.entityView.table", { defaultValue: "Table" }),
        board: t("common.entityView.board", { defaultValue: "Board" }),
        ...(options.pivot
          ? { pivot: t("common.entityView.pivot", { defaultValue: "Summary" }) }
          : {}),
        ariaLabel: t("common.entityView.toggleLabel", { defaultValue: "Switch view" }),
      },
      ...(options.pivot ? { pivot: pivotConfig(t, options.pivot) } : {}),
      defaultView: "table",
    },
  }
}

/** Pivot config with its labels; shared by the board hybrid and custom list views. */
export function pivotConfig(
  t: TFunction,
  pivot: Pick<EntityPivotConfig, "groupKeys" | "measureKeys" | "currencyKey">,
): EntityPivotConfig {
  return {
    ...pivot,
    labels: {
      groupBy: t("common.entityView.pivotGroupBy", { defaultValue: "Group by" }),
      columnsBy: t("common.entityView.pivotColumnsBy", { defaultValue: "Columns" }),
      none: t("common.entityView.pivotNone", { defaultValue: "None" }),
      count: t("common.entityView.pivotCount", { defaultValue: "Count" }),
      total: t("common.entityView.pivotTotal", { defaultValue: "Total" }),
      empty: t("common.entityView.pivotEmpty", { defaultValue: "Not set" }),
      noData: t("common.entityView.pivotNoData", { defaultValue: "No records to summarise" }),
      mixedCurrencies: (currencies) =>
        t("common.entityView.pivotMixedCurrencies", {
          defaultValue:
            "These records use more than one currency ({{currencies}}). Totals add the amounts as they are, without converting.",
          currencies: currencies.join(", "),
        }),
      chartTitle: (measure) =>
        t("common.entityView.pivotChartTitle", { defaultValue: "{{measure}} by group", measure }),
      exportCsv: t("common.entityView.pivotExportCsv", { defaultValue: "Export CSV" }),
    },
  }
}
