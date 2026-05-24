/** Loose row shape from `/api/query/calendar-events`. */
export type CalendarEventQueryRow = Record<string, unknown>;

/** Primary label for calendar event rows. */
export function calendarEventPrimaryLabel(row: CalendarEventQueryRow): string {
  const candidates = [row.name, row.title];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
