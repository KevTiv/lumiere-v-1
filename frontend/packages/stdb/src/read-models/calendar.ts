/** Loose row shape from `/api/query/calendar-events`. */
export type CalendarEventQueryRow = Record<string, unknown>;

/** Primary label for calendar event rows. */
export function calendarEventPrimaryLabel(row: CalendarEventQueryRow): string {
  return primaryLabel([row.name, row.title], row.id);
}
import { primaryLabel } from "./primary-label";
