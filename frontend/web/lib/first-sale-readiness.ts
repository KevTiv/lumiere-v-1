import { buildModuleTabHref } from "@lumiere/erp-shared/ai-source-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

interface ScopedReadRow {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
}

export interface QuotationCurrencyRow {
  id?: unknown
  isActive?: unknown
  is_active?: unknown
  active?: unknown
}

export interface QuotationPricelistRow extends ScopedReadRow {
  isActive?: unknown
  is_active?: unknown
  currencyId?: unknown
  currency_id?: unknown
}

interface CustomerLocationRow extends ScopedReadRow {
  active?: unknown
  usage?: unknown
}

function field<T extends object>(row: T, camel: keyof T, snake: keyof T) {
  return Object.hasOwn(row, camel) ? row[camel] : row[snake]
}

function positiveId(value: unknown) {
  const id = parseStrictU64(value)
  return id != null && id > 0n ? id : undefined
}

/** Only current-company or organization-wide lists with an active currency can price a quotation. */
export function usableQuotationPricelists<T extends QuotationPricelistRow>(
  rows: readonly T[],
  currencies: readonly QuotationCurrencyRow[],
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

export function quotationPricelistSetupHref(companyId: unknown, can: (resource: string, action: "read" | "create") => boolean) {
  const id = positiveId(companyId)
  if (!id || !can("module:sales", "read") ||
      !can("product_pricelist", "read") || !can("pricelist", "create")) return null
  return `${buildModuleTabHref("sales", "pricelists")}&companyId=${id}`
}

/** The company-scoped stock read cannot prove absence of organization-wide locations. */
export function companyCustomerDestination(
  rows: readonly CustomerLocationRow[],
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
