import {
  CSV_IMPORT_LIMITS,
  parseCsvText,
  validateCsvMatrix,
} from "@lumiere/erp-shared/csv-import-safety"
import { buildCanonicalCsv } from "@lumiere/erp-shared/csv-import-transform"

const MAX_XLSX_BYTES = 5_000_000
const MAX_XLSX_ENTRY_BYTES = 10_000_000
const MAX_XLSX_EXPANDED_BYTES = 30_000_000
const MAX_XLSX_ENTRIES = 128
const MAX_XLSX_EXPANSION_RATIO = 200
const MAX_XLSX_CELLS = 50_000
const MAX_XLSX_ROWS = 25_000
const MAX_XLSX_COLUMNS = 200
const MAX_XLSX_MATRIX_CELLS = 1_000_000

const CSV_SOURCE_DELIMITERS = ["comma", "semicolon", "tab", "pipe"] as const
export type CsvSourceDelimiter = (typeof CSV_SOURCE_DELIMITERS)[number]

export type ParsedImportFile = {
  csvText: string
  headers: string[]
  rows: string[][]
  format: "csv" | "xlsx"
  sheetName?: string
  sourceSha256?: string
  sourceAdmissionId?: string
  policyVersion?: string
  sourceDelimiter?: CsvSourceDelimiter
  sourceEncoding?: string
}

/** Wire fields remain untrusted until the complete response is validated. */
type ImportInspectionPayload = {
  companyId?: unknown
  sourceAdmissionId?: unknown
  csvText?: unknown
  headers?: unknown
  rows?: unknown
  format?: unknown
  sourceSha256?: unknown
  policyVersion?: unknown
  sheetName?: unknown
  sourceDelimiter?: unknown
  sourceEncoding?: unknown
}

function isCsvSourceDelimiter(value: unknown): value is CsvSourceDelimiter {
  return CSV_SOURCE_DELIMITERS.some((delimiter) => delimiter === value)
}

type ZipEntry = {
  compressionMethod: number
  flags: number
  centralOffset: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const textDecoder = new TextDecoder("utf-8", { fatal: true })

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function rangeIsInside(
  bytes: Uint8Array,
  offset: number,
  length: number,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.byteLength &&
    length <= bytes.byteLength - offset
  )
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.byteLength < 22)
    throw new Error("The .xlsx file is too short to be a valid workbook.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557)
  for (
    let offset = bytes.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (
      readUint32(view, offset) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength
    )
      return offset
  }
  throw new Error("The .xlsx file is not a valid ZIP workbook.")
}

