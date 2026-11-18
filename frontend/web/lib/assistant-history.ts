import { WITHHELD_VERIFICATION_OUTCOMES, isWithheldAnswerNotice } from "@lumiere/erp-shared/ai-withheld-notice"

export type AssistantHistoryResult = "saved" | "failed" | "scope-changed"

function assistantSessionStorageKey(scope: string) {
  return `lumiere:erp-ai-chat-session-key:v2:${scope}`
}

export function rememberAssistantSession(storage: Pick<Storage, "setItem">, scope: string, sessionKey: string) {
  storage.setItem(assistantSessionStorageKey(scope), sessionKey)
}

/** Never assign an old browser-wide conversation key to a different actor or company. */
export function assistantHistoryScope(identity: string | null, organizationId: number | undefined, companyId: number | null): string | null {
  if (!identity || !Number.isSafeInteger(organizationId) || !organizationId || organizationId < 1
    || !Number.isSafeInteger(companyId) || !companyId || companyId < 1) return null
  return [identity, organizationId, companyId].map((part) => encodeURIComponent(String(part))).join(":")
}

export function scopedAssistantSession(storage: Pick<Storage, "getItem" | "setItem">, scope: string, createKey: () => string): string {
  const existing = storage.getItem(assistantSessionStorageKey(scope))
  if (existing && /^[a-zA-Z0-9_-]{1,150}$/.test(existing)) return existing
  const next = createKey()
  rememberAssistantSession(storage, scope, next)
  return next
}

/** A history failure must not discard the answer or replay a partially saved exchange. */
export async function saveAssistantHistory({ ensureSession, appendUser, appendAssistant, isCurrent }: {
  ensureSession: () => Promise<void>
  appendUser: () => Promise<void>
  appendAssistant: () => Promise<void>
  isCurrent: () => boolean
}): Promise<AssistantHistoryResult> {
  try {
    if (!isCurrent()) return "scope-changed"
    await ensureSession()
    if (!isCurrent()) return "scope-changed"
    await appendUser()
    if (!isCurrent()) return "scope-changed"
    await appendAssistant()
    return isCurrent() ? "saved" : "scope-changed"
  } catch {
    return isCurrent() ? "failed" : "scope-changed"
  }
}

type HistoryRow = { role?: string; content?: unknown; status?: string; metadata?: string | null }

/**
 * Answers withheld by the gate before #442 were saved as completed. History is
 * append-only, so a withheld notice or a saved blocked/requires_review verdict
 * reads as failed. Mirrors `reclassify_withheld_message` in stdb-client.
 */
export function reclassifyWithheldHistoryRow<T extends HistoryRow>(row: T): T {
  if (row.role !== undefined && row.role !== "assistant") return row
  if (row.status === "failed") return row
  let blocked = false
  if (typeof row.metadata === "string") {
    try {
      const metadata = JSON.parse(row.metadata) as Record<string, { outcome?: unknown } | null> | null
      blocked = ["answerVerification", "verification"].some(key => {
        const outcome = metadata?.[key]?.outcome
        return (WITHHELD_VERIFICATION_OUTCOMES as readonly unknown[]).includes(outcome)
      })
    } catch { /* Unreadable metadata cannot establish a withheld verdict. */ }
  }
  return blocked || isWithheldAnswerNotice(row.content) ? { ...row, status: "failed" } : row
}
