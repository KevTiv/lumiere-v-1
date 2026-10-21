"use client"

import type { AccountMove } from "../lib/accounting-types"
import {
  AccountingWorklistView,
  type AccountingWorklistProps,
} from "./accounting-worklist-view"

export interface InvoiceListViewProps extends AccountingWorklistProps {
  invoices: AccountMove[]
  onSelectInvoice?: (invoice: AccountMove) => void
  onCreateInvoice?: () => void
  onSendInvoice?: (invoice: AccountMove) => void
  onDownloadPdf?: (invoice: AccountMove) => void
  onRecalculateTotals?: (invoice: AccountMove) => void
}

export function InvoiceListView({
  invoices,
  onSelectInvoice,
  onCreateInvoice,
  onSendInvoice,
  onDownloadPdf,
  ...props
}: InvoiceListViewProps) {
  return (
    <AccountingWorklistView
      {...props}
      kind="invoice"
      rows={invoices}
      onSelect={onSelectInvoice}
      onCreate={onCreateInvoice}
      onSend={onSendInvoice}
      onDownload={onDownloadPdf}
    />
  )
}
