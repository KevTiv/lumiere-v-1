/** Synthetic RBAC role carrying the session's merged permissions; it has no persisted form role config. */
export const EFFECTIVE_ACCESS_ROLE_ID = "__effective_access__"

/** The persisted role id runtime forms resolve their role configuration against. */
export function runtimeFormRoleId(
  user: { readonly roles: readonly string[] } | null | undefined,
): string | undefined {
  return user?.roles.find((roleId) => roleId !== EFFECTIVE_ACCESS_ROLE_ID)
}
