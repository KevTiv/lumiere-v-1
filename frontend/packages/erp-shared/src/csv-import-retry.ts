import type { ColumnMappingMap } from "./csv-import-transform"

export type ImportRetryContext = {
  fileName: string
  headers: string[]
  rows: string[][]
  mapping: ColumnMappingMap
  parentMapping?: ColumnMappingMap
  lineMapping?: ColumnMappingMap
  appliedTemplateId?: string | null
  isRetry?: boolean
}

/** ImportJobError row_number is 1-based with row 1 = first data row (CSV line 2). */
export function csvDataRowIndexFromJobError(rowNumber: number): number {
  return Math.max(0, rowNumber - 2)
}

export function uniqueFailedRowNumbers(
  errors: Array<{ rowNumber?: number; row_number?: number }>,
): number[] {
  const nums = new Set<number>()
  for (const error of errors) {
    const raw = error.rowNumber ?? error.row_number
    if (typeof raw === "number" && raw >= 2) nums.add(raw)
  }
  return [...nums].sort((a, b) => a - b)
}

export function filterRowsForRetry(
  headers: string[],
  rows: string[][],
  failedRowNumbers: number[],
): { headers: string[]; rows: string[][]; rowCount: number } {
  if (!failedRowNumbers.length) {
    return { headers, rows: [], rowCount: 0 }
  }
  const indices = new Set(failedRowNumbers.map(csvDataRowIndexFromJobError))
  const filtered = rows.filter((_, index) => indices.has(index))
  return { headers, rows: filtered, rowCount: filtered.length }
}

export function buildRetryFileName(fileName: string): string {
  const base = fileName.replace(/\.csv$/i, "") || "import"
  return `${base}-retry.csv`
}