function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(bytes)
  const entryCount = view.getUint16(eocd + 10, true)
  if (
    view.getUint16(eocd + 4, true) !== 0 ||
    view.getUint16(eocd + 6, true) !== 0 ||
    view.getUint16(eocd + 8, true) !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_XLSX_ENTRIES
  ) {
    throw new Error(
      "The workbook uses an unsupported ZIP layout or exceeds the entry limit.",
    )
  }
  let offset = readUint32(view, eocd + 16)
  const centralOffset = offset
  const centralSize = readUint32(view, eocd + 12)
  if (
    !rangeIsInside(bytes, offset, centralSize) ||
    offset + centralSize !== eocd
  ) {
    throw new Error("The .xlsx file has an invalid central directory range.")
  }
  const entries = new Map<string, ZipEntry>()
  const names = new Set<string>()
  let expandedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (!rangeIsInside(bytes, offset, 46)) {
      throw new Error("The .xlsx file has a truncated central directory.")
    }
    if (readUint32(view, offset) !== 0x02014b50) {
      throw new Error("The .xlsx file has an invalid central directory.")
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const recordLength = 46 + nameLength + extraLength + commentLength
    if (
      !rangeIsInside(bytes, offset, recordLength) ||
      offset + recordLength > centralOffset + centralSize
    ) {
      throw new Error("The .xlsx file has an invalid central directory entry.")
    }
    const name = textDecoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    )
    if (
      name.length > 255 ||
      /[\\:\u0000-\u001f]/.test(name) ||
      name.startsWith("/") ||
      name
        .split("/")
        .some((part) => part === ".." || part === "." || part === "")
    ) {
      throw new Error("The workbook contains an unsafe ZIP entry name.")
    }
    const normalizedName = name.toLowerCase()
    if (names.has(normalizedName))
      throw new Error("The workbook contains duplicate ZIP entries.")
    names.add(normalizedName)
    if (
      /vba|macro|activex|embeddings|externallinks|comments|threadedcomments|connections|querytables|customxml/i.test(
        name,
      ) ||
      !/\.(?:xml|rels)$/i.test(name)
    ) {
      throw new Error(
        "The workbook contains unsupported active or embedded content.",
      )
    }
    const flags = view.getUint16(offset + 8, true)
    const compressionMethod = view.getUint16(offset + 10, true)
    const compressedSize = readUint32(view, offset + 20)
    const uncompressedSize = readUint32(view, offset + 24)
    if (
      (flags & 0x41) !== 0 ||
      ![0, 8].includes(compressionMethod) ||
      view.getUint16(offset + 34, true) !== 0
    ) {
      throw new Error(
        "Encrypted or unsupported ZIP entries cannot be imported.",
      )
    }
    expandedBytes += uncompressedSize
    if (
      uncompressedSize > MAX_XLSX_ENTRY_BYTES ||
      expandedBytes > MAX_XLSX_EXPANDED_BYTES ||
      uncompressedSize > Math.max(1, compressedSize) * MAX_XLSX_EXPANSION_RATIO
    ) {
      throw new Error("The workbook expands beyond the safe import limit.")
    }
    entries.set(name, {
      compressionMethod,
      flags,
      compressedSize,
      uncompressedSize,
      centralOffset,
      localHeaderOffset: readUint32(view, offset + 42),
    })
    offset += recordLength
  }
  if (offset !== centralOffset + centralSize)
    throw new Error("The workbook has an inconsistent central directory.")
  return entries
}

