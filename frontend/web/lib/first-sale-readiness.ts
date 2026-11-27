import { parseStrictU64 } from "@lumiere/erp-shared/u64"

type Row = Readonly<Record<string, unknown>>

function field(row: Row, camel: string, snake: string) {
  return Object.hasOwn(row, camel) ? row[camel] : row[snake]
}

function positiveId(value: unknown) {
  const id = parseStrictU64(value)
  return id != null && id > 0n ? id : undefined
}

/** Only current-company or organization-wide lists with an active currency can price a quotation. */
export function usableQuotationPricelists<T extends Row>(
  rows: readonly T[],
  currencies: readonly Row[],
  organizationId: bigint,
  companyId: bigint,
): T[] {
  if (!organizationId || !companyId) return []
  const currencyIds = new Set(currencies
    .filter((row) => field(row, "isActive", "is_active") !== false && row.active !== false)
    .map((row) => positiveId(row.id))
    .filter((id) => id != null))
  return rows.filter((row) => {
    const company = field(row, "companyId", "company_id")
    const currency = positiveId(field(row, "currencyId", "currency_id"))
    const shared = (Object.hasOwn(row, "companyId") || Object.hasOwn(row, "company_id")) &&
      (company == null || (typeof company === "object" && Object.hasOwn(company, "none")))
    return positiveId(row.id) != null &&
      positiveId(field(row, "organizationId", "organization_id")) === organizationId &&
      (shared || positiveId(company) === companyId) &&
      field(row, "isActive", "is_active") === true &&
      currency != null && currencyIds.has(currency)
  })
}

/** The company-scoped stock read cannot prove absence of organization-wide locations. */
export function companyCustomerDestination(
  rows: readonly Row[],
  organizationId: bigint,
  companyId: bigint,
): "present" | "not-listed" | "unknown" {
  if (!organizationId || !companyId || rows.some((row) =>
    positiveId(field(row, "organizationId", "organization_id")) == null ||
    positiveId(field(row, "companyId", "company_id")) == null ||
    typeof row.active !== "boolean" || typeof row.usage !== "string",
  )) return "unknown"
  return rows.some((row) =>
    positiveId(row.id) != null && row.active === true && row.usage === "customer" &&
    positiveId(field(row, "organizationId", "organization_id")) === organizationId &&
    positiveId(field(row, "companyId", "company_id")) === companyId,
  ) ? "present" : "not-listed"
}
