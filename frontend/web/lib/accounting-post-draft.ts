/**
 * Choose post_invoice vs post_account_move and resolve COGS / inventory GL for invoice posting.
 */

function unitVariantTag(key: string): string {
  if (!key) return ''
  return key.charAt(0).toUpperCase() + key.slice(1)
}

const KNOWN_ENUM_TAGS: Record<string, string> = {
  out_invoice: 'OutInvoice',
  outInvoice: 'OutInvoice',
  in_invoice: 'InInvoice',
  inInvoice: 'InInvoice',
  out_refund: 'OutRefund',
  outRefund: 'OutRefund',
  in_refund: 'InRefund',
  inRefund: 'InRefund',
}

export function enumTag(v: unknown): string {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if ('tag' in o) return String(o.tag)
    const keys = Object.keys(o)
    if (keys.length === 1) {
      const val = o[keys[0]!]
      if (Array.isArray(val) && val.length === 0) {
        return unitVariantTag(keys[0]!)
      }
      if (val != null && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) {
        return unitVariantTag(keys[0]!)
      }
    }
  }
  const raw = String(v ?? '')
  return KNOWN_ENUM_TAGS[raw] ?? raw
}

export function moveTypeTagFromRow(row: Record<string, unknown>): string {
  return enumTag(row.moveType ?? row.move_type)
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
  const tag = enumTag(a.internalGroup ?? a.internal_group)
  return tag || undefined
}

function isBankAccountRow(a: Record<string, unknown>): boolean {
  const v = a.isBankAccount ?? a.is_bank_account
  return v === true || v === 1
}

/**
 * Picks default COGS (Expense) and inventory (non-bank Asset) accounts for `post_invoice`.
 * Returns null if the chart does not expose suitable rows (OutInvoice UI aborts post when null).
 */
export function resolveDefaultCogsInventoryAccountIds(
  accounts: readonly Record<string, unknown>[],
): { cogsAccountId: number; inventoryAccountId: number } | null {
  const active = accounts.filter((a) => a.deprecated !== true && a.deprecated !== 1)
  const expenses = active.filter((a) => accountGroupTag(a) === 'Expense')
  const assets = active.filter(
    (a) => accountGroupTag(a) === 'Asset' && !isBankAccountRow(a),
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
