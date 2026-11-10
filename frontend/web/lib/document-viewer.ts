import { decodeQueryListResponse } from "@lumiere/api-client"
import { CSV_IMPORT_LIMITS } from "@lumiere/erp-shared/csv-import-safety"
import {
  DOCX_DOCUMENT_MIME,
  XLSX_DOCUMENT_MIME,
  documentFileContentType,
} from "@lumiere/erp-shared/document-file-profile"
import { financeSourceUrl } from "./finance-source-preview"

export type DocumentViewerErrorCode =
  | "unavailable"
  | "denied"
  | "invalid"
  | "tooLarge"
  | "integrity"
  | "request"

export class DocumentViewerError extends Error {
  constructor(readonly code: DocumentViewerErrorCode) {
    super(code)
    this.name = "DocumentViewerError"
  }
}

const CSV_DELIMITERS = [",", ";", "\t"] as const
export type DocumentCsvDelimiter = (typeof CSV_DELIMITERS)[number]
export type DocumentCsvEncoding =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "windows-1252"
export type DocumentCsvOptions = {
  delimiter?: "auto" | DocumentCsvDelimiter
  encoding?: "auto" | DocumentCsvEncoding
}
export type DocumentCsvDiagnostic =
  | { code: "ambiguousDelimiter"; candidates: DocumentCsvDelimiter[] }
  | { code: "unknownEncoding" | "invalidEncoding" }
  | {
      code: "unexpectedQuote" | "unterminatedQuote"
      row: number
      column: number
    }
  | {
      code: "limitExceeded"
      limit: "bytes" | "rows" | "columns" | "cellCharacters" | "matrixCells"
      row?: number
      column?: number
    }

export class DocumentCsvError extends DocumentViewerError {
  constructor(
    readonly diagnostic: Exclude<
      DocumentCsvDiagnostic,
      { code: "ambiguousDelimiter" }
    >,
  ) {
    super(diagnostic.code === "limitExceeded" ? "tooLarge" : "invalid")
    this.name = "DocumentCsvError"
  }
}

export type DocumentViewerScope = {
  organizationId: bigint
  companyId: bigint | null
}
export type DocumentViewerFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>
export type DocumentViewerSource = {
  documentId: string
  versionId?: string
  versionNumber?: number
  fileName: string
  mimeType: string
  size: number
  url: string
  checksum: string
  isCurrent: boolean
}
export type DocumentViewerManifest = {
  name: string
  source: DocumentViewerSource
  versions: DocumentViewerSource[]
}
export type OfficePreviewSheet = {
  name: string
  columns: number
  rows: string[][]
  truncated: boolean
}
type WordPreviewBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] }
export type OfficeDocumentPreview =
  | { kind: "xlsx"; sheets: OfficePreviewSheet[] }
  | { kind: "docx"; blocks: WordPreviewBlock[]; truncated: boolean }

export type DocumentPreview =
  | {
      kind: "csv"
      rows: string[][]
      columns: number
      delimiter: DocumentCsvDelimiter
      encoding: DocumentCsvEncoding
      diagnostics: DocumentCsvDiagnostic[]
    }
  | { kind: "text"; text: string }
  | { kind: "image" }
  | { kind: "pdf" }
  | { kind: "unsupported" }
  | OfficeDocumentPreview

function field(row: unknown, camel: string, snake = camel): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row))
    return undefined
  const first: unknown = Reflect.get(row, camel)
  const second: unknown = Reflect.get(row, snake)
  if (first !== undefined && second !== undefined && first !== second) {
    throw new DocumentViewerError("invalid")
  }
  return first !== undefined ? first : second
}

function id(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0))
    return null
  if (
    typeof value !== "string" &&
    typeof value !== "bigint" &&
    typeof value !== "number"
  )
    return null
  const text = String(value)
  return /^[1-9]\d*$/.test(text) && BigInt(text) <= 18_446_744_073_709_551_615n
    ? text
    : null
}

