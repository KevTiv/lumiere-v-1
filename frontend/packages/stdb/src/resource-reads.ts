import { decodeQueryListResponse, QueryResponseDecodeError } from "@lumiere/api-client"
import type { Company } from "@lumiere/contracts/generated/types"
import { Timestamp } from "spacetimedb"

type RequiredCompanyFields = Pick<Company, "id" | "organizationId">

/** HTTP field policy can omit every company field except the registry-mandatory pair. */
export type CompanyQueryRow = RequiredCompanyFields &
  Partial<Omit<Company, keyof RequiredCompanyFields>>

const COMPANY_FIELDS = new Set([
  "id",
  "externalId",
  "organizationId",
  "name",
  "code",
  "isParent",
  "parentId",
  "currencyId",
  "fiscalYearEndMonth",
  "fiscalYearEndDay",
  "taxId",
  "companyRegistry",
  "addressStreet",
  "addressCity",
  "addressZip",
  "addressCountryCode",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "metadata",
])
const U64_MAX = (1n << 64n) - 1n

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new QueryResponseDecodeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function bigintAt(value: unknown, path: string): bigint {
  if (typeof value === "bigint" && value >= 0n && value <= U64_MAX) return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = BigInt(value)
    if (parsed <= U64_MAX) return parsed
  }
  throw new QueryResponseDecodeError(`${path} must be an unsigned 64-bit integer`)
}

function optionalBigintAt(value: unknown, path: string): bigint | undefined {
  return value == null ? undefined : bigintAt(value, path)
}

function stringAt(value: unknown, path: string): string {
  if (typeof value === "string") return value
  throw new QueryResponseDecodeError(`${path} must be a string`)
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  return value == null ? undefined : stringAt(value, path)
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value
  throw new QueryResponseDecodeError(`${path} must be a boolean`)
}

function u8At(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value
  }
  throw new QueryResponseDecodeError(`${path} must be an unsigned 8-bit integer`)
}

function timestampAt(value: unknown, path: string): Timestamp {
  const timestamp = objectAt(value, path)
  const micros = timestamp.microsSinceUnixEpoch
  if (
    (typeof micros === "number" && Number.isSafeInteger(micros)) ||
    (typeof micros === "string" && /^-?\d+$/.test(micros)) ||
    typeof micros === "bigint"
  ) {
    return new Timestamp(BigInt(micros))
  }
  throw new QueryResponseDecodeError(`${path}.microsSinceUnixEpoch must be an integer`)
}

function optionalTimestampAt(value: unknown, path: string): Timestamp | undefined {
  return value == null ? undefined : timestampAt(value, path)
}

function decodeCompanyRow(value: unknown, index: number): CompanyQueryRow {
  const path = `query response data[${index}]`
  const row = objectAt(value, path)
  for (const field of Object.keys(row)) {
    if (!COMPANY_FIELDS.has(field)) {
      throw new QueryResponseDecodeError(`${path} contains unknown field ${field}`)
    }
  }
  if (!("id" in row) || !("organizationId" in row)) {
    throw new QueryResponseDecodeError(`${path} is missing id or organizationId`)
  }

  const decoded: CompanyQueryRow = {
    id: bigintAt(row.id, `${path}.id`),
    organizationId: bigintAt(row.organizationId, `${path}.organizationId`),
  }
  if ("externalId" in row) decoded.externalId = stringAt(row.externalId, `${path}.externalId`)
  if ("name" in row) decoded.name = stringAt(row.name, `${path}.name`)
  if ("code" in row) decoded.code = stringAt(row.code, `${path}.code`)
  if ("isParent" in row) decoded.isParent = booleanAt(row.isParent, `${path}.isParent`)
  if ("parentId" in row) decoded.parentId = optionalBigintAt(row.parentId, `${path}.parentId`)
  if ("currencyId" in row) decoded.currencyId = bigintAt(row.currencyId, `${path}.currencyId`)
  if ("fiscalYearEndMonth" in row) {
    decoded.fiscalYearEndMonth = u8At(
      row.fiscalYearEndMonth,
      `${path}.fiscalYearEndMonth`,
    )
  }
  if ("fiscalYearEndDay" in row) {
    decoded.fiscalYearEndDay = u8At(row.fiscalYearEndDay, `${path}.fiscalYearEndDay`)
  }
  if ("taxId" in row) decoded.taxId = optionalStringAt(row.taxId, `${path}.taxId`)
  if ("companyRegistry" in row) {
    decoded.companyRegistry = optionalStringAt(
      row.companyRegistry,
      `${path}.companyRegistry`,
    )
  }
  if ("addressStreet" in row) {
    decoded.addressStreet = optionalStringAt(row.addressStreet, `${path}.addressStreet`)
  }
  if ("addressCity" in row) decoded.addressCity = optionalStringAt(row.addressCity, `${path}.addressCity`)
  if ("addressZip" in row) decoded.addressZip = optionalStringAt(row.addressZip, `${path}.addressZip`)
  if ("addressCountryCode" in row) {
    decoded.addressCountryCode = optionalStringAt(
      row.addressCountryCode,
      `${path}.addressCountryCode`,
    )
  }
  if ("createdAt" in row) decoded.createdAt = timestampAt(row.createdAt, `${path}.createdAt`)
  if ("updatedAt" in row) decoded.updatedAt = timestampAt(row.updatedAt, `${path}.updatedAt`)
  if ("deletedAt" in row) {
    decoded.deletedAt = optionalTimestampAt(row.deletedAt, `${path}.deletedAt`)
  }
  if ("metadata" in row) decoded.metadata = optionalStringAt(row.metadata, `${path}.metadata`)
  return decoded
}

/** Decode the projection-aware response for the first Phase 6 typed-read pilot. */
export function decodeCompaniesQueryResponse(value: unknown): CompanyQueryRow[] {
  return decodeQueryListResponse(value, decodeCompanyRow)
}
