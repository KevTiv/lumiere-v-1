/**
 * Organization scope for module clients. Never default missing org to `1` — that
 * can silently mutate the wrong tenant. Use `hasValidOrganizationId` and render
 * `@lumiere/ui` `MissingOrganization` when the user has no org.
 *
 * Historical reducer params call this value `companyId`, but in the ERP domain
 * it represents the tenant/organization scope, not a company/partner register row.
 */
export function hasValidOrganizationId(
  organizationId: number | undefined,
): organizationId is number {
  return organizationId != null && Number.isFinite(organizationId) && organizationId > 0
}

export interface OrganizationScopeBigInts {
  orgId: bigint
  organizationScopeId: bigint
  /**
   * @deprecated Operating company id must come from {@link useOperatingCompanyBigInt}
   * or the global company switcher — never alias the organization id.
   */
  companyId?: bigint
}

/**
 * BigInt organization ids for hooks and reducers. Call only when
 * {@link hasValidOrganizationId} is true.
 */
export function organizationScopeBigInts(organizationId: number): OrganizationScopeBigInts {
  const id = BigInt(organizationId)
  return { orgId: id, organizationScopeId: id }
}

/**
 * @deprecated Use `organizationScopeBigInts`. Kept to avoid a breaking rename
 * across every module client in one step.
 */
export const orgBigInts = organizationScopeBigInts

/**
 * Merge optional organization scope into SpacetimeDB reducer JSON bodies.
 *
 * The wire key remains `companyId` until SpacetimeDB reducer params are renamed.
 */
function isValidOperatingCompanyId(id: bigint | number | undefined): id is bigint | number {
  if (id === undefined) return false
  if (typeof id === "bigint") return id > 0n
  return Number.isFinite(id) && id > 0
}

export function withOrganizationScope(
  params: Record<string, unknown>,
  organizationScopeId?: bigint,
): Record<string, unknown> {
  if (!isValidOperatingCompanyId(organizationScopeId)) return params
  return { ...params, companyId: organizationScopeId }
}

/**
 * @deprecated Use `withOrganizationScope`. This function writes the legacy
 * `companyId` wire key for existing reducers.
 */
export const withCompanyScope = withOrganizationScope
