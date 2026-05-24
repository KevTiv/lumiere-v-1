/**
 * Map modular form values → SpacetimeDB reducer bodies for purchasing `/api/call/*`.
 */

/** Params for `add_purchase_order_line` (third argument). */
export function toAddPurchaseOrderLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const orderId = formData.orderId
  const productId = formData.productId
  const uomId = formData.uomId
  const quantity = Number(formData.quantity)
  const priceUnit = Number(formData.priceUnit)
  if (
    orderId === "" ||
    orderId == null ||
    productId === "" ||
    productId == null ||
    uomId === "" ||
    uomId == null ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(priceUnit) ||
    priceUnit < 0
  ) {
    return null
  }
  return {
    productId: Number(productId),
    quantity,
    uomId: Number(uomId),
    priceUnit,
  }
}

export function toReceivePoLineArgs(formData: Record<string, unknown>): {
  lineId: number
  qty: number
} | null {
  const lineId = Number(formData.lineId)
  const qty = Number(formData.qty)
  if (!Number.isFinite(lineId) || lineId <= 0 || !Number.isFinite(qty) || qty <= 0) return null
  return { lineId, qty }
}

export function toInvoicePoLineArgs(formData: Record<string, unknown>): {
  lineId: number
  qty: number
} | null {
  return toReceivePoLineArgs(formData)
}

/** Params for `update_purchase_order_line` (optional fields — only sent when set). */
export function toUpdatePurchaseOrderLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const lineId = formData.lineId
  if (lineId === "" || lineId == null) return null

  const quantity = Number(formData.quantity)
  const priceUnit = Number(formData.priceUnit)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  if (!Number.isFinite(priceUnit) || priceUnit < 0) return null

  const productId = formData.productId
  const uomId = formData.uomId
  const productIdValue = productId !== "" && productId != null ? Number(productId) : undefined
  const uomIdValue = uomId !== "" && uomId != null ? Number(uomId) : undefined

  return {
    quantity,
    priceUnit,
    taxIds: [] as number[],
    productId: productIdValue,
    uomId: uomIdValue,
  }
}
