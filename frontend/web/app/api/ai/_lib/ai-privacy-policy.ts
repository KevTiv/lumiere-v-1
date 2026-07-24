/**
 * Resolve an organization-level AI privacy policy from field-permission rules.
 *
 * AI output masking previously used Casbin `ai:output:*` resources. With field_permission,
 * org-level AI privacy falls back to restrictive defaults unless future rules adopt
 * `ai:output:` resource keys on field_permission rows.
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

function fieldPermissionActionLabel(
  action: FieldAccessContext['fieldPermissions'][number]['action'],
): string {
  if (typeof action === 'string') return action.toLowerCase()
  if (action && typeof action === 'object') {
    const key = Object.keys(action)[0]
    if (key) return key.toLowerCase()
  }
  return ''
}

function allowedFieldsFromRule(
  rule: FieldAccessContext['fieldPermissions'][number],
): string[] {
  const raw = rule.allowedFields ?? rule.allowed_fields ?? []
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

function subjectApplies(
  rule: FieldAccessContext['fieldPermissions'][number],
  fieldAccess: FieldAccessContext,
): boolean {
  const subjectRoleId = rule.subjectRoleId ?? rule.subject_role_id
  if (subjectRoleId != null && Number(subjectRoleId) === fieldAccess.roleId) {
    return true
  }
  const subjectUserHex = (rule.subjectUserHex ?? rule.subject_user_hex ?? '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase()
  const identityHex = fieldAccess.identityHex.trim().replace(/^0x/i, '').toLowerCase()
  if (subjectUserHex && subjectUserHex === identityHex) return true
  const roleId = rule.roleId ?? rule.role_id
  return roleId != null && Number(roleId) === fieldAccess.roleId
}

export function resolveAiPrivacyPolicy(
  fieldAccess: FieldAccessContext | undefined,
): AiPrivacyPolicy {
  if (!fieldAccess) return DEFAULT_AI_PRIVACY_POLICY

  if (fieldAccess.isSuperuser || fieldAccess.rolePermissions.includes('*:*')) {
    return DEFAULT_AI_PRIVACY_POLICY
  }

  const allowed = new Set<string>()
  const masked = new Set<string>()
  const suppressed = new Set<string>()
  let maskPhoneFields = true
  let maskPaymentReferences = true
  let suppressSecrets = true

  for (const rule of fieldAccess.fieldPermissions) {
    if (fieldPermissionActionLabel(rule.action) !== 'read') continue
    if (!subjectApplies(rule, fieldAccess)) continue

    const resource = String(rule.resource ?? '')
    if (!resource.startsWith(AI_OUTPUT_RESOURCE_PREFIX)) continue

    const explicitField = resource.slice(AI_OUTPUT_RESOURCE_PREFIX.length)
    const fields =
      explicitField && explicitField !== '*'
        ? [explicitField]
        : allowedFieldsFromRule(rule)

    for (const field of fields) {
      suppressed.add(field)
    }
  }

  if (suppressed.size === 0 && allowed.size === 0 && masked.size === 0) {
    return DEFAULT_AI_PRIVACY_POLICY
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
