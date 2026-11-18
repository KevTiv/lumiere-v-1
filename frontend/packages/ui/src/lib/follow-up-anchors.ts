import type { ChatMessageSourceRef } from "./ai-chat-types"

/**
 * Records the gateway reached through the previous answer's follow-up anchors.
 * Only sources freshly read this turn can carry the flag, so this lists what
 * the answer actually used, never a remembered or unread record.
 */
export function followUpAnchorLabels(
  sources: readonly ChatMessageSourceRef[] | undefined,
  max = 2,
): { labels: string[]; more: number } {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const source of sources ?? []) {
    if (source.kind !== "live" || source.from_anchor !== true) continue
    const label = (source.label ?? `${source.entity_type ?? "record"} #${source.entity_id ?? ""}`).trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    labels.push(label)
  }
  return { labels: labels.slice(0, max), more: Math.max(0, labels.length - max) }
}
