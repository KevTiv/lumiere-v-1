/** The parts of a currency row the lookup reads. */
export interface CurrencyRow {
  id?: unknown
  code?: unknown
}

/** The parts of a company row the lookup reads. */
export interface CompanyRow {
  id?: unknown
  currencyId?: unknown
  currency_id?: unknown
}

/**
 * Row field that names a row's currency across the workspace's entity tables: sales, purchasing,
 * expense and subscription rows carry it, so their currency columns follow the row.
 */
export const WORKSPACE_ROW_CURRENCY_KEY = "currencyId"

/**
 * Upper-case code of the operating company's currency: what an amount with no currency of its own
 * is shown in. Undefined when the company, its currency or the currency's code is unknown. (Whether
 * the code is a valid ISO 4217 one is checked where it is used, by `CurrencyFormatProvider`.)
 */
export function operatingCompanyCurrencyCode(
  currencies: readonly CurrencyRow[],
  companies: readonly CompanyRow[],
  operatingCompanyId: number | string | bigint | null | undefined,
): string | undefined {
  if (operatingCompanyId == null) return undefined
  const company = companies.find((row) => String(row.id ?? "") === String(operatingCompanyId))
  const currencyId = company?.currencyId ?? company?.currency_id
  if (currencyId == null) return undefined
  const currency = currencies.find((row) => String(row.id ?? "") === String(currencyId))
  const code = String(currency?.code ?? "").trim().toUpperCase()
  return code === "" ? undefined : code
}
