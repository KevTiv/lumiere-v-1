/**
 * Maps Settings / platform form payloads to SpacetimeDB Create*Params types.
 */

import type {
  CreateAuditRuleParams,
  CreateAiReducerAllowlistParams,
  CreateBillingAccountParams,
  CreateCompanyParams,
  CreateCountryParams,
  CreateCurrencyParams,
  CreateDataClassificationParams,
  CreateDataClassificationRuleParams,
  CreateOrganizationParams,
  CreateRoleParams,
  CreateUserSessionParams,
  CreateWhatsAppBusinessAccountParams,
} from "@lumiere/stdb/types"

import { formValue as field, optionalBigIntU64 } from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"

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

const DEFAULT_AI_REDUCER_PERMISSIONS: Record<string, { resource: string; action: string }> = {
  create_task: { resource: "project_task", action: "create" },
  create_sale_order: { resource: "sale_order", action: "create" },
  create_purchase_order: { resource: "purchase_order", action: "create" },
}

/** Maps Settings → AI allowlist form to `CreateAiReducerAllowlistParams`. */
export function toCreateAiReducerAllowlistParams(
  formData: Record<string, unknown>,
): CreateAiReducerAllowlistParams | null {
  const reducerName = requiredTrimmedString(formData.reducerName)
  if (!reducerName) return null

  const defaults = DEFAULT_AI_REDUCER_PERMISSIONS[reducerName]
  const permissionResource =
    optionalTrimmedString(formData.permissionResource) ?? defaults?.resource ?? null
  const permissionAction =
    optionalTrimmedString(formData.permissionAction) ?? defaults?.action ?? "create"

  if (!permissionResource || !permissionAction) return null

  return {
    reducerName,
    permissionResource,
    permissionAction,
    enabled: formData.enabled !== false,
    metadata: optionalTrimmedString(formData.metadata),
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
  const langRaw = field(formData, "languageCodes", "language_codes")
  const languageCodes = Array.isArray(langRaw)
    ? langRaw.map((c) => String(c))
    : optionalTrimmedString(langRaw)?.split(/[\s,]+/).filter(Boolean) ?? []
  return {
    name,
    iso3: iso3.toUpperCase(),
    numcode: Math.max(0, Math.trunc(Number(formData.numcode ?? formData.numCode ?? 0))),
    phoneCode: String(field(formData, "phoneCode", "phone_code") ?? ""),
    officialName: optionalTrimmedString(field(formData, "officialName", "official_name")),
    currencyId: optionalBigIntU64(field(formData, "currencyId", "currency_id")),
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
    Math.max(0, Math.trunc(Number(field(formData, "decimalPlaces", "decimal_places") ?? 2))),
  )
  return {
    name,
    symbol,
    decimalPlaces,
    roundingFactor: Number(field(formData, "roundingFactor", "rounding_factor") ?? 0.01),
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

export function toCreateBillingAccountParams(
  formData: Record<string, unknown>,
): CreateBillingAccountParams | null {
  const planTier = requiredTrimmedString(field(formData, "planTier", "plan_tier"))
  if (!planTier) return null
  const trialEndsRaw = field(formData, "trialEndsAt", "trial_ends_at")
  let trialEndsAt: ReturnType<typeof stbTimestampFromDate> | undefined
  if (trialEndsRaw != null && String(trialEndsRaw).trim() !== "") {
    const d = new Date(String(trialEndsRaw))
    if (!Number.isNaN(d.getTime())) trialEndsAt = stbTimestampFromDate(d)
  }
  return {
    planTier,
    seatCount: Math.max(1, Math.trunc(Number(field(formData, "seatCount", "seat_count") ?? 1))),
    status: String(formData.status ?? "trial"),
    trialEndsAt,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

function stringArrayFromForm(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean)
  const s = String(raw ?? "").trim()
  if (!s) return []
  return s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
}

export function toCreateOrganizationParams(
  formData: Record<string, unknown>,
): CreateOrganizationParams | null {
  const name = requiredTrimmedString(field(formData, "name", "name"))
  const code = requiredTrimmedString(field(formData, "code", "code"))
  if (!name || !code) return null
  return {
    name,
    code,
    timezone: String(field(formData, "timezone", "timezone") ?? "UTC"),
    dateFormat: String(field(formData, "dateFormat", "date_format") ?? "YYYY-MM-DD"),
    language: String(field(formData, "language", "language") ?? "en"),
    isActive: field(formData, "isActive", "is_active") !== false,
    description: optionalTrimmedString(field(formData, "description", "description")),
    logoUrl: optionalTrimmedString(field(formData, "logoUrl", "logo_url")),
    website: optionalTrimmedString(field(formData, "website", "website")),
    email: optionalTrimmedString(field(formData, "email", "email")),
    phone: optionalTrimmedString(field(formData, "phone", "phone")),
    currencyId: optionalBigIntU64(field(formData, "currencyId", "currency_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export type CreateCompanyMapperContext = {
  currencyId: bigint
}

export function toCreateCompanyParams(
  formData: Record<string, unknown>,
  context?: CreateCompanyMapperContext,
): CreateCompanyParams | null {
  const name = requiredTrimmedString(field(formData, "name", "name"))
  const code = requiredTrimmedString(field(formData, "code", "code"))
  const currencyId =
    optionalBigIntU64(field(formData, "currencyId", "currency_id")) ?? context?.currencyId
  if (!name || !code || currencyId === undefined) return null

  const fiscalMonth = Math.min(
    12,
    Math.max(1, Math.trunc(Number(field(formData, "fiscalYearEndMonth", "fiscal_year_end_month") ?? 12))),
  )
  const fiscalDay = Math.min(
    31,
    Math.max(1, Math.trunc(Number(field(formData, "fiscalYearEndDay", "fiscal_year_end_day") ?? 31))),
  )

  return {
    name,
    code,
    currencyId,
    fiscalYearEndMonth: fiscalMonth,
    fiscalYearEndDay: fiscalDay,
    isParent: field(formData, "isParent", "is_parent") === true,
    parentId: optionalBigIntU64(field(formData, "parentId", "parent_id")),
    taxId: optionalTrimmedString(field(formData, "taxId", "tax_id")),
    companyRegistry: optionalTrimmedString(field(formData, "companyRegistry", "company_registry")),
    addressStreet: optionalTrimmedString(field(formData, "addressStreet", "address_street")),
    addressCity: optionalTrimmedString(field(formData, "addressCity", "address_city")),
    addressZip: optionalTrimmedString(field(formData, "addressZip", "address_zip")),
    addressCountryCode: optionalTrimmedString(
      field(formData, "addressCountryCode", "address_country_code"),
    ),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWhatsAppBusinessAccountParams(
  formData: Record<string, unknown>,
): CreateWhatsAppBusinessAccountParams | null {
  const name = requiredTrimmedString(field(formData, "name", "name"))
  const phoneNumber = requiredTrimmedString(field(formData, "phoneNumber", "phone_number"))
  const phoneNumberId = requiredTrimmedString(field(formData, "phoneNumberId", "phone_number_id"))
  const businessAccountId = requiredTrimmedString(
    field(formData, "businessAccountId", "business_account_id"),
  )
  const displayName = requiredTrimmedString(field(formData, "displayName", "display_name"))
  const credentialsReference = requiredTrimmedString(
    field(formData, "credentialsReference", "credentials_reference"),
  )
  const webhookSecretReference = requiredTrimmedString(
    field(formData, "webhookSecretReference", "webhook_secret_reference"),
  )
  if (
    !name ||
    !phoneNumber ||
    !phoneNumberId ||
    !businessAccountId ||
    !displayName ||
    !credentialsReference ||
    !webhookSecretReference
  ) {
    return null
  }

  return {
    name,
    phoneNumber,
    phoneNumberId,
    businessAccountId,
    displayName,
    credentialsReference,
    webhookSecretReference,
    messagingEnabled: field(formData, "messagingEnabled", "messaging_enabled") !== false,
    notificationsEnabled: field(formData, "notificationsEnabled", "notifications_enabled") !== false,
    templateMessagingEnabled:
      field(formData, "templateMessagingEnabled", "template_messaging_enabled") !== false,
    interactiveMessagingEnabled:
      field(formData, "interactiveMessagingEnabled", "interactive_messaging_enabled") !== false,
    defaultLanguage: String(field(formData, "defaultLanguage", "default_language") ?? "en"),
    webhookEnabled: field(formData, "webhookEnabled", "webhook_enabled") === true,
    webhookUrl: optionalTrimmedString(field(formData, "webhookUrl", "webhook_url")),
    subscribedWebhookEvents: stringArrayFromForm(
      field(formData, "subscribedWebhookEvents", "subscribed_webhook_events"),
    ),
    dailyMessageLimit: Math.max(
      0,
      Math.trunc(Number(field(formData, "dailyMessageLimit", "daily_message_limit") ?? 1000)),
    ),
    isPrimary: field(formData, "isPrimary", "is_primary") === true,
    templateNamespace: optionalTrimmedString(
      field(formData, "templateNamespace", "template_namespace"),
    ),
    mediaProvider: optionalTrimmedString(field(formData, "mediaProvider", "media_provider")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
