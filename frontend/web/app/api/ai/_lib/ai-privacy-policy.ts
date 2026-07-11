/**
 * Resolve an organization-level AI privacy policy from Casbin field-access rules.
 *
 * Conventions (mirrored from `frontend/packages/stdb/src/field-policy.ts`):
 * - `ptype` must be `"p"` (policy rule).
 * - `v0` is the subject: identity hex, role id, or role name.
 * - `v1` must equal the organization id.
 * - `v2` is the resource: `ai:output:*` or `ai:output:{field}`.
 * - `v3` is the action: `"read"` or `"*"`.
 * - `v4` is the effect: `"allow" | "mask" | "deny"`.
 * - `v5` or `metadata.fields` lists comma-separated field names (used when `v2` is `ai:output:*`).
 *
 * Org policy is a further restriction on the skill manifest's privacy allowlist:
 * - `deny` suppresses a field even if the skill allows it.
 * - `mask` returns the field masked even if the skill would return it plain.
 * - `allow` is recorded but does not widen the skill's allowlist (fail-closed).
 */

import type { FieldAccessContext } from '@lumiere/stdb/server'

export interface AiPrivacyPolicy {
  allowedFields: string[]
  maskedFields: string[]
  suppressedFields: string[]
  maskPhoneFields: boolean
  maskPaymentReferences: boolean
  suppressSecrets: boolean
}

export const DEFAULT_AI_PRIVACY_POLICY: AiPrivacyPolicy = {
  allowedFields: [],
  maskedFields: [],
  suppressedFields: [],
  maskPhoneFields: true,
  maskPaymentReferences: true,
  suppressSecrets: true,
}

const AI_OUTPUT_RESOURCE_PREFIX = 'ai:output:'

type PrivacyEffect = 'allow' | 'mask' | 'deny'

function isEffect(value: string | null | undefined): value is PrivacyEffect {
  return value === 'allow' || value === 'mask' || value === 'deny'
}

function normalizeField(field: string): string {
  return field
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase()
    .trim()
}

function parseFieldsFromMetadata(metadata: string | null | undefined): string[] | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as { fields?: unknown }
    if (!Array.isArray(parsed.fields)) return null
    const fields = parsed.fields
      .filter((item): item is string => typeof item === 'string')
      .map((field) => normalizeField(field))
      .filter(Boolean)
    return fields.length > 0 ? fields : null
  } catch {
    return null
  }
}

function parseFieldsFromV5(v5: string | null | undefined): string[] | null {
  if (!v5?.trim()) return null
  const fields = v5
    .split(',')
    .map((field) => normalizeField(field))
    .filter(Boolean)
  return fields.length > 0 ? fields : null
}

function parseFields(rule: {
  v2: string | null | undefined
  v5: string | null | undefined
  metadata: string | null | undefined
}): string[] {
  const explicitField = rule.v2?.startsWith(AI_OUTPUT_RESOURCE_PREFIX)
    ? rule.v2.slice(AI_OUTPUT_RESOURCE_PREFIX.length)
    : null

  if (explicitField && explicitField !== '*') {
    const normalized = normalizeField(explicitField)
    return normalized ? [normalized] : []
  }

  return parseFieldsFromMetadata(rule.metadata) ?? parseFieldsFromV5(rule.v5) ?? []
}

function subjectMatches(
  v0: string | null | undefined,
  fieldAccess: FieldAccessContext,
): boolean {
  if (!v0) return false
  return (
    v0 === fieldAccess.identityHex ||
    v0 === String(fieldAccess.roleId) ||
    v0 === fieldAccess.roleName
  )
}

export function resolveAiPrivacyPolicy(
  fieldAccess: FieldAccessContext | undefined,
): AiPrivacyPolicy {
  if (!fieldAccess) return DEFAULT_AI_PRIVACY_POLICY

  if (fieldAccess.isSuperuser || fieldAccess.rolePermissions.includes('*:*')) {
    // Superusers and global wildcard holders get the default restrictive policy,
    // which still lets skill-level defaults apply but does not add extra restrictions.
    return DEFAULT_AI_PRIVACY_POLICY
  }

  const orgStr = String(fieldAccess.organizationId)
  const allowed = new Set<string>()
  const masked = new Set<string>()
  const suppressed = new Set<string>()
  let maskPhoneFields = true
  let maskPaymentReferences = true
  let suppressSecrets = true

  for (const rule of fieldAccess.casbinRules) {
    if (rule.ptype !== 'p') continue
    if (!subjectMatches(rule.v0, fieldAccess)) continue
    if (rule.v1 !== orgStr) continue

    const v2 = rule.v2 ?? ''
    const v3 = rule.v3 ?? ''

    if (!v2.startsWith(AI_OUTPUT_RESOURCE_PREFIX)) continue
    if (!(v3 === 'read' || v3 === '*')) continue

    const effect = rule.v4?.toLowerCase() ?? ''
    if (!isEffect(effect)) continue

    const fields = parseFields({ v2, v5: rule.v5, metadata: rule.metadata })
    if (fields.length === 0) {
      // `ai:output:*` without explicit fields: apply effect to the wildcard flag.
      if (effect === 'allow') {
        maskPhoneFields = false
        maskPaymentReferences = false
        suppressSecrets = false
      } else if (effect === 'mask') {
        // `mask` on wildcard is interpreted as "keep default category masking".
        // No-op because defaults are already true.
      } else if (effect === 'deny') {
        suppressSecrets = true
      }
      continue
    }

    for (const field of fields) {
      if (effect === 'allow') {
        allowed.add(field)
        suppressed.delete(field)
        masked.delete(field)
      } else if (effect === 'mask') {
        masked.add(field)
        suppressed.delete(field)
      } else if (effect === 'deny') {
        suppressed.add(field)
        masked.delete(field)
      }
    }
  }

  return {
    allowedFields: Array.from(allowed),
    maskedFields: Array.from(masked),
    suppressedFields: Array.from(suppressed),
    maskPhoneFields,
    maskPaymentReferences,
    suppressSecrets,
  }
}