async function unzipText(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  name: string,
): Promise<string | null> {
  const entry = entries.get(name)
  if (!entry) return null
  if (entry.uncompressedSize > MAX_XLSX_ENTRY_BYTES) {
    throw new Error(`Workbook entry ${name} is too large to import safely.`)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!rangeIsInside(bytes, entry.localHeaderOffset, 30)) {
    throw new Error(`Workbook entry ${name} points outside the file.`)
  }
  if (readUint32(view, entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Workbook entry ${name} has an invalid local header.`)
  }
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true)
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true)
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength
  if (
    textDecoder.decode(
      bytes.subarray(
        entry.localHeaderOffset + 30,
        entry.localHeaderOffset + 30 + nameLength,
      ),
    ) !== name ||
    view.getUint16(entry.localHeaderOffset + 6, true) !== entry.flags ||
    view.getUint16(entry.localHeaderOffset + 8, true) !==
      entry.compressionMethod
  ) {
    throw new Error("The workbook has inconsistent local ZIP headers.")
  }
  if (
    !rangeIsInside(bytes, dataOffset, entry.compressedSize) ||
    dataOffset + entry.compressedSize > entry.centralOffset
  ) {
    throw new Error(
      `Workbook entry ${name} has an invalid compressed data range.`,
    )
  }
  const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize)

  if (entry.compressionMethod === 0) {
    if (compressed.byteLength > MAX_XLSX_ENTRY_BYTES) {
      throw new Error(
        `Workbook entry ${name} expands beyond the safe import limit.`,
      )
    }
    if (compressed.byteLength !== entry.uncompressedSize)
      throw new Error("Workbook entry size does not match its declaration.")
    return textDecoder.decode(compressed)
  }
  if (entry.compressionMethod !== 8) {
    throw new Error(
      `Workbook entry ${name} uses an unsupported compression method.`,
    )
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot open compressed .xlsx files. Save the sheet as CSV and retry.",
    )
  }
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let outputSize = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    outputSize += value.byteLength
    if (
      outputSize > MAX_XLSX_ENTRY_BYTES ||
      outputSize > Math.max(1, entry.compressedSize) * MAX_XLSX_EXPANSION_RATIO
    ) {
      await reader.cancel()
      throw new Error(
        `Workbook entry ${name} expands beyond the safe import limit.`,
      )
    }
    chunks.push(value)
  }
  if (outputSize !== entry.uncompressedSize)
    throw new Error("Workbook entry size does not match its declaration.")
  const uncompressed = new Uint8Array(outputSize)
  let chunkOffset = 0
  for (const chunk of chunks) {
    uncompressed.set(chunk, chunkOffset)
    chunkOffset += chunk.byteLength
  }
  return textDecoder.decode(uncompressed)
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&#(\d+);/g, (_, digits: string) =>
      String.fromCodePoint(Number(digits)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "i"),
  )
  return match ? decodeXml(match[1] ?? "") : undefined
}

function xmlTextRuns(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join("")
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) =>
    xmlTextRuns(match[1] ?? ""),
  )
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? ""
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return Math.max(0, index - 1)
}

function parseDateStyleIndexes(stylesXml: string | null): Set<number> {
  const dateStyleIndexes = new Set<number>()
  if (!stylesXml) return dateStyleIndexes
  const customFormats = new Map<number, string>()
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?\s*>/gi)) {
    const id = Number(xmlAttribute(match[1] ?? "", "numFmtId"))
    const code = xmlAttribute(match[1] ?? "", "formatCode") ?? ""
    if (Number.isFinite(id)) customFormats.set(id, code)
  }
  const cellXfs =
    stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] ?? ""
  let styleIndex = 0
  for (const match of cellXfs.matchAll(/<xf\b([^>]*)\/?\s*>/gi)) {
    const numFmtId = Number(xmlAttribute(match[1] ?? "", "numFmtId") ?? 0)
    const customCode = customFormats.get(numFmtId) ?? ""
    const normalizedCode = customCode
      .replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")
      .toLowerCase()
    if (
      (numFmtId >= 14 && numFmtId <= 22) ||
      (numFmtId >= 45 && numFmtId <= 47) ||
      /[ymdhis]/.test(normalizedCode)
    ) {
      dateStyleIndexes.add(styleIndex)
    }
    styleIndex += 1
  }
  return dateStyleIndexes
}

function excelDate(value: string, uses1904Dates: boolean): string {
  const serial = Number(value)
  if (!Number.isFinite(serial)) return value
  const epochDays = uses1904Dates ? 24_107 : 25_569
  const date = new Date((serial - epochDays) * 86_400_000)
  if (!Number.isFinite(date.getTime())) return value
  const iso = date.toISOString()
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.replace(/\.000Z$/, "Z")
}

function cellValue(
  attributes: string,
  contents: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
  uses1904Dates: boolean,
): string {
  const type = xmlAttribute(attributes, "t")
  if (type === "inlineStr") return xmlTextRuns(contents)
  const raw = decodeXml(
    contents.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "",
  )
  if (type === "s") return sharedStrings[Number(raw)] ?? ""
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE"
  if (type === "str" || type === "e") return raw
  const styleIndex = Number(xmlAttribute(attributes, "s"))
  return dateStyles.has(styleIndex) ? excelDate(raw, uses1904Dates) : raw
}

function matrixToCsv(matrix: string[][]): string {
  return matrix
    .map((row) =>
      row
        .map((cell) => `"${cell.replace(/\r?\n/g, " ").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n")
}

function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
  uses1904Dates: boolean,
): string[][] {
  const matrix: string[][] = []
  const coordinates = new Set<string>()
  let cellCount = 0
  const populatedRows = new Set<number>()
  for (const match of xml.matchAll(
    /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\s*\/>)/gi,
  )) {
    cellCount += 1
    if (cellCount > MAX_XLSX_CELLS) {
      throw new Error(
        `Workbook exceeds the ${MAX_XLSX_CELLS.toLocaleString()} cell import limit.`,
      )
    }
    const attributes = match[1] ?? ""
    const reference = xmlAttribute(attributes, "r") ?? ""
    const coordinate = reference.match(/^([A-Za-z]+)(\d+)$/)
    if (!coordinate)
      throw new Error(
        `Workbook contains an invalid cell coordinate: ${reference || "(empty)"}.`,
      )
    if (coordinates.has(reference.toUpperCase()))
      throw new Error("Workbook contains duplicate cell coordinates.")
    coordinates.add(reference.toUpperCase())
    const rowNumber = Number(coordinate[2])
    if (!rowNumber || rowNumber > MAX_XLSX_ROWS) {
      throw new Error(
        `Workbook row ${rowNumber || reference} exceeds the ${MAX_XLSX_ROWS.toLocaleString()} row import limit.`,
      )
    }
    const rowIndex = rowNumber - 1
    const colIndex = columnIndex(coordinate[1] ?? "")
    if (colIndex >= MAX_XLSX_COLUMNS) {
      throw new Error(
        `Workbook column ${coordinate[1]} exceeds the ${MAX_XLSX_COLUMNS} column import limit.`,
      )
    }
    const row = matrix[rowIndex] ?? []
    while (row.length <= colIndex) row.push("")
    row[colIndex] = cellValue(
      attributes,
      match[2] ?? "",
      sharedStrings,
      dateStyles,
      uses1904Dates,
    )
    matrix[rowIndex] = row
    populatedRows.add(rowIndex)
  }

  const width = matrix.reduce((max, row) => Math.max(max, row?.length ?? 0), 0)
  if (populatedRows.size * width > MAX_XLSX_MATRIX_CELLS) {
    throw new Error("Workbook dimensions are too large to import safely.")
  }
  return matrix
    .map((row) => {
      const normalized = row ?? []
      while (normalized.length < width) normalized.push("")
      return normalized
    })
    .filter((row) => row.some((cell) => cell.trim().length > 0))
}

