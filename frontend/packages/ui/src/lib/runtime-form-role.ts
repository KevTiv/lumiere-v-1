/** Aggregate RBAC grants are not a persisted role for form-field visibility. */
export const EFFECTIVE_ACCESS_ROLE_ID = "__effective_access__"

/** Select a real role for legacy role-scoped forms, excluding the synthetic grant role. */
export function resolveRuntimeFormRoleId(
  roles: readonly string[] | null | undefined,
): string | undefined {
  return roles?.find((roleId) => roleId.length > 0 && roleId !== EFFECTIVE_ACCESS_ROLE_ID)
}
