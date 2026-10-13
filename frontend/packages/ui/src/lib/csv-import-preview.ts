import { parseCsvText } from "@lumiere/erp-shared"

/** Columns a server `import_*_csv` reducer reads: it rejects a row that lacks a `required` one. */
export interface CsvImportColumns {
  /** Header names (lower-case, as the reducer lowercases them) every row must supply. */
  required: readonly string[]
  /** Header names the reducer also reads when present. */
  optional?: readonly string[]
}

export interface CsvImportAnalysis {
  headers: string[]
  rowCount: number
  /** The first rows, for the preview grid. */
  previewRows: string[][]
  /** Required headers the file does not have; these block the import. */
  missingRequired: string[]
  /** Headers the reducer ignores; shown as a warning only. */
  unknownColumns: string[]
}

export const CSV_PREVIEW_ROW_LIMIT = 5

const UTF8_BOM = /^﻿/

/**
 * Parse a CSV the same way the reducers do (comma-separated, quoted fields, no multi-line cells)
 * and check its header against the expected columns. Throws on an empty or oversized file.
 */
export function analyzeCsv(
  text: string,
  columns?: CsvImportColumns,
  previewLimit = CSV_PREVIEW_ROW_LIMIT,
): CsvImportAnalysis {
  const { headers: rawHeaders, rows } = parseCsvText(text.replace(UTF8_BOM, ""))
  const headers = rawHeaders.map((header) => header.trim().toLowerCase())
  const known = new Set([...(columns?.required ?? []), ...(columns?.optional ?? [])])
  return {
    headers,
    rowCount: rows.length,
    previewRows: rows.slice(0, previewLimit),
    missingRequired: (columns?.required ?? []).filter((name) => !headers.includes(name)),
    unknownColumns: columns ? headers.filter((name) => name !== "" && !known.has(name)) : [],
  }
}

/** The import can be submitted only when the file has rows and every required header. */
export function canSubmitCsvImport(analysis: CsvImportAnalysis | null): boolean {
  return analysis !== null && analysis.rowCount > 0 && analysis.missingRequired.length === 0
}

/** A header-only CSV listing required columns first, then the optional ones. */
export function buildCsvTemplate(columns: CsvImportColumns): string {
  return [...columns.required, ...(columns.optional ?? [])].join(",") + "\n"
}
