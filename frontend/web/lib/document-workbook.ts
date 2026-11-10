import { z } from "zod"
import {
  DocumentViewerError,
  readBytes,
  requestOptions,
  type DocumentViewerFetch,
  type DocumentViewerScope,
  type DocumentViewerSource,
} from "./document-viewer"
import { financeSourceUrl } from "./finance-source-preview"

const MAX_METADATA_BYTES = 512 * 1024
const MAX_RANGE_BYTES = 8 * 1024 * 1024
const MAX_WORKSHEET_ROWS = 1_048_576
const MAX_WORKSHEET_COLUMNS = 16_384
const MAX_RANGE_ROWS = 200
const MAX_RANGE_COLUMNS = 100
const MAX_RANGE_CELLS = 5_000
const MAX_RANGE_REQUESTS = 7
const MAX_MERGES = 2_000
const MAX_SEARCH_QUERY_BYTES = 256

const positiveId = z
  .string()
  .regex(/^[1-9]\d{0,19}$/)
  .refine((value) => value.length < 20 || value <= "18446744073709551615")
const checksum = z.string().regex(/^[a-f0-9]{64}$/)
const sheetId = z.string().regex(/^(?:0|[1-9]\d?)$/)
const rowIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_WORKSHEET_ROWS - 1)
const columnIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_WORKSHEET_COLUMNS - 1)
const rowCount = z.number().int().min(0).max(MAX_WORKSHEET_ROWS)
const columnCount = z.number().int().min(0).max(MAX_WORKSHEET_COLUMNS)

const identity = z.object({
  documentId: positiveId,
  versionId: positiveId,
  checksum,
})
const rectangle = z.object({
  rowStart: rowIndex,
  rowCount,
  columnStart: columnIndex,
  columnCount,
})
const worksheet = z.object({
  id: sheetId,
  name: z.string().min(1).max(255),
  rowCount,
  columnCount,
  visibility: z.enum(["visible", "hidden", "veryHidden"]),
  merges: z.array(rectangle).max(MAX_MERGES).optional(),
})
const metadata = identity.extend({
  format: z.enum(["csv", "xlsx"]),
  sheets: z.array(worksheet).min(1).max(100),
  dateSystem: z.enum(["1900", "1904"]).optional(),
})
const point = z.object({ row: rowIndex, column: columnIndex })
const cell = point
  .extend({
    kind: z.enum(["blank", "text", "number", "boolean", "error", "date"]),
    value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    displayValue: z.string(),
    numberFormat: z.string().optional(),
    numberFormatId: z.number().int().min(0).max(0xffff_ffff).optional(),
    formatStatus: z.literal("raw").optional(),
    formula: z.string().optional(),
    formulaStatus: z.enum(["cached", "missing"]).optional(),
    formulaType: z.string().optional(),
    formulaRef: z.string().optional(),
    formulaSharedIndex: z.string().optional(),
  })
  .refine(({ kind, value }) => {
    switch (kind) {
      case "blank":
        return value === null
      case "boolean":
        return typeof value === "boolean"
      case "number":
        return typeof value === "number"
      case "date":
        return typeof value === "number" || typeof value === "string"
      case "text":
      case "error":
        return typeof value === "string"
    }
  })
const range = identity.merge(rectangle).extend({
  sheetId,
  cells: z.array(cell).max(MAX_RANGE_CELLS),
  merges: z.array(rectangle).max(MAX_MERGES),
})
const search = identity.extend({
  match: point.nullable(),
  wrapped: z.boolean(),
})

export type WorkbookRect = z.infer<typeof rectangle>
export type WorkbookPoint = z.infer<typeof point>
export type WorkbookCell = z.infer<typeof cell>
export type WorkbookSheet = z.infer<typeof worksheet>
export type WorkbookRange = z.infer<typeof range>
export type WorkbookSearchResult = z.infer<typeof search>
export type DocumentWorkbook = z.infer<typeof metadata> & {
  readRange(
    sheetId: string,
    rect: WorkbookRect,
    signal: AbortSignal,
  ): Promise<WorkbookRange>
  search(
    sheetId: string,
    query: string,
    direction: "next" | "previous",
    after: WorkbookPoint | null,
    signal: AbortSignal,
  ): Promise<WorkbookSearchResult>
}

export class DocumentWorkbookError extends DocumentViewerError {
  constructor(
    readonly reason:
      | "unsupported"
      | "unreadable"
      | "workerUnavailable"
      | "rangeTooLarge",
  ) {
    super(
      reason === "rangeTooLarge"
        ? "tooLarge"
        : reason === "workerUnavailable"
          ? "request"
          : "invalid",
    )
    this.name = "DocumentWorkbookError"
  }
}

function checkIdentity(
  actual: z.infer<typeof identity>,
  expected: z.infer<typeof identity>,
): void {
  if (
    actual.documentId !== expected.documentId ||
    actual.versionId !== expected.versionId ||
    actual.checksum !== expected.checksum
  )
    throw new DocumentViewerError("integrity")
}

