import type { ColumnMappingMap } from "./csv-import-transform"

export type DebitCreditReconciliationIssue = {
  code:
    | "missing_amount_mapping"
    | "ambiguous_amount_mapping"
    | "missing_reference"
    | "invalid_amount"
    | "negative_amount"
    | "mixed_debit_credit"
    | "empty_amount"
    | "unbalanced_reference"
  message: string
  reference?: string
  rowNumber?: number
}

export type DebitCreditReconciliationGroup = {
  reference: string
  debit: number
  credit: number
  difference: number
  balanced: boolean
  rowNumbers: number[]
}

export type DebitCreditReconciliationReport = {
  valid: boolean
  totalDebit: number
  totalCredit: number
  difference: number
  groups: DebitCreditReconciliationGroup[]
  issues: DebitCreditReconciliationIssue[]
}

export type ReconcileDebitCreditRowsArgs = {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
  lineMapping: ColumnMappingMap
  parentReferenceSourceColumn: string
  /** Smallest difference considered material. Defaults to half a cent. */
  tolerance?: number
}

export class AccountingImportReconciliationError extends Error {
  readonly report: DebitCreditReconciliationReport

  constructor(report: DebitCreditReconciliationReport) {
    super(report.issues.map((issue) => issue.message).join("; "))
    this.name = "AccountingImportReconciliationError"
    this.report = report
  }
}

function amountSourceColumns(
  mapping: ColumnMappingMap,
  target: "debit" | "credit",
): string[] {
  return Object.entries(mapping)
    .filter(([, mappedTarget]) => mappedTarget.trim().toLowerCase() === target)
    .map(([source]) => source)
}

function validDecimal(value: string, separator: "." | ","): boolean {
  const parts = value.split(separator)
  return (
    parts.length === 2 &&
    parts[0]!.length > 0 &&
    parts[1]!.length > 0 &&
    /^\d+$/.test(parts[0]!) &&
    /^\d+$/.test(parts[1]!)
  )
}

function validGroupedInteger(value: string, separator: "." | ","): boolean {
  const groups = value.split(separator)
  return (
    groups.length > 1 &&
    groups[0]!.length >= 1 &&
    groups[0]!.length <= 3 &&
    groups.every((group, index) =>
      index === 0 ? /^\d+$/.test(group) : /^\d{3}$/.test(group),
    )
  )
}

function validGroupedDecimal(
  value: string,
  grouping: "." | ",",
  decimal: "." | ",",
): boolean {
  const parts = value.split(decimal)
  return (
    parts.length === 2 &&
    parts[1]!.length > 0 &&
    /^\d+$/.test(parts[1]!) &&
    validGroupedInteger(parts[0]!, grouping)
  )
}

