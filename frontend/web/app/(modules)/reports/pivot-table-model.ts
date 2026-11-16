import type { EntityRow } from "@lumiere/ui/lib/entity-view-types"

type PivotValue = string | number
type PivotMeasureOp = "sum" | "avg" | "min" | "max" | "count"

export function pivotMeasureOp(value: unknown): PivotMeasureOp {
  switch (value) {
    case "avg":
    case "min":
    case "max":
    case "count":
      return value
    default:
      return "sum"
  }
}

function rowField(row: EntityRow, key: string): unknown {
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  return row[key] ?? row[snake]
}

function dimension(value: unknown): string {
  return value == null || value === "" ? "(blank)" : String(value)
}

function measure(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

type Cell = { sum: number; count: number; min: number; max: number; incomplete: boolean }

function cellValue(cell: Cell | undefined, operation: PivotMeasureOp): number | null {
  if (!cell || cell.incomplete) return null
  switch (operation) {
    case "avg": return cell.sum / cell.count
    case "min": return cell.min
    case "max": return cell.max
    case "count": return cell.count
    default: return cell.sum
  }
}

export function buildPivotTable(
  rows: readonly EntityRow[],
  { rowDimension, columnDimension, measureField, measureOp }: {
    rowDimension: string
    columnDimension: string
    measureField: string
    measureOp: PivotMeasureOp
  },
) {
  const groups = new Map<string, Map<string, Cell>>()
  const columnLabels = new Set<string>()
  const measureLabel = `${measureOp}(${measureField})`

  for (const row of rows) {
    const label = dimension(rowField(row, rowDimension))
    const column = columnDimension ? dimension(rowField(row, columnDimension)) : measureLabel
    const value = measure(rowField(row, measureField))
    columnLabels.add(column)
    const cells = groups.get(label) ?? new Map<string, Cell>()
    groups.set(label, cells)
    const cell = cells.get(column) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity, incomplete: false }
    cells.set(column, cell)
    if (value == null) {
      cell.incomplete = true
    } else {
      cell.sum += value
      cell.count++
      cell.min = Math.min(cell.min, value)
      cell.max = Math.max(cell.max, value)
    }
  }

  const measureColumns = columnDimension ? [...columnLabels].sort() : [measureLabel]
  const columns = [rowDimension, ...measureColumns].map((label, index) => ({
    key: `pivot_${index}`,
    label,
  }))
  const exportRows: PivotValue[][] = []
  const tableRows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, cells], id) => {
    const values = measureColumns.map((column) => {
      const value = cellValue(cells.get(column), measureOp)
      return value != null && Number.isFinite(value) ? Number(value.toFixed(2)) : null
    })
    const row: EntityRow = { id }
    const rowValues = [label, ...values]
    columns.forEach(({ key }, index) => { row[key] = rowValues[index] })
    exportRows.push(rowValues.map((value) => value ?? ""))
    return row
  })

  return { columns, tableRows, exportHeaders: columns.map(({ label }) => label), exportRows }
}
