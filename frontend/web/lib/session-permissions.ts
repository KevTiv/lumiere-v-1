import type { FieldAccessContext } from "@lumiere/stdb/server"
import {
  actionsMatch,
  parsePermissionString,
  resourcesMatch,
} from "@lumiere/ui/lib/rbac-defaults"
import type { Action, Resource } from "@lumiere/ui/lib/rbac-types"

export interface SessionPermissionAuthority {
  identityHex: string
  organizationId: number | undefined
  fieldAccess?: FieldAccessContext
}

const identity = (value: string) =>
  value.trim().replace(/^0x/i, "").toLowerCase()

/** Preflight with the existing presentation policy; native owners recheck writes. */
export function sessionAllowsPermission(
  authority: SessionPermissionAuthority,
  resource: Resource,
  action: Action,
): boolean {
  const access = authority.fieldAccess
  if (
    !access ||
    access.organizationId !== authority.organizationId ||
    identity(access.identityHex) !== identity(authority.identityHex)
  )
    return false
  if (access.isSuperuser) return true

  const matches = (rule: { resource: string; action: string }) =>
    resourcesMatch(rule.resource as Resource, resource) &&
    actionsMatch(rule.action as Action | "*", action)
  const overrides = access.orgPermissions?.filter(matches) ?? []
  if (overrides.some((rule) => !rule.allow)) return false
  return (
    overrides.some((rule) => rule.allow) ||
    access.rolePermissions.some((permission) => {
      const rule = parsePermissionString(permission)
      return rule != null && matches(rule)
    })
  )
}