/** Mirror the server import parser for plain, decimal-comma, US, and EU amounts. */
export function parseAccountingImportNumber(raw: string): number | null {
  const compact = raw.replace(/\s/g, "")
  if (!compact) return null
  const unsigned = compact.replace(/^[+-]/, "")
  if (!unsigned || !/^[\d.,]+$/.test(unsigned)) {
    throw new Error("must be a valid finite number")
  }

  const commaCount = (unsigned.match(/,/g) ?? []).length
  const dotCount = (unsigned.match(/\./g) ?? []).length
  let normalized: string
  if (commaCount === 0 && dotCount === 0) normalized = compact
  else if (commaCount === 0 && dotCount === 1 && validDecimal(unsigned, ".")) {
    normalized = compact
  } else if (commaCount === 0 && validGroupedInteger(unsigned, ".")) {
    normalized = compact.replaceAll(".", "")
  } else if (commaCount === 1 && dotCount === 0 && validGroupedInteger(unsigned, ",")) {
    normalized = compact.replaceAll(",", "")
  } else if (commaCount === 1 && dotCount === 0 && validDecimal(unsigned, ",")) {
    normalized = compact.replace(",", ".")
  } else if (dotCount === 0 && validGroupedInteger(unsigned, ",")) {
    normalized = compact.replaceAll(",", "")
  } else if (dotCount === 1 && validGroupedDecimal(unsigned, ",", ".")) {
    normalized = compact.replaceAll(",", "")
  } else if (commaCount === 1 && validGroupedDecimal(unsigned, ".", ",")) {
    normalized = compact.replaceAll(".", "").replace(",", ".")
  } else {
    throw new Error("has an invalid or ambiguous separator pattern")
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error("must be a valid finite number")
  return parsed
}

function finiteAmount(raw: string): number | undefined {
  try {
    return parseAccountingImportNumber(raw) ?? 0
  } catch {
    return undefined
  }
}

function stableAmount(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000
}

/**
 * Reconcile journal lines by their human source reference before importing.
 * Each reference must balance independently; a balanced grand total cannot
 * hide two offsetting, unbalanced journal entries.
 */
export function reconcileDebitCreditRows(
  args: ReconcileDebitCreditRowsArgs,
): DebitCreditReconciliationReport {
  const {
    headers,
    rows,
    lineMapping,
    parentReferenceSourceColumn,
    tolerance = 0.005,
  } = args
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      "Debit/credit reconciliation tolerance must be a non-negative number",
    )
  }

  const issues: DebitCreditReconciliationIssue[] = []
  const debitSources = amountSourceColumns(lineMapping, "debit")
  const creditSources = amountSourceColumns(lineMapping, "credit")

  for (const [target, sources] of [
    ["debit", debitSources],
    ["credit", creditSources],
  ] as const) {
    if (sources.length === 0) {
      issues.push({
        code: "missing_amount_mapping",
        message: `No source column is mapped to ${target}`,
      })
    } else if (sources.length > 1) {
      issues.push({
        code: "ambiguous_amount_mapping",
        message: `Multiple source columns are mapped to ${target}: ${sources.join(", ")}`,
      })
    }
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]))
  const referenceIndex = headerIndex.get(parentReferenceSourceColumn)
  if (referenceIndex == null) {
    throw new Error(
      `Parent reference column "${parentReferenceSourceColumn}" not found in CSV headers`,
    )
  }

  const debitIndex =
    debitSources.length === 1 ? headerIndex.get(debitSources[0]) : undefined
  const creditIndex =
    creditSources.length === 1 ? headerIndex.get(creditSources[0]) : undefined
  if (debitSources.length === 1 && debitIndex == null) {
    issues.push({
      code: "missing_amount_mapping",
      message: `Mapped debit column "${debitSources[0]}" was not found in CSV headers`,
    })
  }
  if (creditSources.length === 1 && creditIndex == null) {
    issues.push({
      code: "missing_amount_mapping",
      message: `Mapped credit column "${creditSources[0]}" was not found in CSV headers`,
    })
  }

  const totals = new Map<
    string,
    {
      debit: number
      credit: number
      rowNumbers: number[]
      hasInvalidRow: boolean
    }
  >()

  if (debitIndex != null && creditIndex != null) {
    for (const [rowIndex, row] of rows.entries()) {
      const rowNumber = rowIndex + 2
      const reference = (row[referenceIndex] ?? "").trim()
      if (!reference) {
        issues.push({
          code: "missing_reference",
          message: `Row ${rowNumber} is missing a journal reference`,
          rowNumber,
        })
        continue
      }

      const debit = finiteAmount(row[debitIndex] ?? "")
      const credit = finiteAmount(row[creditIndex] ?? "")
      const group = totals.get(reference) ?? {
        debit: 0,
        credit: 0,
        rowNumbers: [],
        hasInvalidRow: false,
      }
      group.rowNumbers.push(rowNumber)
      totals.set(reference, group)

      if (debit == null || credit == null) {
        issues.push({
          code: "invalid_amount",
          message: `Row ${rowNumber} for reference "${reference}" has an invalid debit or credit amount`,
          reference,
          rowNumber,
        })
        group.hasInvalidRow = true
        continue
      }
      if (debit < 0 || credit < 0) {
        issues.push({
          code: "negative_amount",
          message: `Row ${rowNumber} for reference "${reference}" has a negative debit or credit amount`,
          reference,
          rowNumber,
        })
        group.hasInvalidRow = true
        continue
      }
      if (debit > 0 && credit > 0) {
        issues.push({
          code: "mixed_debit_credit",
          message: `Row ${rowNumber} for reference "${reference}" contains both debit and credit`,
          reference,
          rowNumber,
        })
        group.hasInvalidRow = true
        continue
      }
      if (debit === 0 && credit === 0) {
        issues.push({
          code: "empty_amount",
          message: `Row ${rowNumber} for reference "${reference}" has neither debit nor credit`,
          reference,
          rowNumber,
        })
        group.hasInvalidRow = true
        continue
      }

      group.debit += debit
      group.credit += credit
    }
  }

  let totalDebit = 0
  let totalCredit = 0
  const groups: DebitCreditReconciliationGroup[] = []
  for (const [reference, total] of totals) {
    const debit = stableAmount(total.debit)
    const credit = stableAmount(total.credit)
    const difference = stableAmount(debit - credit)
    const balanced = !total.hasInvalidRow && Math.abs(difference) <= tolerance
    totalDebit += debit
    totalCredit += credit
    groups.push({
      reference,
      debit,
      credit,
      difference,
      balanced,
      rowNumbers: total.rowNumbers,
    })
    if (!total.hasInvalidRow && !balanced) {
      issues.push({
        code: "unbalanced_reference",
        message: `Reference "${reference}" is out of balance by ${difference} (debit ${debit}, credit ${credit})`,
        reference,
      })
    }
  }

  totalDebit = stableAmount(totalDebit)
  totalCredit = stableAmount(totalCredit)
  const difference = stableAmount(totalDebit - totalCredit)
  return {
    valid: issues.length === 0,
    totalDebit,
    totalCredit,
    difference,
    groups,
    issues,
  }
}

export function assertDebitCreditRowsBalanced(
  args: ReconcileDebitCreditRowsArgs,
): DebitCreditReconciliationReport {
  const report = reconcileDebitCreditRows(args)
  if (!report.valid) throw new AccountingImportReconciliationError(report)
  return report
}
