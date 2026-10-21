type Row = Record<string, unknown>

export interface BellNotification {
  id: string
  /** Body with markup removed, shortened. */
  title: string
  dateMs: number
  model: string
  resId: string
}

export const BELL_NOTIFICATION_LIMIT = 10

function tagOf(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && "tag" in value) return String((value as { tag: unknown }).tag).toLowerCase()
  return ""
}

function identityKey(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") {
    const v = value as { __identity__?: unknown; toHexString?: () => string; toHex?: () => unknown }
    if (v.__identity__ !== undefined) return identityKey(v.__identity__)
    if (typeof v.toHexString === "function") return v.toHexString().toLowerCase()
    if (typeof v.toHex === "function") return String(v.toHex()).toLowerCase()
    return ""
  }
  return String(value).trim().toLowerCase().replace(/^0x/, "")
}

function dateMs(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "object") {
    return "microsSinceUnixEpoch" in value ? dateMs((value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch) : 0
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isNaN(Number(value))) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const micros = Number(value)
  return Number.isFinite(micros) ? micros / 1000 : 0
}

function recipientOf(metadata: unknown): string {
  if (metadata == null || metadata === "") return ""
  try {
    const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata
    return parsed && typeof parsed === "object" && "recipient" in parsed
      ? identityKey((parsed as { recipient: unknown }).recipient)
      : ""
  } catch {
    return ""
  }
}

function isRead(metadata: unknown): boolean {
  if (metadata == null || metadata === "") return false
  try {
    const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        "read_at" in parsed &&
        (parsed as { read_at: unknown }).read_at != null,
    )
  } catch {
    return false
  }
}

function titleOf(body: unknown, max = 90): string {
  const text = String(body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The signed-in user's most recent notifications, newest first. A notification is a mail message
 * of type Notification whose `metadata.recipient` is the user (the backend writes one per follower).
 * The reducer records `metadata.read_at`; only unread notifications are returned.
 */
export function recentNotifications(
  messages: ReadonlyArray<Row>,
  identity: string | null | undefined,
  limit: number = BELL_NOTIFICATION_LIMIT,
): BellNotification[] {
  const me = identityKey(identity)
  if (!me) return []
  return messages
    .filter((m) => {
      const type = tagOf(m.messageType ?? m.message_type)
      return (
        (type === "notification" || type === "user_notification") &&
        recipientOf(m.metadata) === me &&
        !isRead(m.metadata)
      )
    })
    .map((m) => ({
      id: String(m.id),
      title: titleOf(m.body),
      dateMs: dateMs(m.date),
      model: String(m.model ?? ""),
      resId: String(m.resId ?? m.res_id ?? ""),
    }))
    .sort((a, b) => b.dateMs - a.dateMs || Number(b.id) - Number(a.id))
    .slice(0, limit)
}