export function filterMappingForHeaders(
  mapping: Record<string, string>,
  headers: string[],
): Record<string, string> {
  const headerSet = new Set(headers)
  return Object.fromEntries(
    Object.entries(mapping).filter(([header]) => headerSet.has(header)),
  )
}

export function buildMappedImportCsv(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
  skippedRowIndexes: Set<number>,
): string {
  return buildCanonicalCsv(
    headers,
    rows.filter((_, index) => !skippedRowIndexes.has(index)),
    filterMappingForHeaders(mapping, headers),
  )
}

export async function parseXlsxWorkbook(
  arrayBuffer: ArrayBuffer,
): Promise<ParsedImportFile> {
  if (arrayBuffer.byteLength > MAX_XLSX_BYTES) {
    throw new Error(
      `Workbook exceeds the ${MAX_XLSX_BYTES / 1_000_000} MB upload limit.`,
    )
  }
  const bytes = new Uint8Array(arrayBuffer)
  const entries = zipEntries(bytes)
  const worksheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    )
  if (worksheetNames.length > 1) {
    throw new Error(
      "The workbook contains multiple worksheets. Keep only the sheet you want to import, save a copy, and retry.",
    )
  }
  const worksheetName = worksheetNames[0]
  if (!worksheetName)
    throw new Error("The workbook does not contain a worksheet.")

  // Inspect every XML part, including parts not selected for the data matrix.
  // Sequential expansion bounds peak memory and prevents hidden parts bypassing policy.
  const parts = new Map<string, string>()
  let actualExpandedBytes = 0
  for (const name of entries.keys()) {
    const xml = await unzipText(bytes, entries, name)
    if (xml === null) throw new Error("Workbook part could not be read.")
    actualExpandedBytes += new TextEncoder().encode(xml).byteLength
    if (actualExpandedBytes > MAX_XLSX_EXPANDED_BYTES)
      throw new Error("The workbook expands beyond the safe import limit.")
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<\?(?!xml\b)/i.test(xml)) {
      throw new Error(
        "Workbook DTDs, entities and processing instructions are not supported.",
      )
    }
    const decoded = decodeXml(xml)
    if (
      /TargetMode\s*=\s*["']External["']/i.test(decoded) ||
      (name === "[Content_Types].xml" &&
        /macroEnabled|vbaProject|activeX|oleObject|externalLink/i.test(
          decoded,
        )) ||
      /<(?:[\w.-]+:)?(?:oleObject|externalLink|connection|queryTable)\b/i.test(
        xml,
      )
    ) {
      throw new Error("The workbook contains external links or active content.")
    }
    if (/<(?:[\w.-]+:)?(?:f|formula|definedName)(?:\s|\/|>)/i.test(xml)) {
      throw new Error(
        "Workbook formulas are not supported. Replace formulas with reviewed values and retry.",
      )
    }
    if (
      /<(?:[\w.-]+:)?sheet\b[^>]*\bstate\s*=\s*["'](?:hidden|veryHidden)["']/i.test(
        decoded,
      ) ||
      /<(?:[\w.-]+:)?(?:row|col)\b[^>]*\bhidden\s*=\s*["'](?:1|true)["']/i.test(
        decoded,
      )
    ) {
      throw new Error(
        "Hidden workbook sheets, rows or columns are not supported for import.",
      )
    }
    if (
      /^xl\/worksheets\//i.test(name) &&
      (/<(?:[\w.-]+:)?extLst\b/i.test(xml) ||
        /<\/?[\w.-]+:(?:worksheet|sheetData|row|c|si|is|t)\b/i.test(xml) ||
        [...xml.matchAll(/\bxmlns\s*=\s*["']([^"']*)["']/g)].some(
          (match) =>
            match[1] !==
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        ))
    ) {
      throw new Error(
        "Workbook extension cells or foreign worksheet namespaces are not supported.",
      )
    }
    parts.set(name, xml)
  }
  const worksheetXml = parts.get(worksheetName)
  const sharedStringsXml = parts.get("xl/sharedStrings.xml") ?? null
  const stylesXml = parts.get("xl/styles.xml") ?? null
  const workbookXml = parts.get("xl/workbook.xml") ?? null
  if (!worksheetXml)
    throw new Error("The workbook worksheet could not be read.")
  const sharedStrings = parseSharedStrings(sharedStringsXml)
  const dateStyles = parseDateStyleIndexes(stylesXml)
  const uses1904Dates = /<workbookPr\b[^>]*date1904=["'](?:1|true)["']/i.test(
    workbookXml ?? "",
  )
  const matrix = parseWorksheet(
    worksheetXml,
    sharedStrings,
    dateStyles,
    uses1904Dates,
  )
  const headers = matrix[0] ?? []
  if (headers.length === 0)
    throw new Error("The first worksheet has no header row.")
  const rows = matrix.slice(1)
  const sheetName = decodeXml(
    workbookXml?.match(/<sheet\b[^>]*name=["']([^"']*)["']/i)?.[1] ?? "Sheet 1",
  )
  const csvText = matrixToCsv(matrix)
  parseCsvText(csvText)
  return { csvText, headers, rows, format: "xlsx", sheetName }
}

