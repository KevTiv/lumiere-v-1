"use client"

import { useTableDensity } from "../hooks/use-table-density"
import { TableDensityControl } from "../composed/table-density-control"
import type { AccountMove } from "../lib/accounting-types"
import {
  AccountingWorklistView,
  type AccountingWorklistProps,
} from "./accounting-worklist-view"

export interface InvoiceListViewProps extends AccountingWorklistProps {
  invoices: AccountMove[]
  onSelectInvoice?: (invoice: AccountMove) => void
  onCreateInvoice?: () => void
  onRecalculateTotals?: (invoice: AccountMove) => void
}

export function InvoiceListView({
  invoices,
  onSelectInvoice,
  onCreateInvoice,
  ...props
}: InvoiceListViewProps) {
  const [density, setDensity] = useTableDensity("accounting-invoices-list")
  return (
    <div className="space-y-4 data-[density=compact]:[&_tbody_td]:py-1 data-[density=comfortable]:[&_tbody_td]:py-3 [&_td]:tabular-nums" data-density={density} data-testid="finance-money-list">
      <TableDensityControl value={density} onChange={setDensity} />
    <AccountingWorklistView
      {...props}
      kind="invoice"
      rows={invoices}
      onSelect={onSelectInvoice}
      onCreate={onCreateInvoice}
    />
    </div>
  )
}
