import {
  ALPHA_ASSISTANT_CAPABILITIES,
  getAssistantCapability,
  type AssistantActionKind,
} from "@lumiere/query-hooks/assistant-actions"
import type { FieldAccessContext } from "@lumiere/stdb/server"
import {
  actionsMatch,
  parsePermissionString,
  resourcesMatch,
} from "@lumiere/ui/lib/rbac-defaults"
import type { Resource } from "@lumiere/ui/lib/rbac-types"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"

export interface RagUiActionOffer {
  capability_key: string
  kind: AssistantActionKind
  label: string
  entity_type?: string
}

interface OfferAuthority {
  identityHex: string
  organizationId: number | undefined
  fieldAccess?: FieldAccessContext
}

const identity = (value: string) =>
  value.trim().replace(/^0x/i, "").toLowerCase()

/** Discovery uses the same native presentation policy semantics as the UI.
 * This cannot grant a row read or execute an operation; native owners recheck.
 */
function permits(
  access: FieldAccessContext,
  resource: string,
  action: "read" | "create",
): boolean {
  if (access.isSuperuser) return true
  const matches = (rule: { resource: string; action: string }) =>
    resourcesMatch(rule.resource as Resource, resource as Resource) &&
    actionsMatch(rule.action as "read" | "create" | "*", action)
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

/** Offers are always built from the shared native catalog and verified session.
 * There is intentionally no browser-supplied catalog, URL, scope or prefill input.
 */
export function serverRagUiActionOffers(
  authority: OfferAuthority,
): RagUiActionOffer[] {
  const access = authority.fieldAccess
  if (
    !access ||
    access.organizationId !== authority.organizationId ||
    identity(access.identityHex) !== identity(authority.identityHex)
  )
    return []
  return ALPHA_ASSISTANT_CAPABILITIES.filter((capability) => {
    if (!isWorkspaceSurfaceVisible("finance-alpha", capability.module))
      return false
    const surface = getAssistantCapability(`${capability.module}.navigate`)
    return (
      surface != null &&
      permits(access, surface.permission.resource, "read") &&
      permits(
        access,
        capability.permission.resource,
        capability.permission.action,
      )
    )
  }).map((capability) => ({
    capability_key: capability.key,
    kind: capability.kind,
    label: capability.label,
    ...(capability.entityType ? { entity_type: capability.entityType } : {}),
  }))
}
