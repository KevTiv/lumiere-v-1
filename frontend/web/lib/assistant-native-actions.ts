import {
  decodeAssistantAction,
  getAssistantCapability,
  parseAssistantActionId,
  ASSISTANT_PROMPT_LIMIT,
  type AssistantAction,
  type AssistantActionResolution,
  type AssistantActionScope,
} from "@lumiere/query-hooks/assistant-actions"
import type {
  ChatAction,
  ChatMessageSourceRef,
} from "@lumiere/ui/lib/ai-chat-types"

type Translate = (key: string) => string

export function nativeChatAction(action: AssistantAction): ChatAction {
  const validated = decodeAssistantAction(action, action.scope)
  const capability =
    validated && getAssistantCapability(validated.capabilityKey)
  if (!validated || !capability)
    throw new Error("Unknown assistant destination")
  return {
    id: `native:${validated.capabilityKey}:${validated.recordId ?? "new"}`,
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
        ? t(
            resolution.action.kind === "open_form"
              ? "aiChat.native.formReady"
              : resolution.action.kind === "prepare_workflow"
                ? "aiChat.native.workflowReady"
                : "aiChat.native.destinationReady",
          )
        : t(`aiChat.native.clarify.${resolution.reason}`),
    sources: [] as ChatMessageSourceRef[],
    actions,
  }
}

export interface AssistantUiProposal {
  capability_key: string
  record_id?: string
}

/** Invalid optional UI metadata cannot turn a verified answer into an executable action. */
export function parseAssistantUiProposals(
  value: unknown,
): AssistantUiProposal[] {
  if (!Array.isArray(value) || value.length > 5) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const raw = item as { capability_key?: unknown; record_id?: unknown }
    if (
      Object.keys(item).some(
        (key) => !["capability_key", "record_id"].includes(key),
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
    const key = `${capability.key}:${raw.record_id ?? "new"}`
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        capability_key: raw.capability_key,
        ...(typeof raw.record_id === "string"
          ? { record_id: raw.record_id }
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
): ChatAction[] {
  const seen = new Set<string>()
  return parseAssistantUiProposals(proposals).flatMap((proposal) => {
    const capability = getAssistantCapability(proposal.capability_key)
    if (!capability) return []
    const action = decodeAssistantAction(
      {
        version: 1,
        kind: capability.kind,
        capabilityKey: capability.key,
        scope,
        ...(proposal.record_id ? { recordId: proposal.record_id } : {}),
        ...((capability.kind === "open_form" ||
          capability.kind === "prepare_workflow") &&
        userText.trim() &&
        userText.trim().length <= ASSISTANT_PROMPT_LIMIT
          ? { prompt: userText.trim() }
          : {}),
      },
      scope,
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
