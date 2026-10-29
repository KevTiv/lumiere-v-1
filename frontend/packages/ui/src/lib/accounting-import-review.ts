import { i18n as uiI18n } from "@lumiere/i18n"
import { parseCsvText } from "@lumiere/erp-shared"
import { parseAccountingImportNumber } from "@lumiere/erp-shared/accounting-import-reconciliation"

export interface AccountingImportReviewTotal {
  currency: string
  documentType: string
  field: string
  /** Exact decimal source sum; never round through a JavaScript number for display. */
  amount: string
}

export interface AccountingImportReview {
  rowCount: number
  referenceCount: number | null
  totals: AccountingImportReviewTotal[]
  issues: { rowNumber?: number; message: string }[]
}

const FIELDS: Record<string, readonly string[]> = {
  account_account: ["opening_debit", "opening_credit", "opening_balance"],
  account_move: ["amount_untaxed", "amount_tax", "amount_total"],
  account_move_line: ["debit", "credit"],
  crossovered_budget_lines: ["planned_amount"],
}

const SCALE = 1_000_000_000_000n
const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER) * SCALE

function decimalUnits(value: string): bigint {
  const [mantissa = "", exponentText] = value.toLowerCase().split("e")
  const exponent = Number(exponentText ?? 0)
  const negative = mantissa.startsWith("-")
  const [integer = "", fraction = ""] = mantissa.replace(/^[+-]/, "").split(".")
  const digits = (integer + fraction).replace(/^0+/, "") || "0"
  const places = fraction.length - exponent
  const trailing = Math.max(0, places - 12)
  if (trailing && !digits.endsWith("0".repeat(trailing))) throw new Error(uiI18n.t("accounting.builtIn.accountingImportReview.decimalUnits.error", { defaultValue: "supports at most 12 decimal places" }))
  const units = places <= 12 ? BigInt(digits) * 10n ** BigInt(12 - places) : BigInt(digits.slice(0, -trailing) || "0")
  return negative ? -units : units
}

function exactAmount(raw: string): bigint | null {
  const parsed = parseAccountingImportNumber(raw)
  if (parsed == null) return null
  const compact = raw.replace(/\s/g, "")
  // The authoritative parser validates separator patterns first. Choose its equivalent
  // decimal spelling while retaining source digits, rather than summing parsed floats.
  const normalized = [compact, compact.replaceAll(",", ""), compact.replace(",", "."), compact.replaceAll(".", ""), compact.replaceAll(".", "").replace(",", ".")]
    .find((candidate) => /^[+-]?\d+(?:\.\d+)?$/.test(candidate) && Number(candidate) === parsed)
  if (normalized == null) throw new Error(uiI18n.t("accounting.builtIn.accountingImportReview.exactAmount.error", { defaultValue: "has an unsupported decimal format" }))
  const units = decimalUnits(normalized)
  if (units > MAX_AMOUNT || units < -MAX_AMOUNT || units !== decimalUnits(String(parsed))) {
    throw new Error(uiI18n.t("accounting.builtIn.accountingImportReview.exactAmount.errorexceedsSupportedMonetaryMagnitudeOrPrecision", { defaultValue: "exceeds supported monetary magnitude or precision" }))
  }
  return units
}

function decimalString(units: bigint): string {
  const negative = units < 0n
  const positive = negative ? -units : units
  const fraction = String(positive % SCALE).padStart(12, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${positive / SCALE}${fraction ? `.${fraction}` : ""}`
}

/** Review the whole source file, keeping currency and document types separate. */
export function accountingImportReview(
  csvText: string,
  tableName?: string,
): AccountingImportReview | null {
  if (!tableName || !FIELDS[tableName]) return null
  const parsed = parseCsvText(csvText.replace(/^\uFEFF/, ""))
  const headers = parsed.headers.map((header) => header.trim().toLowerCase())
  const index = new Map(headers.map((header, at) => [header, at]))
  const outstanding = index.has("source_total") && index.has("opening_residual")
  const fields = outstanding ? ["source_total", "opening_residual"] : FIELDS[tableName]!
  const presentFields = fields.filter((field) => index.has(field))
  if (!presentFields.length) return null

  const issues: AccountingImportReview["issues"] = []
  if (new Set(headers).size !== headers.length) {
    issues.push({ get message() { return uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.duplicateColumnNamesMakeSourceTotalsAmbiguous.message") } })
  }
  const cell = (row: readonly string[], field: string) => {
    const at = index.get(field)
    return at == null ? "" : (row[at] ?? "").trim()
  }
  const referenceField = outstanding ? "reference" : index.has("ref_") ? "ref_" : index.has("move_id") ? "move_id" : null
  const references = new Set<string>()
  const totals = new Map<string, Omit<AccountingImportReviewTotal, "amount"> & { units: bigint }>()
  const seenDocuments = new Set<string>()

  for (const [at, row] of parsed.rows.entries()) {
    const rowNumber = at + 2
    const currency = cell(row, "currency_id") || ""
    const documentType = outstanding ? cell(row, "document_type").toLowerCase() : ""
    const reference = referenceField ? cell(row, referenceField) : ""
    if (reference) references.add(reference)
    if (outstanding && seenDocuments.has(reference)) {
      issues.push({ rowNumber, get message() { return uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.message", { defaultValue: "Row {{rowNumber}}: duplicate document reference {{reference}}.", rowNumber: rowNumber, reference: reference }) } })
    }
    if (outstanding) seenDocuments.add(reference)
    const values = new Map<string, bigint>()
    for (const field of presentFields) {
      try {
        const raw = cell(row, field)
        const amount = exactAmount(raw)
        if (outstanding && amount == null) throw new Error(uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.error", { defaultValue: "is required" }))
        if (amount == null) continue
        if (outstanding && amount < 0n) throw new Error(uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.errorcannotBeNegative", { defaultValue: "cannot be negative" }))
        values.set(field, amount)
        const key = JSON.stringify([currency, documentType, field])
        const total = totals.get(key) ?? { currency, documentType, field, units: 0n }
        const nextAmount = total.units + amount
        if (nextAmount > MAX_AMOUNT || nextAmount < -MAX_AMOUNT) throw new Error(uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.errorexceedsTheSupportedMonetaryTotal", { defaultValue: "exceeds the supported monetary total" }))
        total.units = nextAmount
        totals.set(key, total)
      } catch (cause) {
        issues.push({ rowNumber, get message() { return uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.messagerowRowNumberFieldValue3", { defaultValue: "Row {{rowNumber}}, {{field}}: {{value3}}.", rowNumber: rowNumber, field: field, value3: cause instanceof Error ? cause.message : String(cause) }) } })
      }
    }
    if (outstanding && values.has("opening_residual") && values.has("source_total") && values.get("opening_residual")! > values.get("source_total")!) {
      issues.push({ rowNumber, get message() { return uiI18n.t("accounting.builtIn.accountingImportReview.accountingImportReview.messagerowRowNumberOpeningResidualExceedsTheSource", { defaultValue: "Row {{rowNumber}}: opening residual exceeds the source total.", rowNumber: rowNumber }) } })
    }
  }
  return {
    rowCount: parsed.rows.length,
    referenceCount: referenceField ? references.size : null,
    totals: [...totals.values()].map(({ units, ...total }) => ({ ...total, amount: decimalString(units) })),
    issues,
  }
}
