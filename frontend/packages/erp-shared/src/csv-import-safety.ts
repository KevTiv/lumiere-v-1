export type CsvSafetyFinding = {
  location: string
  kind: "formula_injection" | "prompt_injection" | "oversized_cell" | string
  message: string
  severity: "error" | "warning" | string
}

export type CsvSafetyReport = {
  findings: CsvSafetyFinding[]
  blockedCellCount: number
  /** Compatibility flag for the supplied matrix, never a benign-intent verdict. */
  isSafeForAi: boolean
  processingAllowed: boolean
  aiEligible: boolean
  inspectedRows: number
  inspectionScope: "provided_matrix"
  findingsTruncated: boolean
}

const PROMPT_INJECTION_NEEDLES = [
  "ignore previous instructions",
  "ignore all previous",
  "system:",
  "assistant:",
  "you are now",
  "disregard prior",
  "<|im_start|>",
  "developer mode",
] as const

export const CSV_IMPORT_LIMITS = {
  bytes: 2_000_000,
  rows: 25_000,
  columns: 200,
  cellCharacters: 4_000,
  matrixCells: 1_000_000,
  findings: 100,
  aiSampleRows: 50,
} as const

const encoder = new TextEncoder()
const SIGNED_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const PHONE_NUMBER = /^\+\d[\d ()-]*\d$/

/** Classification only. Accepted text remains untrusted in every consumer. */
export function isFormulaInjection(value: string): boolean {
  const trimmed = value
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .trimStart()
  if (
    (SIGNED_NUMBER.test(trimmed) && Number.isFinite(Number(trimmed))) ||
    (PHONE_NUMBER.test(trimmed) && (trimmed.match(/\d/g)?.length ?? 0) >= 4)
  )
    return false
  return /^[=+@|\-]/.test(trimmed)
}

export function isPromptInjection(value: string): boolean {
  const lower = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
  return PROMPT_INJECTION_NEEDLES.some((needle) => lower.includes(needle))
}

export function scanCsvCell(
  location: string,
  value: string,
): CsvSafetyFinding[] {
  const findings: CsvSafetyFinding[] = []
  if (isFormulaInjection(value))
    findings.push({
      location,
      kind: "formula_injection",
      message: "Cell contains a spreadsheet formula expression",
      severity: "error",
    })
  if (isPromptInjection(value))
    findings.push({
      location,
      kind: "prompt_injection",
      message: "Cell contains instruction-like text withheld from AI analysis",
      severity: "error",
    })
  return findings
}

function cellByteLength(value: string): number {
  if (
    value.length > CSV_IMPORT_LIMITS.cellCharacters * 2 ||
    Array.from(value).length > CSV_IMPORT_LIMITS.cellCharacters
  )
    throw new Error(
      "CSV cell exceeds " + CSV_IMPORT_LIMITS.cellCharacters + " characters",
    )
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error("CSV contains unsupported control characters")
  }
  return encoder.encode(value).byteLength
}

/** Validate every supplied cell before sampling. Server admission is independent. */
export function validateCsvMatrix(headers: string[], rows: string[][]): void {
  if (!Array.isArray(headers) || !Array.isArray(rows))
    throw new Error("CSV headers and rows must be arrays")
  if (headers.length === 0 || headers.length > CSV_IMPORT_LIMITS.columns) {
    throw new Error(
      "CSV must contain 1 to " + CSV_IMPORT_LIMITS.columns + " columns",
    )
  }
  if (rows.length > CSV_IMPORT_LIMITS.rows)
    throw new Error("CSV exceeds " + CSV_IMPORT_LIMITS.rows + " data rows")
  if ((rows.length + 1) * headers.length > CSV_IMPORT_LIMITS.matrixCells) {
    throw new Error("CSV matrix exceeds the cell limit")
  }
  let bytes = 0
  const addCell = (value: string) => {
    if (typeof value !== "string") throw new Error("CSV cells must be strings")
    bytes += cellByteLength(value)
    if (bytes > CSV_IMPORT_LIMITS.bytes) {
      throw new Error(
        "CSV exceeds maximum size of " + CSV_IMPORT_LIMITS.bytes + " bytes",
      )
    }
  }
  headers.forEach(addCell)
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > headers.length) {
      throw new Error("CSV row contains more fields than the header")
    }
    row.forEach(addCell)
  }
}

export function scanCsvMatrix(
  headers: string[],
  rows: string[][],
): CsvSafetyReport {
  validateCsvMatrix(headers, rows)
  const findings: CsvSafetyFinding[] = []
  let blockedCellCount = 0
  let findingCount = 0
  const inspect = (location: string, value: string) => {
    for (const finding of scanCsvCell(location, value)) {
      findingCount += 1
      if (finding.severity === "error") blockedCellCount += 1
      if (findings.length < CSV_IMPORT_LIMITS.findings) findings.push(finding)
    }
  }
  headers.forEach((header, idx) => inspect("header[" + idx + "]", header))
  rows.forEach((row, rowIdx) => {
    row.forEach((value, colIdx) =>
      inspect("row[" + rowIdx + "].col[" + colIdx + "]", value),
    )
  })
  return {
    findings,
    blockedCellCount,
    isSafeForAi: blockedCellCount === 0,
    processingAllowed: true,
    aiEligible: blockedCellCount === 0,
    inspectedRows: rows.length,
    inspectionScope: "provided_matrix",
    findingsTruncated: findingCount > findings.length,
  }
}

