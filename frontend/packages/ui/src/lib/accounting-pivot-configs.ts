import type { TFunction } from "i18next"
import { accountingJournalEntriesTableConfig } from "./accounting-entity-configs"
import { pivotConfig } from "./entity-state-board"
import type { EntityPivotConfig, EntityTableConfig } from "./entity-view-types"

/**
 * Pivot setup for the accounting invoices and bills lists: they are custom list views, so this
 * carries the column labels and filter options the pivot needs (reused from the journal entries
 * table) next to the pivot config itself.
 */
export function accountMovePivotSetup(t: TFunction): {
  table: EntityTableConfig
  pivot: EntityPivotConfig
} {
  const base = accountingJournalEntriesTableConfig(t).view as EntityTableConfig
  return {
    table: {
      ...base,
      columns: [
        ...base.columns,
        {
          key: "amountResidual",
          label: t("accounting.journalEntries.residual"),
          type: "currency",
          align: "right",
        },
      ],
    },
    pivot: pivotConfig(t, {
      groupKeys: ["state", "paymentState", "moveType"],
      measureKeys: ["amountTotal", "amountResidual"],
      currencyKey: "currencyId",
    }),
  }
}
