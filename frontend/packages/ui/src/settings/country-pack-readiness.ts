import type {
  CompanyCountryPackRow,
  CountryPackDefinitionRow,
} from "@lumiere/query-hooks/hooks/organization-company"

export type CountryPackActivationBlock =
  | "review_required"
  | "inactive"
  | "not_yet_effective"
  | "expired"
  | "invalid_effective_window"
  | "not_accepted"
  | "version_mismatch"

export interface CountryPackOfficialSource {
  authority: string
  title: string
  url: string
  accessedOn: string
}

export interface CountryPackComplianceEvidence {
  officialSources: CountryPackOfficialSource[]
  confirmationRequired: string[]
  lastReviewedOn: string | null
}

export interface CountryPackReadiness {
  packKey: string
  countryCode: string
  name: string
  region: string
  version: string
  acceptanceStatus: string
  effectiveFrom: Date | null
  effectiveTo: Date | null
  enabled: boolean
  pinnedPackVersion: string | null
  pinMatchesCatalog: boolean
  canActivate: boolean
  activationBlock: CountryPackActivationBlock | null
  complianceEvidence: CountryPackComplianceEvidence
}

interface MetadataObject {
  [key: string]: unknown
}

type TimestampObject = {
  some?: unknown
  none?: unknown
  __timestamp_micros_since_unix_epoch__?: unknown
  microsSinceUnixEpoch?: unknown
  toDate?: () => Date
}

function optionalValue(raw: unknown): unknown {
  if (raw == null) return null
  if (typeof raw !== "object") return raw
  const value = raw as TimestampObject
  if ("none" in value) return null
  if ("some" in value) return value.some
  return raw
}

/** Parse SpacetimeDB timestamps and API ISO timestamps without guessing invalid values. */
export function countryPackTimestamp(raw: unknown): Date | null {
  const value = optionalValue(raw)
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }
  if (typeof value === "object") {
    const timestamp = value as TimestampObject
    if (typeof timestamp.toDate === "function") {
      return countryPackTimestamp(timestamp.toDate.call(value))
    }
    if (timestamp.__timestamp_micros_since_unix_epoch__ != null) {
      return countryPackTimestamp(
        timestamp.__timestamp_micros_since_unix_epoch__,
      )
    }
    if (timestamp.microsSinceUnixEpoch != null) {
      return countryPackTimestamp(timestamp.microsSinceUnixEpoch)
    }
    return null
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const milliseconds = Math.abs(numeric) > 1e15 ? numeric / 1000 : numeric
  const parsed = new Date(milliseconds)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function activationBlockFor(
  definition: CountryPackDefinitionRow,
  activation: CompanyCountryPackRow | undefined,
  now: Date,
): CountryPackActivationBlock | null {
  const status = definition.acceptanceStatus.trim().toLowerCase()
  if (status === "review_required") return "review_required"
  if (status !== "accepted" && status !== "legacy_enabled")
    return "not_accepted"
  if (!definition.isActive) return "inactive"

  const from = countryPackTimestamp(definition.effectiveFrom)
  const to = countryPackTimestamp(definition.effectiveTo)
  if (
    (optionalValue(definition.effectiveFrom) != null && from == null) ||
    (optionalValue(definition.effectiveTo) != null && to == null)
  ) {
    return "invalid_effective_window"
  }
  if (from && now.getTime() < from.getTime()) return "not_yet_effective"
  if (to && now.getTime() >= to.getTime()) return "expired"

  const pinnedVersion = activation?.pinnedPackVersion.trim() ?? ""
  if (pinnedVersion && pinnedVersion !== definition.version)
    return "version_mismatch"
  return null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function safeHttpsUrl(value: unknown): string | null {
  const raw = nonEmptyString(value)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}

/** Extract review evidence without trusting malformed pack metadata. */
export function countryPackComplianceEvidence(
  rawMetadata: string | null | undefined,
): CountryPackComplianceEvidence {
  let metadata: MetadataObject = {}
  try {
    const parsed = JSON.parse(rawMetadata ?? "null") as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as MetadataObject
    }
  } catch {
    // Invalid metadata provides no evidence and never relaxes the activation gate.
  }

  const sources = Array.isArray(metadata.official_sources)
    ? metadata.official_sources
    : []
  const officialSources = sources.flatMap((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source))
      return []
    const row = source as MetadataObject
    const authority = nonEmptyString(row.authority)
    const title = nonEmptyString(row.title)
    const url = safeHttpsUrl(row.url)
    const accessedOn = nonEmptyString(row.accessed_on)
    if (!authority || !title || !url || !accessedOn) return []
    return [{ authority, title, url, accessedOn }]
  })
  const confirmationRequired = Array.isArray(
    metadata.professional_confirmation_required,
  )
    ? metadata.professional_confirmation_required.flatMap((value) => {
        const item = nonEmptyString(value)
        return item ? [item] : []
      })
    : []
  const lastReviewedOn =
    officialSources
      .map((source) => source.accessedOn)
      .sort((left, right) => right.localeCompare(left))[0] ?? null

  return { officialSources, confirmationRequired, lastReviewedOn }
}

/** Build the fail-closed administration view used by settings and module panels. */
export function countryPackReadiness(
  definitions: CountryPackDefinitionRow[],
  activations: CompanyCountryPackRow[],
  now = new Date(),
): CountryPackReadiness[] {
  const activationsByKey = new Map(
    activations.map((row) => [row.packKey.trim().toLowerCase(), row] as const),
  )

  return definitions.map((definition) => {
    const packKey = definition.packKey.trim().toLowerCase()
    const activation = activationsByKey.get(packKey)
    const activationBlock = activationBlockFor(definition, activation, now)
    const pinnedPackVersion = activation?.pinnedPackVersion.trim() || null
    return {
      packKey,
      countryCode: definition.countryCode.trim().toUpperCase(),
      name: definition.name,
      region: definition.region,
      version: definition.version,
      acceptanceStatus: definition.acceptanceStatus.trim().toLowerCase(),
      effectiveFrom: countryPackTimestamp(definition.effectiveFrom),
      effectiveTo: countryPackTimestamp(definition.effectiveTo),
      enabled: Boolean(activation?.enabled),
      pinnedPackVersion,
      pinMatchesCatalog:
        pinnedPackVersion == null || pinnedPackVersion === definition.version,
      canActivate: activationBlock == null,
      activationBlock,
      complianceEvidence: countryPackComplianceEvidence(definition.metadata),
    }
  })
}
