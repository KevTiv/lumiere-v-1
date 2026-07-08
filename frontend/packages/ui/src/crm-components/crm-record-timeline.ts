export type TimelineMessageEntry = {
  kind: "message"
  id: string
  sortKey: number
  messageType: string
  body: string
}

export type TimelineActivityEntry = {
  kind: "activity"
  id: bigint
  sortKey: number
  activityType: string
  summary: string
  note: string | null
  isDone: boolean
  dateDeadline: unknown
}

export type TimelineEntry = TimelineMessageEntry | TimelineActivityEntry

export function timestampMicros(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "object" && value !== null && "microsSinceUnixEpoch" in value) {
    const micros = (value as { microsSinceUnixEpoch: bigint | number }).microsSinceUnixEpoch
    return Number(micros)
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function formatTimelineDate(value: unknown): string {
  const micros = timestampMicros(value)
  if (!micros) return ""
  try {
    return new Date(micros / 1000).toLocaleString()
  } catch {
    return ""
  }
}

export function mergeRecordTimeline(
  messages: Array<{
    id: bigint
    body: string
    messageType: unknown
    date: unknown
  }>,
  activities: Array<{
    id: bigint
    summary: string
    note: string | null | undefined
    activityType: string
    isDone: boolean
    createdAt: unknown
    dateDeadline: unknown
  }>,
): TimelineEntry[] {
  const merged: TimelineEntry[] = [
    ...messages.map((m) => ({
      kind: "message" as const,
      id: `msg-${m.id.toString()}`,
      sortKey: timestampMicros(m.date),
      messageType: String(m.messageType ?? "message"),
      body: m.body,
    })),
    ...activities.map((a) => ({
      kind: "activity" as const,
      id: a.id,
      sortKey: timestampMicros(a.createdAt) || timestampMicros(a.dateDeadline),
      activityType: a.activityType,
      summary: a.summary,
      note: a.note ?? null,
      isDone: a.isDone,
      dateDeadline: a.dateDeadline,
    })),
  ]
  return merged.sort((a, b) => b.sortKey - a.sortKey)
}
