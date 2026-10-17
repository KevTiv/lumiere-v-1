import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"

/** Bootstrap catalogs use JSON numbers/strings; typed company reads use bigint. */
export function currencyCatalogContainsId(rows: readonly Record<string, unknown>[], currencyId: bigint): boolean {
  return currencyId > 0n && rows.some(row => optionalBigIntU64(row.id) === currencyId)
}
