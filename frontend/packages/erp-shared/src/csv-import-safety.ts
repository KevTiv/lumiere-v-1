export type CsvSafetyFinding = {
  location: string
  kind: 'formula_injection' | 'prompt_injection' | 'oversized_cell' | string
  message: string
  severity: 'error' | 'warning' | string
}

export type CsvSafetyReport = {
  findings: CsvSafetyFinding[]
  blockedCellCount: number
  isSafeForAi: boolean
}

const PROMPT_INJECTION_NEEDLES = [
  'ignore previous instructions',
  'ignore all previous',
  'system:',
  'assistant:',
  'you are now',
  'disregard prior',
  '<|im_start|>',
  'developer mode',
] as const

const MAX_CSV_BYTES = 512_000
const MAX_CELL_CHARS = 4_000

export function isFormulaInjection(value: string): boolean {
  const trimmed = value.trimStart()
  return (
    trimmed.startsWith('=') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('\t') ||
    trimmed.startsWith('\r') ||
    trimmed.startsWith('|')
  )
}

export function isPromptInjection(value: string): boolean {
  const lower = value.toLowerCase()
  return PROMPT_INJECTION_NEEDLES.some((needle) => lower.includes(needle))
}

export function scanCsvCell(location: string, value: string): CsvSafetyFinding[] {
  const findings: CsvSafetyFinding[] = []
  if (isFormulaInjection(value)) {
    findings.push({
      location,
      kind: 'formula_injection',
      message: 'Cell begins with a spreadsheet formula prefix (=, +, -, @)',
      severity: 'error',
    })
  }
  if (isPromptInjection(value)) {
    findings.push({
      location,
      kind: 'prompt_injection',
      message: 'Cell contains instruction-like text unsafe for AI import analysis',
      severity: 'error',
    })
  }
  if (value.length > MAX_CELL_CHARS) {
    findings.push({
      location,
      kind: 'oversized_cell',
      message: `Cell exceeds ${MAX_CELL_CHARS} characters`,
      severity: 'warning',
    })
  }
  return findings
}

export function scanCsvMatrix(headers: string[], rows: string[][]): CsvSafetyReport {
  const findings: CsvSafetyFinding[] = []

  headers.forEach((header, idx) => {
    findings.push(...scanCsvCell(`header[${idx}]`, header))
  })

  rows.slice(0, 50).forEach((row, rowIdx) => {
    row.forEach((value, colIdx) => {
      findings.push(...scanCsvCell(`row[${rowIdx}].col[${colIdx}]`, value))
    })
  })

  const blockedCellCount = findings.filter((finding) => finding.severity === 'error').length
  return {
    findings,
    blockedCellCount,
    isSafeForAi: blockedCellCount === 0,
  }
}

/** Prefix dangerous spreadsheet formula cells so Excel/Sheets will not execute them. */
export function neutralizeCsvCell(value: string): string {
  if (!isFormulaInjection(value)) return value
  return `'${value}`
}

export function splitCsvRow(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"' && !inQuotes) {
      inQuotes = true
      continue
    }
    if (ch === '"' && inQuotes) {
      if (line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = false
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }

  fields.push(current.trim())
  return fields
}

export function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  if (text.length > MAX_CSV_BYTES) {
    throw new Error(`CSV exceeds maximum size of ${MAX_CSV_BYTES} bytes`)
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.length > 0)
  const headerLine = lines[0]
  if (!headerLine) {
    throw new Error('CSV is empty')
  }
  const headers = splitCsvRow(headerLine)
  if (headers.length === 0) {
    throw new Error('CSV header row is empty')
  }
  const rows = lines.slice(1).map(splitCsvRow)
  return { headers, rows }
}

export function assertCsvSafeForAi(headers: string[], rows: string[][]): CsvSafetyReport {
  const report = scanCsvMatrix(headers, rows)
  if (!report.isSafeForAi) {
    throw new Error(
      `CSV content failed safety scan: ${report.blockedCellCount} blocked cell(s)`,
    )
  }
  return report
}

export function sanitizeImportSkillInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...inputs }

  const csvText =
    typeof inputs.csvText === 'string'
      ? inputs.csvText
      : typeof inputs.csv_text === 'string'
        ? inputs.csv_text
        : undefined

  if (csvText) {
    const { headers, rows } = parseCsvText(csvText)
    assertCsvSafeForAi(headers, rows)
    out.headers = headers
    out.sample_rows = rows.slice(0, 50)
    out.header = headers
    return out
  }

  const headers = Array.isArray(inputs.headers)
    ? inputs.headers.filter((value): value is string => typeof value === 'string')
    : Array.isArray(inputs.header)
      ? inputs.header.filter((value): value is string => typeof value === 'string')
      : []

  const rows = Array.isArray(inputs.sample_rows)
    ? inputs.sample_rows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.filter((cell): cell is string => typeof cell === 'string'))
    : Array.isArray(inputs.sampleRows)
      ? inputs.sampleRows
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row) => row.filter((cell): cell is string => typeof cell === 'string'))
      : []

  if (headers.length > 0 || rows.length > 0) {
    assertCsvSafeForAi(headers, rows)
  }

  return out
}
