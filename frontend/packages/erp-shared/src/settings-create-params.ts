/**
 * Maps Settings / platform form payloads to SpacetimeDB Create*Params types.
 */

import type {
  CreateAuditRuleParams,
  CreateCountryParams,
  CreateCurrencyParams,
  CreateDataClassificationParams,
  CreateDataClassificationRuleParams,
  CreateRoleParams,
  CreateUserSessionParams,
} from "@lumiere/stdb/types"

import { optionalBigIntU64 } from "./form-coercion"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredTrimmedString(v: unknown): string | null {
  const s = optionalTrimmedString(v)
  return s ?? null
}

/** Maps settings audit-rule form to backend `CreateAuditRuleParams`. */
export function toCreateAuditRuleParams(
  formData: Record<string, unknown>,
): CreateAuditRuleParams {
  const tableName =
    optionalTrimmedString(formData.tableName) ??
    optionalTrimmedString(formData.resourceType) ??
    optionalTrimmedString(formData.name) ??
    ""
  const action = String(formData.actionType ?? formData.action ?? "").toLowerCase()
  return {
    tableName,
    logReads: action.includes("read") || formData.logReads === true,
    logWrites: action.includes("write") || formData.logWrites === true || action === "",
    logDeletes: action.includes("delete") || formData.logDeletes === true,
    logLogins: action.includes("login") || formData.logLogins === true,
    isActive: formData.isActive !== false,
    metadata: optionalTrimmedString(formData.metadata ?? formData.severity),
  }
}

export function toCreateRoleParams(formData: Record<string, unknown>): CreateRoleParams | null {
  const name = requiredTrimmedString(formData.name)
  if (!name) return null
  const permsRaw = formData.permissions
  const permissions = Array.isArray(permsRaw)
    ? permsRaw.map((p) => String(p))
    : optionalTrimmedString(permsRaw)?.split(/[\s,]+/).filter(Boolean) ?? []
  return {
    name,
    description: optionalTrimmedString(formData.description),
    parentId: optionalBigIntU64(formData.parentId),
    permissions,
    isActive: formData.isActive !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateCountryParams(formData: Record<string, unknown>): CreateCountryParams | null {
  const name = requiredTrimmedString(formData.name)
  const iso3 = requiredTrimmedString(formData.iso3 ?? formData.code)
  if (!name || !iso3) return null
  const langRaw = formData.languageCodes ?? formData.language_codes
  const languageCodes = Array.isArray(langRaw)
    ? langRaw.map((c) => String(c))
    : optionalTrimmedString(langRaw)?.split(/[\s,]+/).filter(Boolean) ?? []
  return {
    name,
    iso3: iso3.toUpperCase(),
    numcode: Math.max(0, Math.trunc(Number(formData.numcode ?? formData.numCode ?? 0))),
    phoneCode: String(formData.phoneCode ?? formData.phone_code ?? ""),
    officialName: optionalTrimmedString(formData.officialName ?? formData.official_name),
    currencyCode: optionalTrimmedString(formData.currencyCode ?? formData.currency_code),
    languageCodes,
    isActive: formData.isActive !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateCurrencyParams(formData: Record<string, unknown>): CreateCurrencyParams | null {
  const name = requiredTrimmedString(formData.name)
  const symbol = requiredTrimmedString(formData.symbol)
  if (!name || !symbol) return null
  const decimalPlaces = Math.min(
    255,
    Math.max(0, Math.trunc(Number(formData.decimalPlaces ?? formData.decimal_places ?? 2))),
  )
  return {
    name,
    symbol,
    decimalPlaces,
    roundingFactor: Number(formData.roundingFactor ?? formData.rounding_factor ?? 0.01),
    position: String(formData.position ?? "before"),
    active: formData.active !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateDataClassificationParams(
  formData: Record<string, unknown>,
): CreateDataClassificationParams | null {
  const name = requiredTrimmedString(formData.name)
  if (!name) return null
  const level = Math.min(4, Math.max(1, Math.trunc(Number(formData.level ?? 1))))
  return {
    name,
    level,
    description: optionalTrimmedString(formData.description),
    retentionDays:
      formData.retentionDays != null && String(formData.retentionDays).trim() !== ""
        ? Math.max(0, Math.trunc(Number(formData.retentionDays)))
        : undefined,
    encryptionRequired: formData.encryptionRequired === true,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateDataClassificationRuleParams(
  formData: Record<string, unknown>,
): CreateDataClassificationRuleParams | null {
  const tableName = requiredTrimmedString(formData.tableName)
  const classificationId = optionalBigIntU64(formData.classificationId)
  if (!tableName || classificationId === undefined) return null
  return {
    tableName,
    columnName: optionalTrimmedString(formData.columnName),
    classificationId,
    appliesTo: String(formData.appliesTo ?? "all"),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateUserSessionParams(
  formData: Record<string, unknown>,
): CreateUserSessionParams | null {
  const sessionToken = requiredTrimmedString(formData.sessionToken)
  const expiresRaw = formData.expiresAtMicros ?? formData.expiresAt
  if (!sessionToken || expiresRaw == null) return null
  let expiresAtMicros: bigint
  if (typeof expiresRaw === "object" && expiresRaw !== null && "microsSinceUnixEpoch" in expiresRaw) {
    expiresAtMicros = BigInt(String((expiresRaw as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch))
  } else {
    expiresAtMicros = BigInt(String(expiresRaw))
  }
  return {
    sessionToken,
    ipAddress: optionalTrimmedString(formData.ipAddress),
    userAgent: optionalTrimmedString(formData.userAgent),
    deviceInfo: optionalTrimmedString(formData.deviceInfo),
    expiresAtMicros,
    metadata: optionalTrimmedString(formData.metadata),
  }
}
