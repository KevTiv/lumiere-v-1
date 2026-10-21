import { parseCsvText, scanCsvMatrix } from "@lumiere/erp-shared"
import type { MarginSupplyScenarioProvenance } from "@lumiere/erp-shared/report-schemas"

import {
  MARGIN_SUPPLY_SCENARIO_FIELDS,
  type MarginSupplyScenarioDraft,
  type MarginSupplyScenarioFieldKey,
} from "./margin-supply-outlook-config"

export const MARGIN_SUPPLY_SCENARIO_CSV_NAME_HEADER = "scenario_name"

export const MARGIN_SUPPLY_SCENARIO_CSV_LIMITS = {
  maxBytes: 64_000,
  maxRows: 25,
} as const

export interface MarginSupplyScenarioImportProvenance extends MarginSupplyScenarioProvenance {
  source: "controlled_csv"
  fileName: string
  importedAt: string
  rowNumber: number
}

export interface ImportedMarginSupplyScenario {
  name: string
  draft: MarginSupplyScenarioDraft
  provenance: MarginSupplyScenarioImportProvenance
}

export const MARGIN_SUPPLY_SCENARIO_CSV_HEADERS = [
  MARGIN_SUPPLY_SCENARIO_CSV_NAME_HEADER,
  ...MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => field.csvHeader),
] as const

const STRICT_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase()
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function describeRange(min: number, max: number): string {
  return `${min} to ${max}`
}

/**
 * Parses a small, local scenario file. Every cell is validated before any row can
 * be selected, and selecting a row only fills the manual scenario form.
 */
export function parseMarginSupplyScenarioCsv(
  text: string,
  fileName: string,
  importedAt = new Date().toISOString(),
): ImportedMarginSupplyScenario[] {
  if (!fileName.trim()) throw new Error("The CSV file name is required for provenance.")
  if (!fileName.toLowerCase().endsWith(".csv")) throw new Error("The scenario file name must end in .csv.")
  if (byteLength(fileName) > 255) throw new Error("The scenario file name must be 255 bytes or fewer.")
  if (/\p{Cc}/u.test(fileName)) throw new Error("The scenario file name contains unsupported control characters.")
  if (byteLength(text) > MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes) {
    throw new Error(`CSV exceeds the ${MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes.toLocaleString()} byte alpha limit.`)
  }
  const physicalLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  let lastContentLine = physicalLines.length - 1
  while (lastContentLine >= 0 && physicalLines[lastContentLine]?.trim().length === 0) {
    lastContentLine -= 1
  }
  if (physicalLines.slice(0, lastContentLine + 1).some((line) => line.trim().length === 0)) {
    throw new Error("Blank lines are not allowed because CSV row provenance must match the physical source row.")
  }

  const parsed = parseCsvText(text)
  const headers = parsed.headers.map(normalizedHeader)
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Duplicate CSV headers are not allowed: ${[...new Set(duplicates)].join(", ")}.`)
  }

  const expected = [...MARGIN_SUPPLY_SCENARIO_CSV_HEADERS]
  const missing = expected.filter((header) => !headers.includes(header))
  const unknown = headers.filter((header) => !expected.includes(header as typeof expected[number]))
  if (missing.length > 0) throw new Error(`Missing required CSV headers: ${missing.join(", ")}.`)
  if (unknown.length > 0) throw new Error(`Unknown CSV headers are not allowed: ${unknown.join(", ")}.`)
  if (parsed.rows.length === 0) throw new Error("The CSV must contain at least one scenario row.")
  if (parsed.rows.length > MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxRows) {
    throw new Error(`CSV contains ${parsed.rows.length} rows; the alpha limit is ${MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxRows}.`)
  }

  const nameIndex = headers.indexOf(MARGIN_SUPPLY_SCENARIO_CSV_NAME_HEADER)
  const safety = scanCsvMatrix(
    [MARGIN_SUPPLY_SCENARIO_CSV_NAME_HEADER],
    parsed.rows.map((row) => [row[nameIndex] ?? ""]),
  )
  if (safety.blockedCellCount > 0) {
    throw new Error(`CSV contains ${safety.blockedCellCount} unsafe formula or instruction-like cell(s).`)
  }

  const headerIndexes = new Map(headers.map((header, index) => [header, index]))
  return parsed.rows.map((row, rowIndex) => {
    const csvRowNumber = rowIndex + 2
    if (row.length !== headers.length) {
      throw new Error(`CSV row ${csvRowNumber} has ${row.length} cells; expected ${headers.length}.`)
    }
    const name = row[headerIndexes.get(MARGIN_SUPPLY_SCENARIO_CSV_NAME_HEADER)!]?.trim() ?? ""
    if (!name) throw new Error(`CSV row ${csvRowNumber}: scenario_name is required.`)
    if (name.length > 80) throw new Error(`CSV row ${csvRowNumber}: scenario_name must be 80 characters or fewer.`)

    const draft = Object.fromEntries(MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => {
      const raw = row[headerIndexes.get(field.csvHeader)!]?.trim() ?? ""
      if (raw === "") throw new Error(`CSV row ${csvRowNumber}: ${field.csvHeader} is required.`)
      if (!STRICT_DECIMAL.test(raw)) {
        throw new Error(`CSV row ${csvRowNumber}: ${field.csvHeader} must use plain decimal notation.`)
      }
      const value = Number(raw)
      if (!Number.isFinite(value)) throw new Error(`CSV row ${csvRowNumber}: ${field.csvHeader} must be a number.`)
      if (value < field.min || value > field.max) {
        throw new Error(`CSV row ${csvRowNumber}: ${field.csvHeader} must be ${describeRange(field.min, field.max)}.`)
      }
      if (field.step >= 1 && !Number.isInteger(value)) {
        throw new Error(`CSV row ${csvRowNumber}: ${field.csvHeader} must be a whole number.`)
      }
      return [field.key, raw]
    })) as MarginSupplyScenarioDraft

    return {
      name,
      draft,
      provenance: {
        source: "controlled_csv",
        fileName,
        importedAt,
        rowNumber: csvRowNumber,
      },
    }
  })
}

export function marginSupplyScenarioCsvTemplate(): string {
  const sampleByKey: Record<MarginSupplyScenarioFieldKey, string> = {
    inputCostChangePct: "10",
    demandChangePct: "0",
    leadTimeChangeDays: "7",
    targetMarginPct: "25",
  }
  return `${MARGIN_SUPPLY_SCENARIO_CSV_HEADERS.join(",")}\nBaseline shock,${MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => sampleByKey[field.key]).join(",")}\n`
}
