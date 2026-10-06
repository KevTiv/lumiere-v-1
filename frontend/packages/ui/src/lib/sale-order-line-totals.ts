/** The figures of a sale order line that a user can edit before saving. */
export interface LineEdit {
  quantity?: number
  priceUnit?: number
  discount?: number
}

export interface LineAmounts {
  subtotal: number
  tax: number
  total: number
}

type LineRow = Record<string, unknown>

function figure(row: LineRow, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(row[key])
    if (row[key] != null && Number.isFinite(value)) return value
  }
  return 0
}

/** Round to cents the way an invoice shows them. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * What a line comes to: its saved amounts, or, when part of it is being edited, the amounts those
 * edits would give. Tax keeps the line's own rate (tax over subtotal), because which taxes apply
 * is decided on the server; a line with no saved subtotal has no known rate and so no tax.
 */
export function lineAmounts(row: LineRow, edit?: LineEdit): LineAmounts {
  const savedSubtotal = figure(row, "priceSubtotal", "price_subtotal")
  const savedTax = figure(row, "priceTax", "price_tax")
  if (!edit || (edit.quantity == null && edit.priceUnit == null && edit.discount == null)) {
    return { subtotal: savedSubtotal, tax: savedTax, total: savedSubtotal + savedTax }
  }
  const quantity = edit.quantity ?? figure(row, "productUomQty", "product_uom_qty")
  const priceUnit = edit.priceUnit ?? figure(row, "priceUnit", "price_unit")
  const discount = edit.discount ?? figure(row, "discount")
  const subtotal = roundMoney(quantity * priceUnit * (1 - discount / 100))
  const rate = savedSubtotal > 0 ? savedTax / savedSubtotal : 0
  const tax = roundMoney(subtotal * rate)
  return { subtotal, tax, total: roundMoney(subtotal + tax) }
}

export interface OrderTotals extends LineAmounts {
  /** True when any figure includes an unsaved edit. */
  estimated: boolean
}

/** Order totals from its lines, with unsaved edits (keyed by line id) taken into account. */
export function orderTotals(lines: ReadonlyArray<LineRow>, edits: Readonly<Record<string, LineEdit>> = {}): OrderTotals {
  let subtotal = 0
  let tax = 0
  let estimated = false
  for (const line of lines) {
    const edit = edits[String(line.id)]
    const amounts = lineAmounts(line, edit)
    if (edit && (edit.quantity != null || edit.priceUnit != null || edit.discount != null)) estimated = true
    subtotal += amounts.subtotal
    tax += amounts.tax
  }
  return { subtotal: roundMoney(subtotal), tax: roundMoney(tax), total: roundMoney(subtotal + tax), estimated }
}
