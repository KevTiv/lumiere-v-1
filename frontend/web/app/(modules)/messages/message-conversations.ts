import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { formatTimestampLike } from "@lumiere/ui/lib/entity-row-values"
import { messageKind, messageTitle, optionalId } from "./message-record"

/** Fields supplied by the existing authorized mail-message projection. */
export type MessageRow = {
  id?: unknown
  model?: unknown
  resId?: unknown
  res_id?: unknown
  parentId?: unknown
  parent_id?: unknown
  body?: unknown
  date?: unknown
  messageType?: unknown
  message_type?: unknown
  metadata?: unknown
  authorId?: unknown
  author_id?: unknown
}

export type MessageConversation = {
  id: string
  root: MessageRow
  messages: MessageRow[]
  latest: MessageRow
}

export function messageSource(
  row: MessageRow,
): { model: string; resId: string } | null {
  const model = typeof row.model === "string" ? row.model.trim() : ""
  const id = parseStrictU64(row.resId ?? row.res_id)
  return model && id != null && id > 0n ? { model, resId: id.toString() } : null
}

export function sameMessageSource(a: MessageRow, b: MessageRow): boolean {
  const source = messageSource(a),
    other = messageSource(b)
  return (
    source != null &&
    other != null &&
    source.model === other.model &&
    source.resId === other.resId
  )
}

export function messageDate(row: MessageRow): number | null {
  return formatTimestampLike(row.date)?.getTime() ?? null
}

/** Parent edges join only visible rows on the exact same canonical source. */
export function messageConversations(
  rows: readonly MessageRow[],
): MessageConversation[] {
  const counts = new Map<string, number>()
  for (const row of rows)
    counts.set(String(row.id), (counts.get(String(row.id)) ?? 0) + 1)
  const unique = rows.filter(
    (row) => parseStrictU64(row.id) != null && counts.get(String(row.id)) === 1,
  )
  const byId = new Map(unique.map((row) => [String(row.id), row]))
  const rootOf = (row: MessageRow): MessageRow => {
    const visited = new Set<string>()
    let current = row
    while (true) {
      const id = String(current.id)
      if (visited.has(id)) return row // Invalid cycles stay separate, with no invented root.
      visited.add(id)
      const parentId = optionalId(current.parentId ?? current.parent_id)
      const parent = parentId ? byId.get(parentId) : undefined
      if (!parent || !sameMessageSource(current, parent)) return current
      current = parent
    }
  }
  const conversations = new Map<string, MessageConversation>()
  for (const row of unique) {
    const root = rootOf(row),
      id = String(root.id)
    const conversation = conversations.get(id)
    if (conversation) conversation.messages.push(row)
    else conversations.set(id, { id, root, messages: [row], latest: row })
  }
  for (const conversation of conversations.values()) {
    conversation.messages.sort(
      (a, b) =>
        (messageDate(a) ?? 0) - (messageDate(b) ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
    conversation.latest = conversation.messages.at(-1)!
  }
  return [...conversations.values()].sort(
    (a, b) =>
      (messageDate(b.latest) ?? 0) - (messageDate(a.latest) ?? 0) ||
      a.id.localeCompare(b.id),
  )
}

export function matchingConversations(
  conversations: readonly MessageConversation[],
  search: string,
): MessageConversation[] {
  const query = search.trim().toLocaleLowerCase()
  return query
    ? conversations.filter((thread) =>
        thread.messages.some((row) =>
          messageTitle(row, Number.MAX_SAFE_INTEGER)
            .toLocaleLowerCase()
            .includes(query),
        ),
      )
    : [...conversations]
}

function metadataObject(
  raw: unknown,
): { recipient?: unknown; read_at?: unknown } | null {
  if (raw && typeof raw === "object" && "some" in raw)
    return metadataObject(raw.some)
  try {
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    return value != null && typeof value === "object" && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

export function notificationRecipient(row: MessageRow): string | null {
  const recipient = metadataObject(row.metadata)?.recipient
  return typeof recipient === "string"
    ? recipient.trim().toLowerCase().replace(/^0x/, "")
    : null
}

export function isNotificationMessage(row: MessageRow): boolean {
  const kind = messageKind(row).replace(/_/g, "")
  return kind === "notification" || kind === "usernotification"
}

/** Only Notification rows have this owner-backed read marker. */
export function isNotificationRead(row: MessageRow): boolean {
  const metadata = metadataObject(row.metadata)
  return isNotificationMessage(row) && metadata?.read_at != null
}
