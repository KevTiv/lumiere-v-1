/** Synthetic RBAC grants are not a persisted role for form-field visibility. */
export const EFFECTIVE_ACCESS_ROLE_ID = "__effective_access__"

export function resolveRuntimeFormRoleId(
  roles: readonly string[] | null | undefined,
): string | undefined {
  return roles?.find((roleId) => roleId.length > 0 && roleId !== EFFECTIVE_ACCESS_ROLE_ID)
}

/** Retain the session-object API used by existing module forms. */
export function runtimeFormRoleId(
  user: { readonly roles: readonly string[] } | null | undefined,
): string | undefined {
  return resolveRuntimeFormRoleId(user?.roles)
}
