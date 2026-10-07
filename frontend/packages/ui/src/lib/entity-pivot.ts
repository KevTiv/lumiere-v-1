import type { EntityRow } from "./entity-view-types"
import { getRowField, unwrapEntityValue } from "./entity-row-values"

/** Count and per-measure sums of the rows in one pivot cell. */
export interface PivotCell {
  count: number
  sums: number[]
}

export interface PivotGroup {
  value: string
  label: string
}

export interface PivotRow extends PivotGroup {
  total: PivotCell
  /** Keyed by column group value; absent when no row falls in that cell. */
  cells: Record<string, PivotCell>
}

export interface PivotResult {
  rows: PivotRow[]
  columns: PivotGroup[]
  total: PivotCell
  /** Per column group total (the total row). */
  columnTotals: Record<string, PivotCell>
  /** Distinct currency values found on the rows; empty when the entity has no currency field. */
  currencies: string[]
  mixedCurrencies: boolean
}

export interface PivotInput {
  rows: readonly EntityRow[]
  rowKey: string
  columnKey?: string
  measureKeys: readonly string[]
  currencyKey?: string
  /** Display label for a group value of `key`; defaults to the raw value. */
  labelFor?: (key: string, value: string) => string
  /** Preferred order of group values per key (e.g. filter option order); others follow by label. */
  orderFor?: (key: string) => readonly string[] | undefined
}

/** Group value of a row field as text; empty when missing. */
export function pivotGroupValue(row: EntityRow, key: string): string {
  const value = unwrapEntityValue(getRowField(row, key))
  if (value == null) return ""
  return String(value)
}

/** Numeric value of a measure field; null for anything that is not a finite number. */
export function pivotMeasureValue(row: EntityRow, key: string): number | null {
  const value = unwrapEntityValue(getRowField(row, key))
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function emptyCell(measures: number): PivotCell {
  return { count: 0, sums: new Array<number>(measures).fill(0) }
}

function addTo(cell: PivotCell, measures: Array<number | null>) {
  cell.count += 1
  measures.forEach((value, index) => {
    if (value != null) cell.sums[index] = (cell.sums[index] ?? 0) + value
  })
}

function orderGroups(
  values: Iterable<string>,
  key: string,
  input: PivotInput,
): PivotGroup[] {
  const label = (value: string) => input.labelFor?.(key, value) ?? value
  const preferred = input.orderFor?.(key) ?? []
  const present = new Set(values)
  const known = preferred.filter((value) => present.has(value))
  const knownSet = new Set(known)
  const rest = [...present]
    .filter((value) => !knownSet.has(value))
    .sort((a, b) => {
      // Rows with no value go last.
      if (a === "" || b === "") return a === "" ? (b === "" ? 0 : 1) : -1
      return label(a).localeCompare(label(b), undefined, { numeric: true })
    })
  return [...known, ...rest].map((value) => ({ value, label: label(value) }))
}

/** Groups rows by one field (and optionally a second one) and sums the measure fields. */
export function buildPivot(input: PivotInput): PivotResult {
  const { rows, rowKey, columnKey, measureKeys, currencyKey } = input
  const measureCount = measureKeys.length

  const total = emptyCell(measureCount)
  const rowCells = new Map<string, PivotCell>()
  const cells = new Map<string, Record<string, PivotCell>>()
  const columnTotals = new Map<string, PivotCell>()
  const currencies = new Set<string>()

  for (const row of rows) {
    const measures = measureKeys.map((key) => pivotMeasureValue(row, key))
    const group = pivotGroupValue(row, rowKey)
    const column = columnKey ? pivotGroupValue(row, columnKey) : undefined

    addTo(total, measures)
    if (!rowCells.has(group)) rowCells.set(group, emptyCell(measureCount))
    addTo(rowCells.get(group)!, measures)

    if (column !== undefined) {
      const byColumn = cells.get(group) ?? {}
      cells.set(group, byColumn)
      byColumn[column] ??= emptyCell(measureCount)
      addTo(byColumn[column], measures)
      if (!columnTotals.has(column)) columnTotals.set(column, emptyCell(measureCount))
      addTo(columnTotals.get(column)!, measures)
    }

    if (currencyKey) {
      const currency = pivotGroupValue(row, currencyKey)
      if (currency) currencies.add(currency)
    }
  }

  return {
    rows: orderGroups(rowCells.keys(), rowKey, input).map((group) => ({
      ...group,
      total: rowCells.get(group.value)!,
      cells: cells.get(group.value) ?? {},
    })),
    columns: columnKey ? orderGroups(columnTotals.keys(), columnKey, input) : [],
    total,
    columnTotals: Object.fromEntries(columnTotals),
    currencies: [...currencies].sort(),
    mixedCurrencies: currencies.size > 1,
  }
}
