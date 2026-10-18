import { moveTypeIsInvoiceOrRefund, microsSinceEpochToDate } from "../lib/accounting-move-utils"
import type { AccountMove } from "../lib/accounting-types"
import type { InvoicePreviewLine, InvoicePreviewModel } from "./invoice-preview"

function dayInput(value: unknown): string | undefined {
  const date = microsSinceEpochToDate(value as Parameters<typeof microsSinceEpochToDate>[0])
  return date ? date.toISOString().slice(0, 10) : undefined
}

function tagOf(value: unknown): string {
  return value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: string }).tag)
    : String(value ?? "")
}

/** The preview sheet of a saved invoice or bill, from its move row and (optionally) its lines. */
export function invoicePreviewModelFromMove(
  move: AccountMove,
  lines: InvoicePreviewLine[] = [],
  options: { currencyCode?: string; statusLabel?: string; notes?: string } = {},
): InvoicePreviewModel {
  const subtotal = move.amountUntaxed ?? 0
  const tax = move.amountTax ?? 0
  const moveType = tagOf(move.moveType)
  return {
    kind: moveType === "InInvoice" || moveType === "InRefund" ? "bill" : "invoice",
    number: move.name || undefined,
    statusLabel: options.statusLabel,
    partnerName: move.invoicePartnerDisplayName ?? (move.partnerId != null ? `Partner #${String(move.partnerId)}` : undefined),
    invoiceDate: dayInput(move.invoiceDate ?? move.date),
    dueDate: dayInput(move.invoiceDateDue),
    reference: move.ref ?? undefined,
    currencyCode: options.currencyCode,
    lines,
    totals: { subtotal, tax, total: move.amountTotal ?? subtotal + tax, taxBreakdown: [] },
    amountDue: moveTypeIsInvoiceOrRefund(move.moveType) ? (move.amountResidual ?? undefined) : undefined,
    notes: options.notes,
  }
}
