/**
 * Choose post_invoice vs post_account_move and resolve COGS / inventory GL for invoice posting.
 */

export function enumTag(v: unknown): string {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if ('tag' in o) return String(o.tag)
    const keys = Object.keys(o)
    if (keys.length === 1 && Array.isArray(o[keys[0]]) && (o[keys[0]] as unknown[]).length === 0) {
      const k = keys[0]!
      return k.charAt(0).toUpperCase() + k.slice(1)
    }
  }
  return String(v ?? '')
}

export function moveTypeTagFromRow(row: Record<string, unknown>): string {
  return enumTag(row.moveType)
}

/** Customer/vendor invoice and refund document types (matches SpacetimeDB MoveType). */
export function isInvoiceLikeMoveType(mt: string): boolean {
  return (
    mt === 'OutInvoice' ||
    mt === 'InInvoice' ||
    mt === 'OutRefund' ||
    mt === 'InRefund'
  )
}

function accountGroupTag(a: Record<string, unknown>): string | undefined {
  const g = a.internalGroup
  if (g != null && typeof g === 'object' && 'tag' in g) return String((g as { tag: string }).tag)
  return undefined
}

/**
 * Picks default COGS (Expense) and inventory (non-bank Asset) accounts for `post_invoice`.
 * Returns null if the chart does not expose suitable rows (caller may still use 0,0 when no COGS applies).
 */
export function resolveDefaultCogsInventoryAccountIds(
  accounts: readonly Record<string, unknown>[],
): { cogsAccountId: number; inventoryAccountId: number } | null {
  const active = accounts.filter((a) => a.deprecated !== true && a.deprecated !== 1)
  const expenses = active.filter((a) => accountGroupTag(a) === 'Expense')
  const assets = active.filter(
    (a) => accountGroupTag(a) === 'Asset' && a.isBankAccount !== true && a.isBankAccount !== 1,
  )

  const byNameCode = (a: Record<string, unknown>) =>
    `${String(a.name ?? '')} ${String(a.code ?? '')}`.toLowerCase()

  const cogs =
    expenses.find((a) => {
      const s = byNameCode(a)
      return s.includes('cogs') || s.includes('cost of goods') || s.includes('cost of sales')
    }) ?? expenses[0]

  const inventory =
    assets.find((a) => {
      const s = byNameCode(a)
      return s.includes('inventory') || s.includes('stock') || s.includes('valuation')
    }) ?? assets[0]

  if (cogs?.id == null || inventory?.id == null) return null
  return {
    cogsAccountId: Number(cogs.id),
    inventoryAccountId: Number(inventory.id),
  }
}
