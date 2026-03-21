import CalendarEventRow from "../generated/calendar_event_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type CalendarEvent = Infer<typeof CalendarEventRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function calendarSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM calendar_event WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryCalendarEvents(): CalendarEvent[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.calendar_event.iter()].sort(
    (a, b) => Number(a.start ?? 0) - Number(b.start ?? 0),
  );
}
