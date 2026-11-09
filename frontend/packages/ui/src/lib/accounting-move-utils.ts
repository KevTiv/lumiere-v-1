import { entityEnumTag } from "./entity-row-values"

/** Parse SpacetimeDB timestamp objects from HTTP SQL (micros may be number or bigint). */
export function microsSinceEpochToDate(
  ts?: { microsSinceUnixEpoch?: bigint | number | string | null } | null,
): Date | null {
  if (ts == null || typeof ts !== "object") return null
  const raw = ts.microsSinceUnixEpoch
  if (raw == null) return null
  const micros = typeof raw === "bigint" ? raw : BigInt(String(raw))
  if (micros === 0n) return null
  return new Date(Number(micros / 1000n))
}

/** Tag string for SpacetimeDB algebraic enums (tagged or unit-variant SATS JSON). */
export function stbEnumTag(value: unknown): string {
  const raw = entityEnumTag(value)
  if (raw == null) return ""
  switch (raw.replaceAll("_", "").toLowerCase()) {
    case "outinvoice":
      return "OutInvoice"
    case "ininvoice":
      return "InInvoice"
    case "outrefund":
      return "OutRefund"
    case "inrefund":
      return "InRefund"
    case "internaltransfer":
      return "InternalTransfer"
    case "entry":
      return "Entry"
    case "posted":
      return "Posted"
    case "draft":
      return "Draft"
    case "cancel":
    case "canceled":
    case "cancelled":
      return "Cancelled"
    case "notpaid":
      return "NotPaid"
    case "inpayment":
      return "InPayment"
    case "paid":
      return "Paid"
    case "partial":
      return "Partial"
    case "reversed":
      return "Reversed"
    case "invoicinglegacy":
      return "InvoicingLegacy"
    default:
      return raw
  }
}

/** Draft customer/vendor invoice or refund moves — valid for `compute_invoice_totals`. */
export function moveTypeIsInvoiceOrRefund(moveType: unknown): boolean {
  const t = stbEnumTag(moveType)
  return (
    t === "OutInvoice" ||
    t === "InInvoice" ||
    t === "OutRefund" ||
    t === "InRefund"
  )
}

export function moveStateIsDraft(state: unknown): boolean {
  return stbEnumTag(state) === "Draft"
}
