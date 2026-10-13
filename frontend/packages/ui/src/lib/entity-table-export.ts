import type { ColumnType, EntityColumn, EntityRow } from "./entity-view-types"
import { formatTimestampLike, getRowField, unwrapEntityValue } from "./entity-row-values"

/** Most rows one export writes; larger lists are cut here and the user is warned. */
export const EXPORT_ROW_LIMIT = 50_000

/** Lets Excel read the file as UTF-8. */
export const CSV_BOM = "﻿"

const DATE_COLUMN_TYPES: ReadonlySet<ColumnType | undefined> = new Set(["date", "datetime", "relative-date"])

/**
 * Stops spreadsheets from running a cell as a formula: text starting with = + - @ tab or CR gets a
 * leading single quote.
 */
export function guardCsvInjection(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break; quotes are doubled. */
export function escapeCsvField(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function plainNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

/**
 * Plain-text value of a cell for export. Independent of how the table renders it: no locale
 * formatting, no currency symbols, no React output. Dates are ISO (date-only for `date` columns),
 * numbers and bigints are raw, booleans are yes / no, enums and options are unwrapped.
 */
export function exportCellValue(rawValue: unknown, type?: ColumnType): string {
  const value = unwrapEntityValue(rawValue)
  if (value == null) return ""
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "number") {
    if (DATE_COLUMN_TYPES.has(type)) {
      const date = formatTimestampLike(value)
      if (date) return exportDate(date, type)
    }
    return plainNumber(value)
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") {
    if (DATE_COLUMN_TYPES.has(type)) {
      const date = formatTimestampLike(value)
      if (date) return exportDate(date, type)
    }
    return guardCsvInjection(value)
  }
  const date = formatTimestampLike(value)
  if (date) return exportDate(date, type)
  try {
    return guardCsvInjection(
      JSON.stringify(value, (_key, inner: unknown) => (typeof inner === "bigint" ? inner.toString() : inner)) ?? "",
    )
  } catch {
    return ""
  }
}

function exportDate(date: Date, type?: ColumnType): string {
  const iso = date.toISOString()
  return type === "date" ? iso.slice(0, 10) : iso
}

/**
 * Columns that may leave the app: those a column marks `sensitive` (secrets, masked identifiers)
 * are never written.
 */
export function exportableColumns<T extends Pick<EntityColumn, "sensitive">>(columns: readonly T[]): T[] {
  return columns.filter((column) => !column.sensitive)
}

/** Selected rows when any are selected, otherwise every row matching the current search and filters. */
export function selectExportRows<T>(selected: readonly T[], filtered: readonly T[]): T[] {
  return selected.length > 0 ? [...selected] : [...filtered]
}

/** The rows an export will write and whether the cap cut some off. */
export function capExportRows<T>(rows: readonly T[], limit = EXPORT_ROW_LIMIT): { rows: T[]; truncated: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), truncated: true } : { rows: [...rows], truncated: false }
}

/** CSV text (with BOM) for the given columns, in order, and rows. Lines end in CRLF. */
export function buildEntityTableCsv(
  columns: ReadonlyArray<Pick<EntityColumn, "key" | "label" | "type" | "sensitive">>,
  rows: readonly EntityRow[],
): string {
  const shown = exportableColumns(columns)
  const lines = [shown.map((column) => escapeCsvField(guardCsvInjection(column.label))).join(",")]
  for (const row of rows) {
    lines.push(shown.map((column) => escapeCsvField(exportCellValue(getRowField(row, column.key), column.type))).join(","))
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n"
}

/** `<listViewKey>-<yyyy-mm-dd>.csv`, safe as a file name. */
export function exportFilename(listViewKey: string | undefined, now: Date = new Date()): string {
  const base = (listViewKey ?? "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "export"
  return `${base}-${now.toISOString().slice(0, 10)}.csv`
}
