"use client"

import { useTableDensity } from "../hooks/use-table-density"
import { TableDensityControl } from "../composed/table-density-control"
import type { AccountMove } from "../lib/accounting-types"
import type { ModuleDataState } from "../lib/module-data-state"
import type { ReactNode } from "react"
import { BillIntakeReview } from "./bill-intake-review"
import type { BillIntakeLine } from "./bill-intake-review-model"
import {
  AccountingWorklistView,
  type AccountingWorklistProps,
} from "./accounting-worklist-view"

export interface BillsListViewProps extends AccountingWorklistProps {
  bills: AccountMove[]
  onSelectBill?: (bill: AccountMove) => void
  onCreateBill?: () => void
  onPayBill?: (bill: AccountMove) => void
  onRecalculateTotals?: (bill: AccountMove) => void
  intake?: { lines: readonly BillIntakeLine[]; sourceState: ModuleDataState; renderDocuments?: (bill: AccountMove) => ReactNode }
}

export function BillsListView({
  bills,
  onSelectBill,
  onCreateBill,
  onPayBill,
  intake,
  ...props
}: BillsListViewProps) {
  const [density, setDensity] = useTableDensity("accounting-bills-list")
  return (
    <div className="space-y-4 data-[density=compact]:[&_tbody_td]:py-1 data-[density=comfortable]:[&_tbody_td]:py-3 [&_td]:tabular-nums" data-density={density} data-testid="finance-money-list">
      <TableDensityControl value={density} onChange={setDensity} />
    <div className="space-y-4">
    {intake && props.worklistScope ? <BillIntakeReview organizationId={props.worklistScope.organizationId} companyId={props.worklistScope.companyId} bills={bills} lines={intake.lines} sourceState={intake.sourceState} onOpenBill={onSelectBill} renderDocuments={intake.renderDocuments} /> : null}
    <AccountingWorklistView
      {...props}
      kind="bill"
      rows={bills}
      onSelect={onSelectBill}
      onCreate={onCreateBill}
      onPay={onPayBill}
    />
    </div>
    </div>
  )
}
