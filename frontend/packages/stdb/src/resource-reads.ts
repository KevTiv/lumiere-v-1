import { decodeQueryListResponse } from "@lumiere/api-client"
import {
  decodeResourceQueryRow,
  type AccountAccountQueryRow,
  type CompanyQueryRow,
} from "@lumiere/contracts/generated/resource-codecs"

export type { AccountAccountQueryRow, CompanyQueryRow }

/** Decode a company list while leaving HTTP envelope ownership in the app. */
export function decodeCompaniesQueryResponse(value: unknown): CompanyQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("companies", row, index),
  )
}

/** Decode a field-policy projection of chart-of-account rows. */
export function decodeAccountAccountsQueryResponse(
  value: unknown,
): AccountAccountQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("account-accounts", row, index),
  )
}