function number(value: unknown): number | undefined {
  const parsed = id(value)
  return parsed !== null && BigInt(parsed) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(parsed)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function source(
  row: unknown,
  documentId: string,
  organizationId: bigint,
): DocumentViewerSource {
  const url = financeSourceUrl(field(row, "url"), organizationId)
  const checksum = text(field(row, "checksum"))
  const fileName = text(field(row, "fileName", "file_name"))
  const mimeType = text(field(row, "mimetype"))
  const size = number(field(row, "fileSize", "file_size"))
  if (
    !url ||
    !checksum ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    !fileName ||
    !mimeType ||
    !size
  ) {
    throw new DocumentViewerError("unavailable")
  }
  return {
    documentId,
    fileName,
    mimeType,
    size,
    url,
    checksum,
    isCurrent: false,
  }
}

/** Resolve only exact projected records. A filename or another record's URL is never a fallback. */
export function resolveDocumentViewerManifest(options: {
  documents: readonly unknown[]
  versions: readonly unknown[]
  scope: DocumentViewerScope
  documentId: string
  versionId?: string
}): DocumentViewerManifest {
  const { documents, versions, scope, documentId, versionId } = options
  if (
    id(documentId) !== documentId ||
    scope.organizationId <= 0n ||
    (scope.companyId !== null && scope.companyId <= 0n)
  ) {
    throw new DocumentViewerError("invalid")
  }
  const matches = documents.filter((row) => id(field(row, "id")) === documentId)
  if (matches.length !== 1) throw new DocumentViewerError("unavailable")
  const document = matches[0]
  const company = field(document, "companyId", "company_id")
  if (
    id(field(document, "organizationId", "organization_id")) !==
      String(scope.organizationId) ||
    field(document, "isDeleted", "is_deleted") !== false ||
    (company !== null && id(company) !== scope.companyId?.toString())
  ) {
    throw new DocumentViewerError("unavailable")
  }
  const currentId = id(
    field(document, "currentVersionId", "current_version_id"),
  )
  const current = {
    ...source(document, documentId, scope.organizationId),
    isCurrent: true,
    versionId: currentId ?? undefined,
    versionNumber: number(field(document, "versionCount", "version_count")),
  }
  const seen = new Set<string>()
  const choices: DocumentViewerSource[] = []
  for (const row of versions) {
    if (id(field(row, "documentId", "document_id")) !== documentId) continue
    if (
      id(field(row, "organizationId", "organization_id")) !==
      String(scope.organizationId)
    ) {
      throw new DocumentViewerError("invalid")
    }
    const version = id(field(row, "id"))
    const versionNumber = number(field(row, "versionNumber", "version_number"))
    const isCurrent = field(row, "isCurrent", "is_current")
    if (
      !version ||
      !versionNumber ||
      typeof isCurrent !== "boolean" ||
      seen.has(version)
    ) {
      throw new DocumentViewerError("invalid")
    }
    seen.add(version)
    // Redacted byte references are not selectable or reconstructed from another version.
    let bytes: DocumentViewerSource
    try {
      bytes = source(row, documentId, scope.organizationId)
    } catch (cause) {
      if (cause instanceof DocumentViewerError && cause.code === "unavailable")
        continue
      throw cause
    }
    if (isCurrent !== (version === currentId))
      throw new DocumentViewerError("integrity")
    if (
      isCurrent &&
      (bytes.url !== current.url ||
        bytes.checksum !== current.checksum ||
        bytes.mimeType !== current.mimeType ||
        bytes.size !== current.size)
    ) {
      throw new DocumentViewerError("integrity")
    }
    choices.push({ ...bytes, versionId: version, versionNumber, isCurrent })
  }
  choices.sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0))
  const selected =
    versionId === undefined
      ? current
      : choices.find((choice) => choice.versionId === versionId)
  if (!selected) throw new DocumentViewerError("unavailable")
  return {
    name: text(field(document, "name")) ?? current.fileName,
    source: selected,
    versions: choices,
  }
}

export async function readBytes(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok)
    throw new DocumentViewerError(
      response.status === 401 || response.status === 403
        ? "denied"
        : response.status === 404
          ? "unavailable"
          : "request",
    )
  const contentLength = response.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximum)
  ) {
    await response.body?.cancel()
    throw new DocumentViewerError("tooLarge")
  }
  if (!response.body) throw new DocumentViewerError("invalid")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximum) throw new DocumentViewerError("tooLarge")
      chunks.push(chunk.value)
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export const requestOptions = (signal: AbortSignal): RequestInit => ({
  credentials: "include",
  cache: "no-store",
  redirect: "error",
  signal,
})

