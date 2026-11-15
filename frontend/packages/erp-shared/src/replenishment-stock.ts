import { getRowField, type RowValueMap } from "./row-values"
import { parseStrictU64 } from "./u64"

interface StockScope {
  organizationId: bigint
  companyId: number | bigint | null
}

export function inventoryQuantity(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined
  const quantity = Number(value)
  return Number.isFinite(quantity) ? quantity : undefined
}

export function scopedStockRows<Row extends object>(rows: readonly Row[], scope: StockScope): Row[] {
  const companyId = parseStrictU64(scope.companyId)
  if (!companyId || scope.organizationId <= 0n) return []
  return rows.filter((row) => {
    const fields = row as RowValueMap
    return parseStrictU64(getRowField(fields, "organizationId")) === scope.organizationId
      && parseStrictU64(getRowField(fields, "companyId")) === companyId
  })
}

function stockKey(row: RowValueMap): string | undefined {
  const product = parseStrictU64(getRowField(row, "productId"))
  const location = parseStrictU64(getRowField(row, "locationId"))
  return product && location ? `${product}:${location}` : undefined
}

export interface StockReorderEntry<Row> {
  key: string
  productId: string
  locationId: string
  available: number
  minimum?: number
  reason: "zero-stock" | "below-minimum"
  rows: Row[]
}

/** Reconcile exact product/location rules with all lots at that location. */
export function stockReorderQueue<Row extends object>(
  quants: readonly Row[],
  rules: readonly object[],
  scope: StockScope,
): { entries: StockReorderEntry<Row>[]; incomplete: number } {
  const positions = new Map<string, { rows: Row[]; available: number; minimum?: number; incomplete: boolean }>()
  let incomplete = 0
  for (const row of scopedStockRows(quants, scope)) {
    const fields = row as RowValueMap
    const key = stockKey(fields)
    if (key == null) {
      incomplete++
      continue
    }
    const position = positions.get(key) ?? { rows: [], available: 0, incomplete: false }
    const available = inventoryQuantity(getRowField(fields, "availableQuantity"))
    position.rows.push(row)
    if (available == null) position.incomplete = true
    else position.available += Math.max(0, available)
    positions.set(key, position)
  }

  for (const row of scopedStockRows(rules, scope)) {
    const fields = row as RowValueMap
    const active = getRowField(fields, "active")
    if (active === false) continue
    const key = stockKey(fields)
    const minimum = inventoryQuantity(getRowField(fields, "productMinQty"))
    if (active !== true || key == null || minimum == null || minimum < 0) {
      incomplete++
      continue
    }
    const position = positions.get(key) ?? { rows: [], available: 0, incomplete: false }
    position.minimum = Math.max(position.minimum ?? 0, minimum)
    positions.set(key, position)
  }

  const entries: StockReorderEntry<Row>[] = []
  for (const [key, position] of positions) {
    if (position.incomplete) {
      incomplete++
      continue
    }
    const { rows, available, minimum } = position
    const reason = available === 0 ? "zero-stock" : minimum != null && available + 1e-9 < minimum ? "below-minimum" : undefined
    if (!reason || (rows.length === 0 && minimum === 0)) continue
    const [productId, locationId] = key.split(":")
    entries.push({ key, productId: productId!, locationId: locationId!, available, minimum, reason, rows })
  }
  return { entries, incomplete }
}
