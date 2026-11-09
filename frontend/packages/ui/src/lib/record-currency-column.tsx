import { formatInvoiceMoney } from "../accounting-components/invoice-document"
import { useCurrencyFormat } from "./currency-context"
import { entityColumnLayouts } from "./entity-column-layouts"
import {
  entityScalarText,
  getRowField,
  unwrapEntityValue,
} from "./entity-row-values"
import type { EntityColumn } from "./entity-view-types"

function RecordMoney({
  value,
  currency,
}: {
  value: unknown
  currency: unknown
}) {
  const format = useCurrencyFormat()
  const raw = unwrapEntityValue(value)
  return (
    <span className="tabular-nums [overflow-wrap:anywhere]">
      {formatInvoiceMoney(typeof raw === "number" ? raw : undefined, {
        code: format.codeFor(currency),
        id: entityScalarText(currency) ?? undefined,
      })}
    </span>
  )
}

/** Currency on these records is authoritative; an unresolved lookup never implies company currency. */
export function recordCurrencyColumn(key: string, label: string): EntityColumn {
  return {
    key,
    label,
    type: "currency",
    currencyKey: "currencyId",
    align: "right",
    layout: entityColumnLayouts.amount,
    render: (value, row) => (
      <RecordMoney value={value} currency={getRowField(row, "currencyId")} />
    ),
  }
}
