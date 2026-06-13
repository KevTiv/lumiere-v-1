import type { GatewayActionDraft, PersistedActionDraft } from "./hooks/ai-action-drafts"

export type ActionDraftChatAction = {
  id: string
  type: "draft"
  label: string
  draft: {
    draftId: number
    reducerName: string
    summary: string
    paramsJson: Record<string, unknown>
    confidence: number
    warnings: string[]
    elevated: boolean
    status?: "pending" | "approved" | "rejected" | "failed"
    executionError?: string | null
    executionRecordId?: number | null
    companyId?: number
  }
}

/** Heuristic: user wants the assistant to propose an ERP mutation draft. */
export function looksLikeActionDraftRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/@create\b/i.test(trimmed)) return true
  return /\b(create|add|draft|schedule|open|new)\b[\s\S]{0,40}\b(task|todo|order|purchase|quote|sale)\b/i.test(
    trimmed,
  )
}

export function persistedDraftsToChatActions(
  persisted: PersistedActionDraft[],
  companyId?: number,
): ActionDraftChatAction[] {
  return persisted.map(({ gateway, draftId }) => ({
    id: `draft-${draftId}`,
    type: "draft" as const,
    label: gateway.summary,
    draft: gatewayDraftToPayload(gateway, draftId, companyId),
  }))
}

export function gatewayDraftToPayload(
  gateway: GatewayActionDraft,
  draftId: number,
  companyId?: number,
): ActionDraftChatAction["draft"] {
  return {
    draftId,
    reducerName: gateway.reducer_name,
    summary: gateway.summary,
    paramsJson: gateway.params_json,
    confidence: gateway.confidence,
    warnings: gateway.warnings,
    elevated: gateway.elevated,
    status: "pending",
    companyId,
  }
}

/** Restore draft cards from persisted assistant message metadata. */
export function parseStoredChatActions(metadata?: string | null): ActionDraftChatAction[] | undefined {
  if (!metadata?.trim()) return undefined
  try {
    const parsed = JSON.parse(metadata) as { actions?: ActionDraftChatAction[] }
    if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) return undefined
    return parsed.actions.filter(
      (action) => action?.type === "draft" && action.draft?.draftId != null,
    )
  } catch {
    return undefined
  }
}

export function chatActionsToMetadata(actions: ActionDraftChatAction[]): string {
  return JSON.stringify({ actions })
}
