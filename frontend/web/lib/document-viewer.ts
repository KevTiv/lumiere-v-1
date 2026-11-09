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
  | { kind: "csv"; rows: string[][]; columns: number }
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

async function readBytes(
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

const requestOptions = (signal: AbortSignal): RequestInit => ({
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

/** Display report records verbatim; import header, formula and mapping rules do not rewrite evidence. */
export function parseDocumentCsv(value: string): {
  rows: string[][]
  columns: number
} {
  if (new TextEncoder().encode(value).byteLength > CSV_IMPORT_LIMITS.bytes)
    throw new DocumentViewerError("tooLarge")
  const input = value.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let state: "start" | "unquoted" | "quoted" | "closed" = "start"
  let columns = 0
  let cells = 0
  const endCell = () => {
    if (Array.from(cell).length > CSV_IMPORT_LIMITS.cellCharacters)
      throw new DocumentViewerError("tooLarge")
    row.push(cell)
    cell = ""
    state = "start"
    cells++
    if (
      row.length > CSV_IMPORT_LIMITS.columns ||
      cells > CSV_IMPORT_LIMITS.matrixCells
    )
      throw new DocumentViewerError("tooLarge")
  }
  const endRow = () => {
    endCell()
    columns = Math.max(columns, row.length)
    rows.push(row)
    row = []
    if (rows.length > CSV_IMPORT_LIMITS.rows + 1)
      throw new DocumentViewerError("tooLarge")
  }
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!
    if (state === "quoted") {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"'
          index++
        } else state = "closed"
      } else cell += character
    } else if (character === ",") endCell()
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index++
      endRow()
    } else if (state === "closed") {
      if (character !== " " && character !== "\t")
        throw new DocumentViewerError("invalid")
    } else if (character === '"') {
      if (state !== "start" || cell.trim().length > 0)
        throw new DocumentViewerError("invalid")
      cell = ""
      state = "quoted"
    } else {
      cell += character
      if (character !== " " && character !== "\t") state = "unquoted"
    }
    if (cell.length > CSV_IMPORT_LIMITS.cellCharacters * 2)
      throw new DocumentViewerError("tooLarge")
  }
  if (state === "quoted") throw new DocumentViewerError("invalid")
  if (row.length || cell.length || state !== "start") endRow()
  return { rows, columns }
}

export function documentPreview(
  mime: string,
  bytes: Uint8Array,
): DocumentPreview {
  const kind = documentPreviewKind(mime)
  if (kind === "xlsx" || kind === "docx") return { kind: "unsupported" }
  if (kind !== "csv" && kind !== "text") return { kind }
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new DocumentViewerError("invalid")
  }
  return kind === "csv"
    ? { kind, ...parseDocumentCsv(content) }
    : { kind, text: content }
}
