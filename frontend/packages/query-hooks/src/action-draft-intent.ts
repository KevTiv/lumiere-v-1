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
    executionRecordId?: number | string | null
    executionRecordHref?: string
    companyId?: number
  }
}

/** Legacy draft opt-in. Native explicit requests are resolved by assistant-actions first. */
export function looksLikeActionDraftRequest(text: string): boolean {
  const trimmed = text.trim()
  return /^@create\s+(?:sales? order|purchase order)\b/i.test(trimmed)
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
    reducerName: gateway.reducerName,
    summary: gateway.summary,
    paramsJson: gateway.paramsJson,
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

export function parseStoredChatRunId(metadata?: string | null): number | undefined {
  if (!metadata?.trim()) return undefined
  try {
    const parsed = JSON.parse(metadata) as { runId?: unknown }
    return typeof parsed.runId === "number" && Number.isSafeInteger(parsed.runId) && parsed.runId > 0
      ? parsed.runId
      : undefined
  } catch {
    return undefined
  }
}

export function chatActionsToMetadata(
  actions: ActionDraftChatAction[],
  runId?: number,
): string {
  return JSON.stringify({
    ...(actions.length > 0 ? { actions } : {}),
    ...(runId != null && Number.isSafeInteger(runId) && runId > 0 ? { runId } : {}),
  })
}
