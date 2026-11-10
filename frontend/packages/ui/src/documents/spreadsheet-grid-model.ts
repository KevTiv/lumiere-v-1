export type SpreadsheetPoint = { row: number; column: number }
export type SpreadsheetRect = {
  rowStart: number
  rowCount: number
  columnStart: number
  columnCount: number
}
export type SpreadsheetCell = SpreadsheetPoint & {
  displayValue: string
  kind?: string
  value?: string | number | boolean | null
  formatStatus?: string | null
  formula?: string | null
  formulaStatus?: string | null
  numberFormat?: string | null
}
export type SpreadsheetSheet = {
  id: string
  name: string
  rowCount: number
  columnCount: number
  visibility?: string
  merges?: readonly SpreadsheetRect[]
}
export type SpreadsheetRange = {
  cells: readonly SpreadsheetCell[]
  merges?: readonly SpreadsheetRect[]
}
export type SpreadsheetSearch = {
  match: SpreadsheetPoint | null
  wrapped: boolean
}
export type SpreadsheetSource = {
  sheets: readonly SpreadsheetSheet[]
  readRange(
    sheetId: string,
    rect: SpreadsheetRect,
    signal: AbortSignal,
  ): Promise<SpreadsheetRange>
  search(
    sheetId: string,
    query: string,
    after: SpreadsheetPoint | null,
    direction: "next" | "previous",
    signal: AbortSignal,
  ): Promise<SpreadsheetSearch>
}
export type SpreadsheetSelection = {
  sheetName: string
  range: {
    firstRow: number
    lastRow: number
    firstColumn: number
    lastColumn: number
  }
  text: string
}
export type SpreadsheetAction = "explain" | "check" | "prepare"

export const TILE_ROWS = 64
export const TILE_COLUMNS = 32
export const MAX_COPY_CELLS = 5_000
export const MAX_COPY_BYTES = 1_048_576

export function columnLabel(index: number): string {
  let value = index + 1
  let label = ""
  while (value > 0) {
    value--
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

export function cellLabel(point: SpreadsheetPoint): string {
  return columnLabel(point.column) + (point.row + 1)
}

export function cellKey({ row, column }: SpreadsheetPoint): string {
  return `${row}:${column}`
}

export function rangeBetween(
  start: SpreadsheetPoint,
  end: SpreadsheetPoint,
): SpreadsheetRect {
  return {
    rowStart: Math.min(start.row, end.row),
    rowCount: Math.abs(start.row - end.row) + 1,
    columnStart: Math.min(start.column, end.column),
    columnCount: Math.abs(start.column - end.column) + 1,
  }
}

export function inRange(
  point: SpreadsheetPoint,
  rect: SpreadsheetRect,
): boolean {
  return (
    point.row >= rect.rowStart &&
    point.row < rect.rowStart + rect.rowCount &&
    point.column >= rect.columnStart &&
    point.column < rect.columnStart + rect.columnCount
  )
}

export function intersectRanges(
  first: SpreadsheetRect,
  second: SpreadsheetRect,
): SpreadsheetRect | null {
  const rowStart = Math.max(first.rowStart, second.rowStart)
  const columnStart = Math.max(first.columnStart, second.columnStart)
  const rowCount =
    Math.min(
      first.rowStart + first.rowCount,
      second.rowStart + second.rowCount,
    ) - rowStart
  const columnCount =
    Math.min(
      first.columnStart + first.columnCount,
      second.columnStart + second.columnCount,
    ) - columnStart
  return rowCount > 0 && columnCount > 0
    ? { rowStart, rowCount, columnStart, columnCount }
    : null
}

export function rangeOrigin(rect: SpreadsheetRect): SpreadsheetPoint {
  return { row: rect.rowStart, column: rect.columnStart }
}

export function rangeEnd(rect: SpreadsheetRect): SpreadsheetPoint {
  return {
    row: rect.rowStart + rect.rowCount - 1,
    column: rect.columnStart + rect.columnCount - 1,
  }
}

export function tilesFor(
  rect: SpreadsheetRect,
  sheet: SpreadsheetSheet,
): SpreadsheetRect[] {
  const tiles: SpreadsheetRect[] = []
  for (
    let row = Math.floor(rect.rowStart / TILE_ROWS) * TILE_ROWS;
    row < rect.rowStart + rect.rowCount;
    row += TILE_ROWS
  ) {
    for (
      let column = Math.floor(rect.columnStart / TILE_COLUMNS) * TILE_COLUMNS;
      column < rect.columnStart + rect.columnCount;
      column += TILE_COLUMNS
    ) {
      tiles.push({
        rowStart: row,
        rowCount: Math.min(TILE_ROWS, sheet.rowCount - row),
        columnStart: column,
        columnCount: Math.min(TILE_COLUMNS, sheet.columnCount - column),
      })
    }
  }
  return tiles
}

/** Split a selection into exact rectangles accepted by the range reader. */
export function selectionChunks(rect: SpreadsheetRect): SpreadsheetRect[] {
  const chunks: SpreadsheetRect[] = []
  const columnEnd = rect.columnStart + rect.columnCount
  const rowEnd = rect.rowStart + rect.rowCount
  for (
    let columnStart = rect.columnStart;
    columnStart < columnEnd;
    columnStart += 100
  ) {
    const columnCount = Math.min(100, columnEnd - columnStart)
    const rowsPerChunk = Math.min(200, Math.floor(MAX_COPY_CELLS / columnCount))
    for (
      let rowStart = rect.rowStart;
      rowStart < rowEnd;
      rowStart += rowsPerChunk
    ) {
      chunks.push({
        rowStart,
        rowCount: Math.min(rowsPerChunk, rowEnd - rowStart),
        columnStart,
        columnCount,
      })
    }
  }
  return chunks
}

export function tileKey(rect: SpreadsheetRect): string {
  return cellKey({ row: rect.rowStart, column: rect.columnStart })
}

export function columnAt(offsets: readonly number[], pixel: number): number {
  let low = 0
  let high = offsets.length - 1
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle]! <= pixel) low = middle
    else high = middle
  }
  return low
}

export function serializeSpreadsheetSelection(
  sheetName: string,
  rect: SpreadsheetRect,
  cells: ReadonlyMap<string, SpreadsheetCell>,
): SpreadsheetSelection | null {
  if (rect.rowCount * rect.columnCount > MAX_COPY_CELLS) return null
  const rows: string[] = []
  let characters = 0
  for (let row = rect.rowStart; row < rect.rowStart + rect.rowCount; row++) {
    const values: string[] = []
    for (
      let column = rect.columnStart;
      column < rect.columnStart + rect.columnCount;
      column++
    ) {
      const value = cells.get(cellKey({ row, column }))?.displayValue ?? ""
      const field = /[\t\r\n"]/.test(value)
        ? `"${value.replaceAll('"', '""')}"`
        : value
      characters += field.length + 1
      if (characters > MAX_COPY_BYTES) return null
      values.push(field)
    }
    rows.push(values.join("\t"))
  }
  const text = rows.join("\n")
  if (new TextEncoder().encode(text).length > MAX_COPY_BYTES) return null
  return {
    sheetName,
    range: {
      firstRow: rect.rowStart + 1,
      lastRow: rect.rowStart + rect.rowCount,
      firstColumn: rect.columnStart + 1,
      lastColumn: rect.columnStart + rect.columnCount,
    },
    text,
  }
}
