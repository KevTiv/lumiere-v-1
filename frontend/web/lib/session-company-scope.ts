const ORGANIZATION_ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "organization-admin",
  "owner",
])

export type SessionCompany = {
  readonly id: number
  readonly isParent: boolean
}

type SessionRoleRow = {
  readonly [key: string]: unknown
  readonly id?: unknown
  readonly name?: unknown
}

function positiveId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function rowValue(row: SessionRoleRow, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

function timestampMicros(value: unknown): number | null {
  if (typeof value === "number" || typeof value === "string") {
    const micros = Number(value)
    return Number.isSafeInteger(micros) ? micros : null
  }
  if (value == null || typeof value !== "object") return null
  const record = value as { readonly [key: string]: unknown }
  return timestampMicros(
    record["__timestamp_micros_since_unix_epoch__"]
      ?? record["microsSinceUnixEpoch"]
      ?? record["some"],
  )
}

function assignmentIsCurrent(row: SessionRoleRow, nowMicros: number): boolean {
  if (rowValue(row, "isActive", "is_active") !== true) return false
  const rawExpiry = rowValue(row, "expiresAt", "expires_at")
  if (rawExpiry == null) return true
  const micros = timestampMicros(rawExpiry)
  return micros != null && micros > nowMicros
}

type SessionRoleInput = {
  readonly organizationId: number
  readonly roles: readonly SessionRoleRow[]
  readonly memberships: readonly SessionRoleRow[]
  readonly assignments: readonly SessionRoleRow[]
  readonly nowMicros?: number
}

function resolveSessionRoles(input: SessionRoleInput): Array<{ id: number; name: string }> {
  const organizationId = positiveId(input.organizationId)
  if (organizationId == null) return []
  const activeRoles = new Map<number, string>()
  for (const role of input.roles) {
    if (rowValue(role, "isActive", "is_active") !== true) continue
    if (positiveId(rowValue(role, "organizationId", "organization_id")) !== organizationId) continue
    const id = positiveId(role.id)
    const name = typeof role.name === "string" ? role.name.trim() : ""
    if (id != null && name) activeRoles.set(id, name)
  }

  // Authorization requires exactly one active organization membership. Match
  // that fail-closed boundary instead of hydrating UI authority ambiguously.
  const activeMemberships = input.memberships.filter(
    (row) => rowValue(row, "isActive", "is_active") === true
      && positiveId(rowValue(row, "organizationId", "organization_id")) === organizationId,
  )
  if (activeMemberships.length !== 1) return []

  const roleIds = new Set<number>()
  const membershipRoleId = positiveId(
    rowValue(activeMemberships[0]!, "roleId", "role_id"),
  )
  if (membershipRoleId != null && activeRoles.has(membershipRoleId)) {
    roleIds.add(membershipRoleId)
  }

  const nowMicros = input.nowMicros ?? Date.now() * 1_000
  for (const assignment of input.assignments) {
    if (!assignmentIsCurrent(assignment, nowMicros)) continue
    if (positiveId(rowValue(assignment, "organizationId", "organization_id")) !== organizationId) continue
    const roleId = positiveId(rowValue(assignment, "roleId", "role_id"))
    if (roleId != null && activeRoles.has(roleId)) roleIds.add(roleId)
  }

  return [...roleIds].map((id) => ({ id, name: activeRoles.get(id)! }))
}

/** Resolve the same effective base + additive role set used by API authorization. */
export function resolveSessionRoleNames(input: SessionRoleInput): string[] {
  return [...new Set(resolveSessionRoles(input).map((role) => role.name))]
}

export function resolveSessionRoleIds(input: SessionRoleInput): number[] {
  return resolveSessionRoles(input).map((role) => role.id)
}

export function resolveSessionAuthorityExpiryMicros(input: SessionRoleInput): number | null {
  const organizationId = positiveId(input.organizationId)
  if (organizationId == null) return null
  const nowMicros = input.nowMicros ?? Date.now() * 1_000
  const roleIds = new Set(resolveSessionRoles(input).map((role) => role.id))
  const expiries = input.assignments.flatMap((assignment) => {
    if (rowValue(assignment, "isActive", "is_active") !== true) return []
    if (positiveId(rowValue(assignment, "organizationId", "organization_id")) !== organizationId) return []
    const roleId = positiveId(rowValue(assignment, "roleId", "role_id"))
    const expiry = timestampMicros(rowValue(assignment, "expiresAt", "expires_at"))
    return roleId != null && roleIds.has(roleId) && expiry != null && expiry > nowMicros ? [expiry] : []
  })
  return expiries.length > 0 ? Math.min(...expiries) : null
}

/** Whether an active assignment expired after the currently cached policy snapshot. */
export function sessionPolicySnapshotNeedsRefresh(input: {
  readonly assignments: readonly SessionRoleRow[]
  readonly refreshedAt: unknown
  readonly nowMicros?: number
}): boolean {
  const refreshedAt = timestampMicros(input.refreshedAt)
  if (refreshedAt == null) return false
  const nowMicros = input.nowMicros ?? Date.now() * 1_000
  return input.assignments.some((assignment) => {
    if (rowValue(assignment, "isActive", "is_active") !== true) return false
    const expiry = timestampMicros(rowValue(assignment, "expiresAt", "expires_at"))
    return expiry != null && expiry > refreshedAt && expiry <= nowMicros
  })
}

/**
 * Resolve the legal entities a browser session may select.
 *
 * Organization administrators may operate every company returned by the
 * organization-scoped companies query. Company-bound users remain pinned to
 * their active membership company; a missing membership falls back to one
 * deterministic company so the UI never invents cross-company authority.
 */
export function resolveSessionCompanyIds(input: {
  readonly companies: readonly SessionCompany[]
  readonly membershipCompanyId?: number | null
  readonly roleNames: readonly string[]
}): number[] {
  const companies = input.companies
    .filter((company) => Number.isSafeInteger(company.id) && company.id > 0)
    .sort((a, b) => Number(b.isParent) - Number(a.isParent) || a.id - b.id)
  const validIds = new Set(companies.map((company) => company.id))
  const isOrganizationAdmin = input.roleNames.some((role) =>
    ORGANIZATION_ADMIN_ROLES.has(role.trim().toLowerCase().replace(/[\s_]+/g, "-")),
  )

  if (isOrganizationAdmin) return [...validIds]
  if (input.membershipCompanyId != null && validIds.has(input.membershipCompanyId)) {
    return [input.membershipCompanyId]
  }
  const fallback = companies[0]?.id
  return fallback == null ? [] : [fallback]
}
