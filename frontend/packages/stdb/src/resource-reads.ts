import { decodeQueryListResponse } from "@lumiere/api-client"
import {
  type AccountAccountTypeQueryRow,
  decodeResourceQueryRow,
  type AccountAccountQueryRow,
  type AccountJournalQueryRow,
  type AccountMoveLineQueryRow,
  type AccountMoveQueryRow,
  type AccountTaxQueryRow,
  type CompanyQueryRow,
  type ResourceQueryRowMap,
} from "@lumiere/contracts/generated/resource-codecs"

export type {
  AccountAccountTypeQueryRow,
  AccountAccountQueryRow,
  AccountJournalQueryRow,
  AccountMoveLineQueryRow,
  AccountMoveQueryRow,
  AccountTaxQueryRow,
  CompanyQueryRow,
  ResourceQueryRowMap,
}

export type TypedResourceReadKey = keyof ResourceQueryRowMap

/** Decode a normal `{ data: [...] }` query envelope using its generated row descriptor. */
export function decodeTypedResourceQueryResponse<Resource extends TypedResourceReadKey>(
  resource: Resource,
  value: unknown,
): ResourceQueryRowMap[Resource][] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow(resource, row, index),
  )
}

/** Decode selected-company and organization-shared account type rows. */
export function decodeAccountAccountTypesQueryResponse(
  value: unknown,
): AccountAccountTypeQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("account-account-types", row, index),
  )
}

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

/** Decode a field-policy projection of accounting journal rows. */
export function decodeAccountJournalsQueryResponse(
  value: unknown,
): AccountJournalQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("account-journals", row, index),
  )
}

/** Decode a field-policy projection of accounting move-line rows. */
export function decodeAccountMoveLinesQueryResponse(
  value: unknown,
): AccountMoveLineQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("account-move-lines", row, index),
  )
}

/** Decode a field-policy projection of accounting move rows. */
export function decodeAccountMovesQueryResponse(
  value: unknown,
): AccountMoveQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("account-moves", row, index),
  )
}

/** Decode a field-policy projection of accounting tax rows. */
export function decodeAccountTaxesQueryResponse(
  value: unknown,
): AccountTaxQueryRow[] {
  return decodeQueryListResponse(value, (row, index) =>
    decodeResourceQueryRow("account-taxes", row, index),
  )
}
