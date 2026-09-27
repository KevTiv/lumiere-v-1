import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

const UTF8_BOM = /^\uFEFF/

function normalizeCsvSource(csvData: string): string {
  return csvData.replace(UTF8_BOM, "")
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let value = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === delimiter && !quoted) {
      values.push(value.trim())
      value = ""
    } else {
      value += character
    }
  }
  values.push(value.trim())
  return values
}

function parseStatementDate(value: string): Date | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return undefined
    }
    return date
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
    return undefined
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseStatementAmount(value: string): number | undefined {
  const compact = value.replaceAll(/\s/g, "")
  if (compact === "") return undefined
  const europeanGroupedDecimal = /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(compact)
  const usGroupedInteger = /^[+-]?\d{1,3}(?:,\d{3})+$/.test(compact)
  const normalized = europeanGroupedDecimal
    ? compact.replaceAll(".", "").replace(",", ".")
    : usGroupedInteger
      ? compact.replaceAll(",", "")
      : compact.includes(",") && !compact.includes(".")
        ? compact.replace(",", ".")
        : compact.replaceAll(",", "")
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : undefined
}

export function statementImportRows(csvData: string) {
  const lines = normalizeCsvSource(csvData).split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error("Add a header and at least one statement row")
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ","
  const headers = parseCsvLine(lines[0], delimiter).map((header) =>
    header.toLowerCase().replaceAll(/[^a-z0-9]/g, ""),
  )
  const dateIndex = headers.findIndex((header) => header === "date" || header === "transactiondate")
  const amountIndex = headers.findIndex((header) => header === "amount" || header === "transactionamount")
  if (dateIndex < 0 || amountIndex < 0) throw new Error("CSV needs date and amount columns")
  const referenceIndex = headers.findIndex((header) => ["reference", "ref", "transactionid"].includes(header))
  const descriptionIndex = headers.findIndex((header) => ["description", "memo", "narration"].includes(header))

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line, delimiter)
    const date = parseStatementDate(values[dateIndex] ?? "")
    return {
      rowNumber: index + 2,
      date: date ? stbTimestampFromDate(date) : undefined,
      amount: parseStatementAmount(values[amountIndex] ?? ""),
      reference: values[referenceIndex] || undefined,
      description: values[descriptionIndex] || undefined,
    }
  })
}

export async function statementImportIdempotencyKey(
  companyId: bigint,
  journalId: bigint,
  currencyId: bigint,
  csvData: string,
): Promise<string> {
  const normalizedCsv = normalizeCsvSource(csvData).replace(/\r\n/g, "\n").trim()
  const source = `${companyId}:${journalId}:${currencyId}:${normalizedCsv}`
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return `statement-csv-sha256-${hex}`
}
