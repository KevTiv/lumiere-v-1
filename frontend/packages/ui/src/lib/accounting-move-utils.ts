/** Tag string for SpacetimeDB algebraic enums serialized as `{ tag: string }`. */
export function stbEnumTag(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: string }).tag)
  }
  return String(value ?? "")
}

/** Draft customer/vendor invoice or refund moves — valid for `compute_invoice_totals`. */
export function moveTypeIsInvoiceOrRefund(moveType: unknown): boolean {
  const t = stbEnumTag(moveType)
  return t === "OutInvoice" || t === "InInvoice" || t === "OutRefund" || t === "InRefund"
}

export function moveStateIsDraft(state: unknown): boolean {
  return stbEnumTag(state) === "Draft"
}
