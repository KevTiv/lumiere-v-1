import {
  ALPHA_ASSISTANT_CAPABILITIES,
  ASSISTANT_PAGE_CAPABILITIES,
  ASSISTANT_PAGE_WIDGET_LIMIT,
  getAssistantCapability,
  isAssistantPageModule,
  parseAssistantWidgetKey,
  type AssistantActionKind,
  type AssistantPageCatalog,
  type AssistantPageWidget,
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
  widgets?: AssistantPageWidget[]
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
  page?: AssistantPageCatalog,
): RagUiActionOffer[] {
  const access = authority.fieldAccess
  if (
    !access ||
    access.organizationId !== authority.organizationId ||
    identity(access.identityHex) !== identity(authority.identityHex)
  )
    return []
  const offers: RagUiActionOffer[] = ALPHA_ASSISTANT_CAPABILITIES.filter(
    (capability) => {
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
    },
  ).map((capability) => ({
    capability_key: capability.key,
    kind: capability.kind,
    label: capability.label,
    ...(capability.entityType ? { entity_type: capability.entityType } : {}),
  }))
  if (!page || !isAssistantPageModule(page.moduleId)) return offers
  const seen = new Set<string>()
  const widgets = page.widgets
    .flatMap((widget) => {
      const label = widget.label.trim()
      if (
        !parseAssistantWidgetKey(widget.key) ||
        !label ||
        label.length > 120 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(label) ||
        seen.has(widget.key)
      )
        return []
      seen.add(widget.key)
      return [{ key: widget.key, label }]
    })
    .slice(0, ASSISTANT_PAGE_WIDGET_LIMIT)
  for (const capability of ASSISTANT_PAGE_CAPABILITIES) {
    if (
      capability.module !== page.moduleId ||
      !permits(access, capability.permission.resource, "read")
    )
      continue
    offers.push({
      capability_key: capability.key,
      kind: capability.kind,
      label: capability.label,
      ...(capability.kind === "add_widget" && widgets.length
        ? { widgets }
        : {}),
    })
  }
  return offers
}