/** Send the original bytes to server admission; no browser boolean proves inspection. */
export async function readImportFile(
  file: File,
  scope?: { companyId: number | bigint | string; csvDelimiter?: CsvSourceDelimiter },
): Promise<ParsedImportFile> {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  if (extension === ".xls") {
    throw new Error(
      "Legacy .xls files are not supported. Save the workbook as .xlsx or CSV and retry.",
    )
  }
  if (extension !== ".csv" && extension !== ".xlsx")
    throw new Error("Choose a .csv or .xlsx file.")
  const maximum =
    extension === ".xlsx" ? MAX_XLSX_BYTES : CSV_IMPORT_LIMITS.bytes
  if (file.size === 0 || file.size > maximum)
    throw new Error("The import file is empty or exceeds the upload limit.")
  const companyId = scope ? String(scope.companyId) : undefined
  if (
    companyId !== undefined &&
    (!/^[1-9]\d*$/.test(companyId) ||
      BigInt(companyId) > 18_446_744_073_709_551_615n ||
      (typeof scope?.companyId === "number" &&
        !Number.isSafeInteger(scope.companyId)))
  ) {
    throw new Error(
      "Select a valid operating company before inspecting the file.",
    )
  }
  const query = new URLSearchParams()
  if (companyId) query.set("companyId", companyId)
  if (extension === ".csv" && scope?.csvDelimiter)
    query.set("csvDelimiter", scope.csvDelimiter)
  const path = "/api/import/inspect-file" + (query.size > 0 ? "?" + query : "")
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  })
  if (!response.ok) {
    let message =
      "File inspection could not be completed. Retry or replace the file."
    try {
      const error = (await response.json()) as { error?: unknown }
      if (typeof error.error === "string") message = error.error.slice(0, 1_000)
    } catch {
      /* A failed/non-JSON inspection never falls back to local parsing. */
    }
    throw new Error(message)
  }
  const result: ImportInspectionPayload | null = await response.json()
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    (companyId !== undefined && result.companyId !== companyId) ||
    (result.sourceAdmissionId !== undefined &&
      (typeof result.sourceAdmissionId !== "string" ||
        !/^[a-f0-9]{32}$/.test(result.sourceAdmissionId))) ||
    (extension === ".xlsx" && result.sourceAdmissionId === undefined) ||
    typeof result.csvText !== "string" ||
    result.format !== extension.slice(1) ||
    typeof result.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(result.sourceSha256) ||
    typeof result.policyVersion !== "string" ||
    result.policyVersion.length === 0 ||
    result.policyVersion.length > 128 ||
    (result.sourceDelimiter != null &&
      (extension !== ".csv" || !isCsvSourceDelimiter(result.sourceDelimiter))) ||
    (extension === ".csv" && scope?.csvDelimiter != null &&
      result.sourceDelimiter !== scope.csvDelimiter) ||
    (result.sourceEncoding != null &&
      result.sourceEncoding !== "utf-8" &&
      result.sourceEncoding !== "utf-16le" &&
      result.sourceEncoding !== "utf-16be") ||
    (result.sheetName !== undefined &&
      result.sheetName !== null &&
      (typeof result.sheetName !== "string" || result.sheetName.length > 255))
  ) {
    throw new Error("File inspection returned an invalid result.")
  }
  const headers = result.headers as string[]
  const rows = result.rows as string[][]
  validateCsvMatrix(headers, rows)
  const parsed = parseCsvText(result.csvText)
  if (
    JSON.stringify(parsed.headers) !== JSON.stringify(headers) ||
    JSON.stringify(parsed.rows) !== JSON.stringify(rows)
  ) {
    throw new Error("File inspection returned inconsistent normalized data.")
  }
  return {
    csvText: result.csvText,
    headers,
    rows,
    format: result.format as "csv" | "xlsx",
    ...(typeof result.sheetName === "string"
      ? { sheetName: result.sheetName }
      : {}),
    sourceSha256: result.sourceSha256,
    ...(typeof result.sourceAdmissionId === "string"
      ? { sourceAdmissionId: result.sourceAdmissionId }
      : {}),
    policyVersion: result.policyVersion,
    ...(isCsvSourceDelimiter(result.sourceDelimiter)
      ? { sourceDelimiter: result.sourceDelimiter }
      : {}),
    ...(typeof result.sourceEncoding === "string"
      ? { sourceEncoding: result.sourceEncoding }
      : {}),
  }
}
