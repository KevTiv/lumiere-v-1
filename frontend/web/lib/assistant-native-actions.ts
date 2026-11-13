import {
  assistantActionHref,
  assistantPageHasWidget,
  decodeAssistantAction,
  getAssistantCapability,
  parseAssistantActionId,
  parseAssistantWidgetKey,
  ASSISTANT_PROMPT_LIMIT,
  type AssistantAction,
  type AssistantActionResolution,
  type AssistantActionScope,
  type AssistantPageCatalog,
} from "@lumiere/query-hooks/assistant-actions"
import type {
  ChatAction,
  ChatMessageSourceRef,
} from "@lumiere/ui/lib/ai-chat-types"

type Translate = (key: string) => string

const PRESENTATION_REPLY_KEYS: Record<AssistantAction["kind"], string> = {
  navigate: "aiChat.native.destinationReady",
  open_record: "aiChat.native.destinationReady",
  open_form: "aiChat.native.formReady",
  prepare_workflow: "aiChat.native.workflowReady",
  edit_page: "aiChat.native.pageReady",
  add_widget: "aiChat.native.widgetReady",
}

export function nativeChatAction(action: AssistantAction): ChatAction {
  const validated = decodeAssistantAction(action, action.scope)
  const capability =
    validated && getAssistantCapability(validated.capabilityKey)
  if (!validated || !capability)
    throw new Error("Unknown assistant destination")
  return {
    id: `native:${validated.capabilityKey}:${validated.recordId ?? validated.widgetKey ?? "new"}${validated.pageId ? `:${validated.pageId}` : ""}`,
    type: "native",
    label: validated.recordId
      ? `${capability.label} #${validated.recordId}`
      : capability.label,
    nativeAction: validated,
  }
}

/** A clear presentation request needs no model call or business-effect draft. */
export function assistantPresentationReply(
  resolution: AssistantActionResolution,
  t: Translate,
) {
  if (resolution.kind === "none") return undefined
  const actions: ChatAction[] =
    resolution.kind === "action" ? [nativeChatAction(resolution.action)] : []
  return {
    content:
      resolution.kind === "action"
        ? t(PRESENTATION_REPLY_KEYS[resolution.action.kind])
        : t(`aiChat.native.clarify.${resolution.reason}`),
    sources: [] as ChatMessageSourceRef[],
    actions,
  }
}

export interface AssistantUiProposal {
  capability_key: string
  record_id?: string
  widget_key?: string
}

/** Invalid optional UI metadata cannot turn a verified answer into an executable action. */
export function parseAssistantUiProposals(
  value: unknown,
): AssistantUiProposal[] {
  if (!Array.isArray(value) || value.length > 5) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const raw = item as {
      capability_key?: unknown
      record_id?: unknown
      widget_key?: unknown
    }
    if (
      Object.keys(item).some(
        (key) => !["capability_key", "record_id", "widget_key"].includes(key),
      ) ||
      typeof raw.capability_key !== "string"
    )
      return []
    const capability = getAssistantCapability(raw.capability_key)
    if (!capability) return []
    const needsRecord =
      capability.kind === "open_record" ||
      capability.kind === "prepare_workflow"
    if (
      needsRecord
        ? !parseAssistantActionId(raw.record_id)
        : raw.record_id !== undefined
    )
      return []
    if (
      raw.widget_key !== undefined &&
      (capability.kind !== "add_widget" ||
        !parseAssistantWidgetKey(raw.widget_key))
    )
      return []
    const key = `${capability.key}:${raw.record_id ?? raw.widget_key ?? "new"}`
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        capability_key: raw.capability_key,
        ...(typeof raw.record_id === "string"
          ? { record_id: raw.record_id }
          : {}),
        ...(typeof raw.widget_key === "string"
          ? { widget_key: raw.widget_key }
          : {}),
      },
    ]
  })
}

