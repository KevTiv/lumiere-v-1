/** Pure invoice totals shared by the composer form and its live preview. */

export interface InvoiceMathTax {
  label: string
  amount: number
  amountType: "Percent" | "Fixed" | "Division"
}

export interface InvoiceMathLine {
  quantity: number
  unitPrice: number
  /** Percent, 0..100. */
  discount: number
  tax?: InvoiceMathTax
}

/** Net amount of a line after its discount. */
export function lineSubtotal(line: InvoiceMathLine): number {
  const net = line.quantity * line.unitPrice * (1 - line.discount / 100)
  return Number.isFinite(net) ? net : 0
}

/** Tax charged on a net amount. */
export function taxOnAmount(subtotal: number, tax?: InvoiceMathTax): number {
  if (!tax) return 0
  if (tax.amountType === "Fixed") return tax.amount
  if (tax.amountType === "Division") return tax.amount < 100 ? subtotal / (1 - tax.amount / 100) - subtotal : 0
  return (subtotal * tax.amount) / 100
}

export interface InvoiceTotals {
  subtotal: number
  tax: number
  total: number
  /** Tax per tax label, for the totals block. */
  taxBreakdown: Array<{ label: string; amount: number }>
}

export function invoiceTotals(lines: readonly InvoiceMathLine[]): InvoiceTotals {
  let subtotal = 0
  let tax = 0
  const byLabel = new Map<string, number>()
  for (const line of lines) {
    const net = lineSubtotal(line)
    const lineTax = taxOnAmount(net, line.tax)
    subtotal += net
    tax += lineTax
    if (line.tax && lineTax !== 0) byLabel.set(line.tax.label, (byLabel.get(line.tax.label) ?? 0) + lineTax)
  }
  return {
    subtotal,
    tax,
    total: subtotal + tax,
    taxBreakdown: [...byLabel.entries()].map(([label, amount]) => ({ label, amount })),
  }
}
