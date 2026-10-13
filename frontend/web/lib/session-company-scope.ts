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
