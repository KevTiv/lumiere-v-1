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
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"
import { sessionAllowsPermission, type SessionPermissionAuthority } from "../../../../lib/session-permissions"

export interface RagUiActionOffer {
  capability_key: string
  kind: AssistantActionKind
  label: string
  entity_type?: string
  widgets?: AssistantPageWidget[]
}

/** Offers are always built from the shared native catalog and verified session.
 * There is intentionally no browser-supplied catalog, URL, scope or prefill input.
 */
export function serverRagUiActionOffers(
  authority: SessionPermissionAuthority,
  page?: AssistantPageCatalog,
): RagUiActionOffer[] {
  const offers: RagUiActionOffer[] = ALPHA_ASSISTANT_CAPABILITIES.filter(
    (capability) => {
      if (!isWorkspaceSurfaceVisible("finance-alpha", capability.module))
        return false
      const surface = getAssistantCapability(`${capability.module}.navigate`)
      return (
        surface != null &&
        sessionAllowsPermission(authority, surface.permission.resource, "read") &&
        sessionAllowsPermission(
          authority,
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
      !sessionAllowsPermission(authority, capability.permission.resource, "read")
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
