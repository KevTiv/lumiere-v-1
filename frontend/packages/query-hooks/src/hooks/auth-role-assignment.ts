import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type RoleAssignmentProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly userIdentity?: unknown
  readonly user_identity?: unknown
  readonly roleId?: unknown
  readonly role_id?: unknown
  readonly isActive?: unknown
  readonly is_active?: unknown
}

function identityHex(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return identityHex(record.hex ?? record.Hex ?? record.__identity__ ?? "")
  }
  return String(value ?? "").trim().replace(/^0x/i, "").toLowerCase()
}

const ref = (id: bigint): CanonicalRecordRef => ({ resource: "user-role-assignment", id: id.toString() })

/** COV-23: the single active assignment of `roleId` to `userIdentity` in the organization. */
export function resolveActiveRoleAssignmentEffect(
  rows: readonly RoleAssignmentProjection[],
  organizationId: bigint,
  userIdentity: string,
  roleId: bigint,
): CanonicalRecordRef | null {
  const identity = identityHex(userIdentity)
  if (!identity) return null
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      parseStrictU64(row.roleId ?? row.role_id) === roleId &&
      identityHex(row.userIdentity ?? row.user_identity) === identity &&
      (row.isActive ?? row.is_active) === true,
  )
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one active role assignment, found ${matches.length}`)
  const id = parseStrictU64(matches[0]?.id)
  return id == null ? null : ref(id)
}

/** COV-23: the same assignment id, still in the organization, now inactive. */
export function resolveRevokedRoleAssignmentEffect(
  rows: readonly RoleAssignmentProjection[],
  organizationId: bigint,
  assignmentId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === assignmentId)
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one role assignment, found ${matches.length}`)
  const row = matches[0]
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  if ((row.isActive ?? row.is_active) !== false) return null
  return ref(assignmentId)
}
