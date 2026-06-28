/** Tag string for SpacetimeDB algebraic enums (tagged or unit-variant SATS JSON). */
export function stbEnumTag(value: unknown): string {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if ("tag" in o) return String(o.tag)
    const keys = Object.keys(o)
    if (keys.length === 1 && Array.isArray(o[keys[0]!]) && (o[keys[0]!] as unknown[]).length === 0) {
      const k = keys[0]!
      return k.charAt(0).toUpperCase() + k.slice(1)
    }
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