/** Refresh authorization and metadata on every open, version change, and download. */
export async function readDocumentViewerManifest(options: {
  scope: DocumentViewerScope
  documentId: string
  versionId?: string
  includeVersions: boolean
  fetcher: DocumentViewerFetch
  signal: AbortSignal
}): Promise<DocumentViewerManifest> {
  const { scope, signal, fetcher } = options
  if (options.versionId !== undefined && !options.includeVersions)
    throw new DocumentViewerError("denied")
  const query = new URLSearchParams({
    organizationId: String(scope.organizationId),
  })
  if (scope.companyId !== null) query.set("companyId", String(scope.companyId))
  const read = async (resource: "documents" | "document-versions") => {
    const response = await fetcher(
      `/api/query/${resource}?${query}`,
      requestOptions(signal),
    )
    const bytes = await readBytes(response, 16 * 1024 * 1024, signal)
    try {
      return decodeQueryListResponse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        (row) => row,
      )
    } catch {
      throw new DocumentViewerError("invalid")
    }
  }
  const [documents, versions] = await Promise.all([
    read("documents"),
    options.includeVersions ? read("document-versions") : Promise.resolve([]),
  ])
  signal.throwIfAborted()
  return resolveDocumentViewerManifest({ ...options, documents, versions })
}

/** The existing authenticated endpoint performs current ACL, field, checksum and inspection checks. */
export async function readDocumentViewerFile(
  source: DocumentViewerSource,
  fetcher: DocumentViewerFetch,
  signal: AbortSignal,
): Promise<{ blob: Blob; bytes: Uint8Array<ArrayBuffer> }> {
  try {
    documentFileContentType({
      name: source.fileName,
      type: source.mimeType,
      size: source.size,
    })
  } catch {
    throw new DocumentViewerError("unavailable")
  }
  const response = await fetcher(
    `${source.url}?sha256=${source.checksum}`,
    requestOptions(signal),
  )
  const bytes = await readBytes(response, source.size, signal)
  if (
    bytes.byteLength !== source.size ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== source.mimeType.toLowerCase()
  ) {
    throw new DocumentViewerError("integrity")
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  signal.throwIfAborted()
  const checksum = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  if (checksum !== source.checksum) throw new DocumentViewerError("integrity")
  return { bytes, blob: new Blob([bytes], { type: source.mimeType }) }
}

export function documentPreviewKind(mime: string): DocumentPreview["kind"] {
  if (mime === XLSX_DOCUMENT_MIME) return "xlsx"
  if (mime === DOCX_DOCUMENT_MIME) return "docx"
  if (mime === "text/csv" || mime === "application/csv") return "csv"
  if (["text/plain", "text/markdown", "application/json"].includes(mime))
    return "text"
  if (["image/png", "image/jpeg", "image/webp"].includes(mime)) return "image"
  return mime === "application/pdf" ? "pdf" : "unsupported"
}

function isPreviewText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum
}

function isPreviewRows(value: unknown, columns?: number): value is string[][] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (row: unknown) =>
        Array.isArray(row) &&
        row.length <= 20 &&
        (columns === undefined ? row.length > 0 : row.length === columns) &&
        row.every((cell: unknown) => isPreviewText(cell, 500)),
    )
  )
}

function isPreviewSheet(value: unknown): value is OfficePreviewSheet {
  const name = field(value, "name")
  const columns = field(value, "columns")
  return (
    isPreviewText(name, 255) &&
    name.trim().length > 0 &&
    typeof columns === "number" &&
    Number.isInteger(columns) &&
    columns >= 0 &&
    columns <= 20 &&
    isPreviewRows(field(value, "rows"), columns) &&
    typeof field(value, "truncated") === "boolean"
  )
}

function isWordPreviewBlock(value: unknown): value is WordPreviewBlock {
  const kind = field(value, "kind")
  return kind === "paragraph"
    ? isPreviewText(field(value, "text"), 4_000)
    : kind === "table" && isPreviewRows(field(value, "rows"))
}

