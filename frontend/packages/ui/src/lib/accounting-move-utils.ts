function unitVariantTag(key: string): string {
  if (!key) return ""
  return key.charAt(0).toUpperCase() + key.slice(1)
}

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
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if ("tag" in o) return String(o.tag)
    const keys = Object.keys(o)
    if (keys.length === 1) {
      const val = o[keys[0]!]
      if (Array.isArray(val) && val.length === 0) {
        return unitVariantTag(keys[0]!)
      }
      if (val != null && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0) {
        return unitVariantTag(keys[0]!)
      }
    }
  }
  const raw = String(value ?? "")
  if (raw === "out_invoice" || raw === "outInvoice") return "OutInvoice"
  if (raw === "in_invoice" || raw === "inInvoice") return "InInvoice"
  if (raw === "out_refund" || raw === "outRefund") return "OutRefund"
  if (raw === "in_refund" || raw === "inRefund") return "InRefund"
  return raw
}

/** Draft customer/vendor invoice or refund moves — valid for `compute_invoice_totals`. */
export function moveTypeIsInvoiceOrRefund(moveType: unknown): boolean {
  const t = stbEnumTag(moveType)
  return t === "OutInvoice" || t === "InInvoice" || t === "OutRefund" || t === "InRefund"
}

export function moveStateIsDraft(state: unknown): boolean {
  return stbEnumTag(state) === "Draft"
}