async function readJson<T>(
  schema: z.ZodType<T>,
  url: string,
  fetcher: DocumentViewerFetch,
  signal: AbortSignal,
  limit: number,
): Promise<T> {
  signal.throwIfAborted()
  const response = await fetcher(url, requestOptions(signal))
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    signal.throwIfAborted()
    throw responseError(response.status)
  }
  const bytes = await readBytes(response, limit, signal)
  signal.throwIfAborted()
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    )
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
  } catch {
    // A successful response must carry a valid workbook payload.
  }
  throw new DocumentViewerError("invalid")
}

function responseError(status: number): DocumentViewerError {
  switch (status) {
    case 400:
      return new DocumentViewerError("invalid")
    case 401:
    case 403:
      return new DocumentViewerError("denied")
    case 404:
      return new DocumentViewerError("unavailable")
    case 409:
    case 412:
      return new DocumentViewerError("integrity")
    case 413:
      return new DocumentViewerError("tooLarge")
    case 415:
      return new DocumentWorkbookError("unsupported")
    case 422:
      return new DocumentWorkbookError("unreadable")
    case 503:
      return new DocumentWorkbookError("workerUnavailable")
    default:
      return new DocumentViewerError("request")
  }
}

function within(rect: WorkbookRect, sheet: WorkbookSheet): boolean {
  return (
    rect.rowStart + rect.rowCount <= sheet.rowCount &&
    rect.columnStart + rect.columnCount <= sheet.columnCount
  )
}

function intersects(first: WorkbookRect, second: WorkbookRect): boolean {
  return (
    first.rowStart < second.rowStart + second.rowCount &&
    second.rowStart < first.rowStart + first.rowCount &&
    first.columnStart < second.columnStart + second.columnCount &&
    second.columnStart < first.columnStart + first.columnCount
  )
}

function validMerge(merge: WorkbookRect, sheet: WorkbookSheet): boolean {
  return merge.rowCount > 0 && merge.columnCount > 0 && within(merge, sheet)
}

function splitTile(tile: WorkbookRect): [WorkbookRect, WorkbookRect] {
  if (tile.rowCount >= tile.columnCount) {
    const rowCount = Math.floor(tile.rowCount / 2)
    return [
      { ...tile, rowCount },
      {
        ...tile,
        rowStart: tile.rowStart + rowCount,
        rowCount: tile.rowCount - rowCount,
      },
    ]
  }
  const columnCount = Math.floor(tile.columnCount / 2)
  return [
    { ...tile, columnCount },
    {
      ...tile,
      columnStart: tile.columnStart + columnCount,
      columnCount: tile.columnCount - columnCount,
    },
  ]
}

function validateTile(
  result: WorkbookRange,
  id: string,
  tile: WorkbookRect,
  sheet: WorkbookSheet,
): void {
  if (
    result.sheetId !== id ||
    result.rowStart !== tile.rowStart ||
    result.rowCount !== tile.rowCount ||
    result.columnStart !== tile.columnStart ||
    result.columnCount !== tile.columnCount
  )
    throw new DocumentViewerError("integrity")

  const coordinates = new Set<number>()
  for (const { row, column } of result.cells) {
    const coordinate = row * MAX_WORKSHEET_COLUMNS + column
    if (
      coordinates.has(coordinate) ||
      row < tile.rowStart ||
      row >= tile.rowStart + tile.rowCount ||
      column < tile.columnStart ||
      column >= tile.columnStart + tile.columnCount
    )
      throw new DocumentViewerError("invalid")
    coordinates.add(coordinate)
  }
  if (
    result.merges.some(
      (merge) => !validMerge(merge, sheet) || !intersects(merge, tile),
    )
  )
    throw new DocumentViewerError("invalid")
}

function combineTiles(
  tile: WorkbookRect,
  first: WorkbookRange,
  second: WorkbookRange,
): WorkbookRange {
  const merges = new Map<string, WorkbookRect>()
  for (const merge of [...first.merges, ...second.merges]) {
    const { rowStart, columnStart, rowCount, columnCount } = merge
    merges.set(`${rowStart},${columnStart},${rowCount},${columnCount}`, merge)
  }
  if (merges.size > MAX_MERGES) throw new DocumentViewerError("invalid")
  const cells = [...first.cells, ...second.cells].sort(
    (a, b) => a.row - b.row || a.column - b.column,
  )
  return { ...first, ...tile, cells, merges: [...merges.values()] }
}

