/**
 * Organization scope for module clients. Never default missing org to `1` — that
 * can silently mutate the wrong tenant. Use `hasValidOrganizationId` and render
 * `@lumiere/ui` `MissingOrganization` when the user has no org.
 */
export function hasValidOrganizationId(
  organizationId: number | undefined,
): organizationId is number {
  return organizationId != null && Number.isFinite(organizationId) && organizationId > 0
}

/**
 * BigInt org ids for hooks and reducers. Call only when
 * {@link hasValidOrganizationId} is true.
 */
export function orgBigInts(organizationId: number): { orgId: bigint; companyId: bigint } {
  const id = BigInt(organizationId)
  return { orgId: id, companyId: id }
}

/** Merge optional company scope into SpacetimeDB reducer JSON bodies (companyId as string). */
export function withCompanyScope(
  params: Record<string, unknown>,
  companyId?: bigint,
): Record<string, unknown> {
  if (companyId === undefined) return params
  return { ...params, companyId: companyId.toString() }
}