/** Request bounded display data from the authorized blob route, without transferring Office bytes. */
export async function readDocumentOfficePreview(
  source: DocumentViewerSource,
  scope: DocumentViewerScope,
  fetcher: DocumentViewerFetch,
  signal: AbortSignal,
): Promise<OfficeDocumentPreview> {
  const kind = documentPreviewKind(source.mimeType)
  if (kind !== "xlsx" && kind !== "docx")
    throw new DocumentViewerError("invalid")
  if (source.size > 5_000_000) throw new DocumentViewerError("tooLarge")
  const url = financeSourceUrl(source.url, scope.organizationId)
  if (!url || !/^[a-f0-9]{64}$/.test(source.checksum))
    throw new DocumentViewerError("invalid")
  const query = new URLSearchParams({
    sha256: source.checksum,
    preview: "true",
    documentId: source.documentId,
  })
  if (source.versionId !== undefined) query.set("versionId", source.versionId)
  if (scope.companyId !== null) query.set("companyId", String(scope.companyId))
  const response = await fetcher(`${url}?${query}`, requestOptions(signal))
  if (response.status === 409) throw new DocumentViewerError("integrity")
  if (response.status === 400 || response.status === 422)
    throw new DocumentViewerError("invalid")
  if (response.status === 413) throw new DocumentViewerError("tooLarge")
  const bytes = await readBytes(response, 2_000_000, signal)
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new DocumentViewerError("invalid")
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new DocumentViewerError("invalid")
  }
  if (
    field(body, "sourceSha256") !== source.checksum ||
    field(body, "sourceSize") !== source.size
  )
    throw new DocumentViewerError("integrity")
  const preview = field(body, "preview")
  if (field(preview, "kind") !== kind) throw new DocumentViewerError("invalid")
  if (kind === "xlsx") {
    const sheets = field(preview, "sheets")
    if (
      Array.isArray(sheets) &&
      sheets.length > 0 &&
      sheets.length <= 24 &&
      sheets.every(isPreviewSheet)
    )
      return { kind, sheets }
  } else {
    const blocks = field(preview, "blocks")
    const truncated = field(preview, "truncated")
    if (
      typeof truncated === "boolean" &&
      Array.isArray(blocks) &&
      blocks.length <= 200 &&
      blocks.every(isWordPreviewBlock)
    )
      return { kind, blocks, truncated }
  }
  throw new DocumentViewerError("invalid")
}

type CsvLimit = Extract<
  DocumentCsvDiagnostic,
  { code: "limitExceeded" }
>["limit"]

function csvLimit(limit: CsvLimit, row?: number, column?: number): never {
  throw new DocumentCsvError({ code: "limitExceeded", limit, row, column })
}

// Sample logical records with the same quoting rules used for the full preview.
// Sampling tracks widths only, so a wrong delimiter cannot allocate a large cell.
const CSV_SAMPLE_ROWS = 64
function scanDocumentCsv(
  input: string,
  delimiter: DocumentCsvDelimiter,
  sampleWidths?: number[],
): { rows: string[][]; columns: number } {
  const rows: string[][] = []
  let row: string[] = []
  let rowStart = 0
  let rowNumber = 1
  let width = 0
  let cell = ""
  let state: "start" | "unquoted" | "quoted" | "closed" = "start"
  let columns = 0
  let cells = 0
  const endCell = () => {
    width++
    if (!sampleWidths) {
      if (width > CSV_IMPORT_LIMITS.columns)
        csvLimit("columns", rowNumber, width)
      if (++cells > CSV_IMPORT_LIMITS.matrixCells)
        csvLimit("matrixCells", rowNumber, width)
      if (
        cell.length > CSV_IMPORT_LIMITS.cellCharacters &&
        Array.from(cell).length > CSV_IMPORT_LIMITS.cellCharacters
      ) {
        csvLimit("cellCharacters", rowNumber, width)
      }
      row.push(cell)
    }
    cell = ""
    state = "start"
  }
  const endRow = () => {
    endCell()
    columns = Math.max(columns, width)
    if (sampleWidths) {
      if (width > 1 && sampleWidths.length < CSV_SAMPLE_ROWS)
        sampleWidths.push(width)
    } else {
      if (rowNumber > CSV_IMPORT_LIMITS.rows + 1) csvLimit("rows", rowNumber)
      rows.push(row)
    }
    rowNumber++
    row = []
    width = 0
  }
  const malformed = (code: "unexpectedQuote" | "unterminatedQuote"): never => {
    throw new DocumentCsvError({
      code,
      row: rowNumber,
      column: width + 1,
    })
  }
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!
    if (state === "quoted") {
      if (character === '"') {
        if (input[index + 1] === '"') {
          if (!sampleWidths) cell += '"'
          index++
        } else state = "closed"
      } else if (!sampleWidths) cell += character
    } else if (character === delimiter) endCell()
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index++
      endRow()
      rowStart = index + 1
    } else if (state === "closed") {
      if (character !== " " && character !== "\t") malformed("unexpectedQuote")
    } else if (character === '"') {
      if (state !== "start") malformed("unexpectedQuote")
      cell = ""
      state = "quoted"
    } else {
      if (!sampleWidths) cell += character
      if (character !== " " && character !== "\t") state = "unquoted"
    }
    if (cell.length > CSV_IMPORT_LIMITS.cellCharacters * 2)
      csvLimit("cellCharacters", rowNumber, width + 1)
  }
  if (state === "quoted") malformed("unterminatedQuote")
  if (rowStart < input.length) endRow()
  return { rows, columns }
}

