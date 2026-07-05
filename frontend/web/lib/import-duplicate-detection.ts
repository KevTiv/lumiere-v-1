import type { ImportEntityOption } from "./import-entities"

export type ImportDuplicateMatch = {
  rowIndex: number
  existingId: string
  matchReason: string
  previewValues: Record<string, unknown>
}

export type ImportDuplicateAction = "skip" | "import" | "update"

export type ImportDuplicateRowState = {
  rowIndex: number
  match: ImportDuplicateMatch
  action: ImportDuplicateAction
}

type QueryRow = Record<string, unknown>

function norm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

function rowId(row: QueryRow): string {
  return String(row.id ?? "")
}

function rowEmail(row: QueryRow): string {
  return norm(row.email ?? row.emailFrom ?? row.email_from)
}

function rowPhone(row: QueryRow): string {
  return norm(row.phone ?? row.mobile ?? row.phoneNumber ?? row.phone_number)
}

function rowName(row: QueryRow): string {
  return norm(row.name ?? row.displayName ?? row.display_name)
}

function isVendorContact(row: QueryRow): boolean {
  return Boolean(row.isVendor ?? row.is_vendor ?? row.isSupplier ?? row.is_supplier)
}

function rowSku(row: QueryRow): string {
  return norm(row.defaultCode ?? row.default_code ?? row.code ?? row.sku)
}

function previewField(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
  targetField: string,
): string {
  for (const [source, target] of Object.entries(mapping)) {
    if (target === targetField) return norm(row[targetField] ?? row[source])
  }
  return norm(row[targetField])
}

function contactMatches(
  previewRow: Record<string, unknown>,
  mapping: Record<string, string>,
  existing: QueryRow,
  vendorsOnly: boolean,
): string | null {
  if (vendorsOnly && !isVendorContact(existing)) return null

  const email = previewField(previewRow, mapping, "email")
  const existingEmail = rowEmail(existing)
  if (email && existingEmail && email === existingEmail) {
    return vendorsOnly ? "email (vendor)" : "email"
  }

  const ref = previewField(previewRow, mapping, "ref")
  const existingRef = norm(existing.ref ?? existing.externalRef ?? existing.external_ref)
  if (ref && existingRef && ref === existingRef) {
    return vendorsOnly ? "external ref (vendor)" : "external ref"
  }

  const name = previewField(previewRow, mapping, "name")
  const phone = previewField(previewRow, mapping, "phone")
  const existingName = rowName(existing)
  const existingPhone = rowPhone(existing)
  if (name && phone && existingName && existingPhone && name === existingName && phone === existingPhone) {
    return vendorsOnly ? "name + phone (vendor)" : "name + phone"
  }

  return null
}

function productMatches(
  previewRow: Record<string, unknown>,
  mapping: Record<string, string>,
  existing: QueryRow,
): string | null {
  const sku = previewField(previewRow, mapping, "default_code")
  const existingSku = rowSku(existing)
  if (sku && existingSku && sku === existingSku) {
    return "SKU / default_code"
  }

  const name = previewField(previewRow, mapping, "name")
  const existingName = rowName(existing)
  const companyId = previewField(previewRow, mapping, "company_id")
  const existingCompany = norm(existing.companyId ?? existing.company_id)
  if (name && existingName && name === existingName) {
    if (!companyId || !existingCompany || companyId === existingCompany) {
      return companyId ? "name + company" : "name"
    }
  }

  return null
}

export function detectImportDuplicates(args: {
  entity: ImportEntityOption
  previewRows: Record<string, unknown>[]
  mapping: Record<string, string>
  contacts?: QueryRow[]
  products?: QueryRow[]
}): ImportDuplicateMatch[] {
  const kind = args.entity.duplicateKind ?? args.entity.tableName
  if (kind !== "contact" && kind !== "vendor" && kind !== "product") return []

  const matches: ImportDuplicateMatch[] = []

  args.previewRows.forEach((row, rowIndex) => {
    if (kind === "contact" || kind === "vendor") {
      const vendorsOnly = kind === "vendor"
      for (const existing of args.contacts ?? []) {
        const reason = contactMatches(row, args.mapping, existing, vendorsOnly)
        if (reason) {
          matches.push({
            rowIndex,
            existingId: rowId(existing),
            matchReason: reason,
            previewValues: row,
          })
          break
        }
      }
      return
    }

    for (const existing of args.products ?? []) {
      const reason = productMatches(row, args.mapping, existing)
      if (reason) {
        matches.push({
          rowIndex,
          existingId: rowId(existing),
          matchReason: reason,
          previewValues: row,
        })
        break
      }
    }
  })

  return matches
}

export function defaultDuplicateActions(
  matches: ImportDuplicateMatch[],
): ImportDuplicateRowState[] {
  return matches.map((match) => ({
    rowIndex: match.rowIndex,
    match,
    action: "skip" as ImportDuplicateAction,
  }))
}

export function filterCsvForImport(args: {
  csvText: string
  headers: string[]
  rows: string[][]
  skipRowIndexes: Set<number>
}): string {
  const kept = args.rows.filter((_, idx) => !args.skipRowIndexes.has(idx))
  const escape = (cell: string) => {
    if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
    return cell
  }
  const lines = [
    args.headers.map(escape).join(","),
    ...kept.map((row) => row.map((cell) => escape(cell ?? "")).join(",")),
  ]
  return lines.join("\n")
}