/** Bind each independently authorized read to the selected immutable document version. */
export async function readDocumentWorkbook(
  source: DocumentViewerSource,
  scope: DocumentViewerScope,
  fetcher: DocumentViewerFetch,
  signal: AbortSignal,
  followCurrent = source.isCurrent,
): Promise<DocumentWorkbook> {
  const expected = identity.safeParse(source)
  const organizationId = String(scope.organizationId)
  const companyId = scope.companyId === null ? null : String(scope.companyId)
  if (
    !expected.success ||
    !positiveId.safeParse(organizationId).success ||
    (companyId !== null && !positiveId.safeParse(companyId).success) ||
    !financeSourceUrl(source.url, scope.organizationId)
  ) {
    throw new DocumentViewerError("unavailable")
  }
  const format = workbookFormat(source.mimeType)
  if (!format) throw new DocumentWorkbookError("unsupported")

  const version = followCurrent ? "current" : expected.data.versionId
  const path = `/api/documents/spreadsheet/${expected.data.documentId}/${version}`
  const query = new URLSearchParams({
    organizationId,
    checksum: expected.data.checksum,
  })
  if (companyId !== null) query.set("companyId", companyId)
  const workbook = await readJson(
    metadata,
    `${path}?${query}`,
    fetcher,
    signal,
    MAX_METADATA_BYTES,
  )
  checkIdentity(workbook, expected.data)
  if (workbook.format !== format || (format === "xlsx" && !workbook.dateSystem))
    throw new DocumentViewerError("integrity")

  let mergeCount = 0
  if (
    workbook.sheets.some((sheet, index) => {
      mergeCount += sheet.merges?.length ?? 0
      return (
        sheet.id !== String(index) ||
        mergeCount > MAX_MERGES ||
        sheet.merges?.some((merge) => !validMerge(merge, sheet))
      )
    })
  )
    throw new DocumentViewerError("invalid")
  const sheets = new Map(workbook.sheets.map((sheet) => [sheet.id, sheet]))
  return {
    ...workbook,
    async readRange(id, rect, rangeSignal) {
      const sheet = sheets.get(id)
      const requested = rectangle.safeParse(rect)
      if (
        !sheet ||
        !requested.success ||
        !within(rect, sheet) ||
        rect.rowCount === 0 ||
        rect.rowCount > MAX_RANGE_ROWS ||
        rect.columnCount === 0 ||
        rect.columnCount > MAX_RANGE_COLUMNS ||
        rect.rowCount * rect.columnCount > MAX_RANGE_CELLS
      ) {
        throw new DocumentViewerError("invalid")
      }
      let requests = 0
      const readTile = async (tile: WorkbookRect): Promise<WorkbookRange> => {
        if (requests >= MAX_RANGE_REQUESTS)
          throw new DocumentWorkbookError("rangeTooLarge")
        requests++
        const rangeQuery = new URLSearchParams(query)
        rangeQuery.set("sheetId", id)
        rangeQuery.set("rowStart", String(tile.rowStart))
        rangeQuery.set("rowCount", String(tile.rowCount))
        rangeQuery.set("columnStart", String(tile.columnStart))
        rangeQuery.set("columnCount", String(tile.columnCount))
        try {
          const result = await readJson(
            range,
            `${path}/range?${rangeQuery}`,
            fetcher,
            rangeSignal,
            MAX_RANGE_BYTES,
          )
          checkIdentity(result, expected.data)
          validateTile(result, id, tile, sheet)
          return result
        } catch (cause) {
          if (
            !(cause instanceof DocumentViewerError) ||
            cause.code !== "tooLarge"
          )
            throw cause
          if (tile.rowCount === 1 && tile.columnCount === 1)
            throw new DocumentWorkbookError("rangeTooLarge")
          const [first, second] = splitTile(tile)
          return combineTiles(
            tile,
            await readTile(first),
            await readTile(second),
          )
        }
      }
      return readTile(requested.data)
    },
    async search(id, term, direction, after, searchSignal) {
      const sheet = sheets.get(id)
      if (
        !sheet ||
        !term.trim() ||
        term.length > MAX_SEARCH_QUERY_BYTES ||
        new TextEncoder().encode(term).byteLength > MAX_SEARCH_QUERY_BYTES ||
        (direction !== "next" && direction !== "previous") ||
        (after !== null && !pointInSheet(after, sheet))
      ) {
        throw new DocumentViewerError("invalid")
      }
      const searchQuery = new URLSearchParams(query)
      searchQuery.set("sheetId", id)
      searchQuery.set("query", term)
      searchQuery.set("direction", direction)
      if (after) {
        searchQuery.set("afterRow", String(after.row))
        searchQuery.set("afterColumn", String(after.column))
      }
      const result = await readJson(
        search,
        `${path}/search?${searchQuery}`,
        fetcher,
        searchSignal,
        MAX_METADATA_BYTES,
      )
      checkIdentity(result, expected.data)
      if (
        (result.match && !pointInSheet(result.match, sheet)) ||
        (result.wrapped && (!after || !result.match))
      ) {
        throw new DocumentViewerError("invalid")
      }
      return result
    },
  }
}

function pointInSheet(position: WorkbookPoint, sheet: WorkbookSheet): boolean {
  return (
    point.safeParse(position).success &&
    position.row < sheet.rowCount &&
    position.column < sheet.columnCount
  )
}

function workbookFormat(mimeType: string): "xlsx" | "csv" | undefined {
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return "xlsx"
  if (mimeType === "text/csv" || mimeType === "application/csv") return "csv"
}