function detectCsvDelimiter(input: string): {
  delimiter: DocumentCsvDelimiter
  diagnostics: DocumentCsvDiagnostic[]
} {
  const candidates = CSV_DELIMITERS.flatMap((delimiter) => {
    const widths: number[] = []
    try {
      scanDocumentCsv(input, delimiter, widths)
    } catch (error) {
      if (!(error instanceof DocumentCsvError)) throw error
      return []
    }
    const frequencies = new Map<number, number>()
    let consistentRows = 0
    for (const width of widths) {
      const count = (frequencies.get(width) ?? 0) + 1
      frequencies.set(width, count)
      consistentRows = Math.max(consistentRows, count)
    }
    return widths.length
      ? [{ delimiter, multiColumnRows: widths.length, consistentRows }]
      : []
  }).sort(
    (first, second) =>
      second.multiColumnRows - first.multiColumnRows ||
      second.consistentRows - first.consistentRows,
  )
  return {
    delimiter: candidates[0]?.delimiter ?? ",",
    diagnostics:
      candidates.length > 1
        ? [
            {
              code: "ambiguousDelimiter",
              candidates: candidates.map(({ delimiter }) => delimiter),
            },
          ]
        : [],
  }
}

/** Display report records verbatim; import header, formula and mapping rules do not rewrite evidence. */
export function parseDocumentCsv(value: string): {
  rows: string[][]
  columns: number
} {
  if (
    value.length > CSV_IMPORT_LIMITS.bytes ||
    new TextEncoder().encode(value).byteLength > CSV_IMPORT_LIMITS.bytes
  ) {
    csvLimit("bytes")
  }
  return scanDocumentCsv(value.replace(/^\uFEFF/, ""), ",")
}

function decodeDocumentCsv(
  bytes: Uint8Array,
  selected?: DocumentCsvOptions["encoding"],
) {
  if (bytes.byteLength > CSV_IMPORT_LIMITS.bytes) csvLimit("bytes")
  const [first, second, third, fourth] = bytes
  const unsupportedBom =
    (first === 0xff && second === 0xfe && third === 0 && fourth === 0) ||
    (first === 0 && second === 0 && third === 0xfe && fourth === 0xff)
  let bom: DocumentCsvEncoding | undefined
  if (first === 0xef && second === 0xbb && third === 0xbf) bom = "utf-8"
  else if (first === 0xff && second === 0xfe) bom = "utf-16le"
  else if (first === 0xfe && second === 0xff) bom = "utf-16be"
  const automatic = !selected || selected === "auto"
  const encoding = automatic ? (bom ?? "utf-8") : selected
  const failure = () =>
    new DocumentCsvError({
      code: automatic && !bom ? "unknownEncoding" : "invalidEncoding",
    })
  if (unsupportedBom || (bom && bom !== encoding)) throw failure()
  let input: string
  try {
    input = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw failure()
  }
  if (
    encoding !== "utf-8" &&
    new TextEncoder().encode(input).byteLength > CSV_IMPORT_LIMITS.bytes
  ) {
    csvLimit("bytes")
  }
  // Reject binary controls, including the NULs commonly left by BOM-less UTF-16.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input))
    throw failure()
  return { input, encoding }
}

export function documentPreview(
  mime: string,
  bytes: Uint8Array,
  options?: DocumentCsvOptions,
): DocumentPreview {
  const kind = documentPreviewKind(mime)
  if (kind === "xlsx" || kind === "docx") return { kind: "unsupported" }
  if (kind === "csv") {
    const { input, encoding } = decodeDocumentCsv(bytes, options?.encoding)
    const selected = options?.delimiter
    const { delimiter, diagnostics } =
      !selected || selected === "auto"
        ? detectCsvDelimiter(input)
        : { delimiter: selected, diagnostics: [] }
    return {
      kind,
      ...scanDocumentCsv(input, delimiter),
      delimiter,
      encoding,
      diagnostics,
    }
  }
  if (kind !== "text") return { kind }
  try {
    return {
      kind,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    }
  } catch {
    throw new DocumentViewerError("invalid")
  }
}