/**
 * Escape formula-prefixed text for CSV viewers, including benign signed text.
 * Callers must quote fields correctly. No CSV escape is universal across
 * applications and save/reopen cycles; typed XLSX string cells are preferred.
 */
export function neutralizeCsvCell(value: string): string {
  if (
    /^[\t\r\n]/.test(value) ||
    /^[=+@|\-]/.test(
      value
        .normalize("NFKC")
        .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
        .trimStart(),
    )
  )
    return "'" + value
  return value
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let state: "start" | "unquoted" | "quoted" | "closed" = "start"
  const endField = () => {
    cellByteLength(field)
    record.push(field.trim())
    if (record.length > CSV_IMPORT_LIMITS.columns)
      throw new Error("CSV exceeds " + CSV_IMPORT_LIMITS.columns + " columns")
    field = ""
    state = "start"
  }
  const endRecord = () => {
    endField()
    records.push(record)
    if (records.length > CSV_IMPORT_LIMITS.rows + 1)
      throw new Error("CSV exceeds " + CSV_IMPORT_LIMITS.rows + " data rows")
    record = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!
    if (state === "quoted") {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else state = "closed"
      } else field += ch
    } else if (ch === ",") endField()
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[index + 1] === "\n") index += 1
      endRecord()
    } else if (state === "closed") {
      if (ch !== " " && ch !== "\t")
        throw new Error("CSV contains text after a closing quote")
    } else if (ch === '"') {
      if (state !== "start" || field.trim().length > 0)
        throw new Error("CSV contains a quote inside an unquoted field")
      field = ""
      state = "quoted"
    } else {
      field += ch
      if (ch !== " " && ch !== "\t") state = "unquoted"
    }
    if (field.length > CSV_IMPORT_LIMITS.cellCharacters * 2)
      throw new Error(
        "CSV cell exceeds " + CSV_IMPORT_LIMITS.cellCharacters + " characters",
      )
  }
  if (state === "quoted")
    throw new Error("CSV contains an unterminated quoted field")
  // A trailing record delimiter ends the last record; it does not create another.
  if (record.length > 0 || field.length > 0 || state !== "start") endRecord()
  return records
}

export function splitCsvRow(line: string): string[] {
  const records = parseCsvRecords(line)
  if (records.length > 1) throw new Error("Expected one CSV record")
  return records[0] ?? [""]
}

export function parseCsvText(text: string): {
  headers: string[]
  rows: string[][]
} {
  if (
    text.length > CSV_IMPORT_LIMITS.bytes ||
    encoder.encode(text).byteLength > CSV_IMPORT_LIMITS.bytes
  ) {
    throw new Error(
      "CSV exceeds maximum size of " + CSV_IMPORT_LIMITS.bytes + " bytes",
    )
  }
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ""))
  const headers = records[0]
  if (!headers || headers.every((header) => header.length === 0))
    throw new Error("CSV is empty")
  const rows = records.slice(1)
  validateCsvMatrix(headers, rows)
  return { headers, rows }
}

export function assertCsvSafeForAi(
  headers: string[],
  rows: string[][],
): CsvSafetyReport {
  const report = scanCsvMatrix(headers, rows)
  if (!report.aiEligible)
    throw new Error(
      "CSV content failed safety scan: " +
        report.blockedCellCount +
        " blocked cell(s)",
    )
  return report
}

/** Reduce import context to inspected, bounded, allowlisted data only. */
export function sanitizeImportSkillInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const csvText = inputs.csvText ?? inputs.csv_text
  const parsed =
    csvText !== undefined
      ? (() => {
          if (typeof csvText !== "string")
            throw new Error("CSV text must be a string")
          return parseCsvText(csvText)
        })()
      : {
          headers: (inputs.headers ?? inputs.header ?? []) as string[],
          rows: (inputs.rows ??
            inputs.sample_rows ??
            inputs.sampleRows ??
            []) as string[][],
        }
  assertCsvSafeForAi(parsed.headers, parsed.rows)
  const out: Record<string, unknown> = {
    headers: parsed.headers,
    sample_rows: parsed.rows.slice(0, CSV_IMPORT_LIMITS.aiSampleRows),
  }
  for (const [target, raw] of [
    ["target_entity", inputs.target_entity ?? inputs.targetEntity],
    ["bundle_key", inputs.bundle_key ?? inputs.bundleKey],
  ] as const) {
    if (raw === undefined) continue
    if (typeof raw !== "string" || !/^[a-zA-Z0-9_.-]{1,80}$/.test(raw))
      throw new Error("Invalid import " + target)
    out[target] = raw
  }
  const mappings = inputs.prior_mappings ?? inputs.priorMappings
  if (mappings !== undefined) {
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings))
      throw new Error("Import mappings must be an object")
    const entries = Object.entries(mappings)
    if (entries.length > CSV_IMPORT_LIMITS.columns)
      throw new Error("Too many import mappings")
    if (
      entries.some(
        ([key, value]) =>
          key.length > 4_000 || typeof value !== "string" || value.length > 80,
      )
    )
      throw new Error("Invalid import mapping")
    out.prior_mappings = Object.fromEntries(entries)
  }
  return out
}
