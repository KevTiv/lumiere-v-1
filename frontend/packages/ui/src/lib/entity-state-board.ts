import type { TFunction } from "i18next"
import type {
  EntityBoardCardConfig,
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
  options: { groupKey: string; rowKey?: string; card: EntityBoardCardConfig },
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
      },
      viewToggleLabels: {
        table: t("common.entityView.table", { defaultValue: "Table" }),
        board: t("common.entityView.board", { defaultValue: "Board" }),
        ariaLabel: t("common.entityView.toggleLabel", { defaultValue: "Switch view" }),
      },
      defaultView: "table",
    },
  }
}
