import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type FormConfigProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly moduleId?: unknown
  readonly module_id?: unknown
  readonly formId?: unknown
  readonly form_id?: unknown
  readonly isActive?: unknown
  readonly is_active?: unknown
  readonly configVersion?: unknown
  readonly config_version?: unknown
  readonly updatedAt?: unknown
  readonly updated_at?: unknown
}

export type FormConfigKey = {
  readonly organizationId: bigint
  readonly moduleId: string
  readonly formId: string
}

function exactConfig(rows: readonly FormConfigProjection[], key: FormConfigKey): FormConfigProjection | null {
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.organizationId ?? row.organization_id) === key.organizationId
      && String(row.moduleId ?? row.module_id ?? "") === key.moduleId
      && String(row.formId ?? row.form_id ?? "") === key.formId,
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one form configuration, found ${matches.length}`)
  }
  return matches[0] ?? null
}

/** The published `config_version` for the exact (organization, module, form), or `null` when unpublished. */
export function formConfigVersion(rows: readonly FormConfigProjection[], key: FormConfigKey): bigint | null {
  const row = exactConfig(rows, key)
  return row ? (parseStrictU64(row.configVersion ?? row.config_version) ?? null) : null
}

/**
 * `updated_at` of the exact configuration in micros, the compare-and-set token a publish over
 * an existing configuration must send as `expected_updated_at_micros`; `null` when unpublished
 * or unreadable (a Timestamp object, number, bigint or numeric string).
 */
export function formConfigUpdatedAtMicros(rows: readonly FormConfigProjection[], key: FormConfigKey): number | null {
  const row = exactConfig(rows, key)
  if (!row) return null
  const raw = row.updatedAt ?? row.updated_at
  const inner =
    raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).__timestamp_micros_since_unix_epoch__
        ?? (raw as Record<string, unknown>).microsSinceUnixEpoch)
      : raw
  const micros = parseStrictU64(inner)
  return micros == null ? null : Number(micros)
}

/** The version a publish must produce from `previous` (`null` = first publish). */
export function nextFormConfigVersion(previous: bigint | null): bigint {
  return previous == null ? 1n : previous + 1n
}

/**
 * COV-22: resolve the form configuration for the exact (organization, module, form)
 * at exactly the expected version, active. A different version means the publish did
 * not apply once (or raced another publish) and is no effect.
 */
export function resolvePublishedFormConfig(
  rows: readonly FormConfigProjection[],
  key: FormConfigKey,
  expectedVersion: bigint,
): CanonicalRecordRef | null {
  const row = exactConfig(rows, key)
  const id = row ? parseStrictU64(row.id) : undefined
  if (!row || id == null) return null
  if (parseStrictU64(row.configVersion ?? row.config_version) !== expectedVersion) return null
  const active = row.isActive ?? row.is_active
  if (active === false || active === "false") return null
  return { resource: "form-configs", id: id.toString() }
}