/** The model chooses from server-offered keys; it never supplies a route, form schema or authority. */
export function modelNativeChatActions(
  proposals: unknown,
  scope: AssistantActionScope,
  userText: string,
  page?: AssistantPageCatalog,
): ChatAction[] {
  const seen = new Set<string>()
  return parseAssistantUiProposals(proposals).flatMap((proposal) => {
    const capability = getAssistantCapability(proposal.capability_key)
    if (!capability) return []
    if (
      (capability.kind === "edit_page" || capability.kind === "add_widget") &&
      page?.moduleId !== capability.module
    )
      return []
    if (
      proposal.widget_key &&
      !assistantPageHasWidget(page, capability.module, proposal.widget_key)
    )
      return []
    const action = decodeAssistantAction(
      {
        version: 1,
        kind: capability.kind,
        capabilityKey: capability.key,
        scope,
        ...(proposal.record_id ? { recordId: proposal.record_id } : {}),
        ...(proposal.widget_key ? { widgetKey: proposal.widget_key } : {}),
        ...((capability.kind === "edit_page" ||
          capability.kind === "add_widget") &&
        page
          ? { pageId: page.pageId ?? "dashboard" }
          : {}),
        ...((capability.kind === "open_form" ||
          capability.kind === "prepare_workflow" ||
          capability.kind === "add_widget") &&
        userText.trim() &&
        userText.trim().length <= ASSISTANT_PROMPT_LIMIT
          ? { prompt: userText.trim() }
          : {}),
      },
      scope,
      { page },
    )
    if (!action) return []
    const card = nativeChatAction(action)
    if (seen.has(card.id)) return []
    seen.add(card.id)
    return [card]
  })
}

/** Persist only validated presentation metadata; callbacks and proposed field values are never stored. */
export function withNativeActionsMetadata(
  metadata: string | null,
  actions?: ChatAction[],
): string | null {
  const seen = new Set<string>()
  const nativeActions = (actions ?? []).flatMap((action) => {
    if (action.type !== "native" || !action.nativeAction) return []
    const validated = decodeAssistantAction(
      action.nativeAction,
      action.nativeAction.scope,
    )
    if (!validated) return []
    const key = nativeChatAction(validated).id
    if (seen.has(key)) return []
    seen.add(key)
    return [validated]
  })
  if (!nativeActions.length) return metadata
  const base: unknown = metadata ? JSON.parse(metadata) : {}
  if (!base || typeof base !== "object" || Array.isArray(base))
    throw new Error("Invalid chat metadata")
  return JSON.stringify({ ...base, nativeActions: nativeActions.slice(0, 10) })
}

/** A stored card is a proposal. Rebind it to the current actor scope before showing it. */
export function parseNativeChatActions(
  metadata: string | null | undefined,
  scope: AssistantActionScope | null,
): ChatAction[] {
  if (!metadata || !scope) return []
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return []
    const entries = (parsed as { nativeActions?: unknown }).nativeActions
    if (!Array.isArray(entries) || entries.length > 10) return []
    const seen = new Set<string>()
    return entries.flatMap((value) => {
      const action = decodeAssistantAction(value, scope)
      if (!action) return []
      const card = nativeChatAction(action)
      if (seen.has(card.id)) return []
      seen.add(card.id)
      return [card]
    })
  } catch {
    return []
  }
}

/** Link only a known saved widget identity. The page host checks its current layout and permission. */
export function assistantSavedWidgetHref(action: AssistantAction, companyId: number): string | undefined {
  if (action.kind !== "add_widget" || action.scope.companyId !== String(companyId)
    || !action.widgetKey?.startsWith("saved:") || !parseAssistantWidgetKey(action.widgetKey)) return undefined
  const href = assistantActionHref(action)
  if (!href) return undefined
  const url = new URL(href, "https://lumiere.invalid")
  url.searchParams.set("savedWidget", action.widgetKey.slice("saved:".length))
  url.searchParams.set("savedWidgetCompany", String(companyId))
  return url.pathname + url.search
}
