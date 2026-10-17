"use client"

import type { AccountMove } from "../lib/accounting-types"
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
}

export function BillsListView({
  bills,
  onSelectBill,
  onCreateBill,
  onPayBill,
  ...props
}: BillsListViewProps) {
  return (
    <AccountingWorklistView
      {...props}
      kind="bill"
      rows={bills}
      onSelect={onSelectBill}
      onCreate={onCreateBill}
      onPay={onPayBill}
    />
  )
}
