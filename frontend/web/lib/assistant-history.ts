export type AssistantHistoryResult = "saved" | "failed" | "scope-changed"

/** Never assign an old browser-wide conversation key to a different actor or company. */
export function assistantHistoryScope(identity: string | null, organizationId: number | undefined, companyId: number | null): string | null {
  if (!identity || !Number.isSafeInteger(organizationId) || !organizationId || organizationId < 1
    || !Number.isSafeInteger(companyId) || !companyId || companyId < 1) return null
  return [identity, organizationId, companyId].map((part) => encodeURIComponent(String(part))).join(":")
}

export function scopedAssistantSession(storage: Pick<Storage, "getItem" | "setItem">, scope: string, createKey: () => string): string {
  const storageKey = `lumiere:erp-ai-chat-session-key:v2:${scope}`
  const existing = storage.getItem(storageKey)
  if (existing && /^[a-zA-Z0-9_-]{1,150}$/.test(existing)) return existing
  const next = createKey()
  storage.setItem(storageKey, next)
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
