/**
 * Normalize SpacetimeDB enum JSON (tag, single-key object, or string) to a variant name.
 */
export function expenseVariantTag(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    if ('tag' in v && typeof (v as { tag: unknown }).tag === 'string') {
      return (v as { tag: string }).tag
    }
    const keys = Object.keys(v as object)
    if (keys.length === 1 && keys[0]) return keys[0]
  }
  return String(v)
}

export function mapExpenseRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    state: expenseVariantTag(row.state),
  }
}

export function mapExpenseSheetRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    state: expenseVariantTag(row.state),
  }
}

/** Sum `totalAmount` for expenses linked to a sheet (by id). */
export function sumExpenseAmountsForSheet(
  expenses: Record<string, unknown>[],
  sheetId: string | number | bigint,
): number {
  const sid = String(sheetId)
  return expenses.reduce((sum, e) => {
    const link = e.sheetId ?? e.sheet_id
    if (link == null || String(link) !== sid) return sum
    return sum + Number(e.totalAmount ?? e.total_amount ?? 0)
  }, 0)
}
