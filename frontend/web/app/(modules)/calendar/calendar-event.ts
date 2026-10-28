import { variantTag } from '@lumiere/erp-workflows';
import type { CalendarEvent } from '@lumiere/ui/lib/calendar-types';

type Row = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Where a calendar event's page lives. */
export function calendarEventHref(event: Row): string | undefined {
  return event.id == null ? undefined : `/calendar/events/${String(event.id)}`;
}

/** Microseconds since the epoch of a timestamp cell (`{ microsSinceUnixEpoch }`, micros or a bigint). */
export function eventMicros(value: unknown): number {
  const raw =
    value && typeof value === 'object' && 'microsSinceUnixEpoch' in value
      ? (value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch
      : value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** `datetime-local` text of a timestamp cell, for form defaults. */
export function eventInputValue(value: unknown): string {
  const date = new Date(eventMicros(value) / 1000);
  // datetime-local is read back as local time by the form mapper. Using UTC here
  // changes the saved instant when the browser timezone is not UTC.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Authorized event projection for the calendar; invalid ranges are not epoch-zero events. */
export function calendarEventForView(event: {
  id?: unknown; name?: unknown; start?: unknown; stop?: unknown;
  description?: unknown; allday?: unknown; state?: unknown;
  privacy?: unknown; location?: unknown;
}): CalendarEvent | null {
  if (event.id == null || event.start == null || event.stop == null) return null;
  const timestampIsValid = (value: unknown) => {
    const micros = value && typeof value === 'object' && 'microsSinceUnixEpoch' in value ? value.microsSinceUnixEpoch : value;
    return micros != null && micros !== '' && Number.isFinite(Number(micros));
  };
  if (!timestampIsValid(event.start) || !timestampIsValid(event.stop)) return null;
  const startTime = new Date(eventMicros(event.start) / 1000);
  const endTime = new Date(eventMicros(event.stop) / 1000);
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || endTime < startTime) return null;
  const state = eventStateTag(event);
  const privacy = variantTag(event.privacy).toLowerCase();
  return {
    id: String(event.id),
    title: String(event.name ?? ''),
    description: event.description ? String(event.description) : undefined,
    startTime,
    endTime,
    allDay: event.allday === true,
    type: 'meeting',
    status: state === 'cancelled' || state === 'cancel' ? 'cancelled' : state === 'confirmed' ? 'confirmed' : state === 'completed' ? 'completed' : 'scheduled',
    createdBy: '',
    attendees: [],
    location: event.location ? String(event.location) : undefined,
    // Confidential rows must never be advertised as public.
    visibility: privacy === 'private' || privacy === 'confidential' ? 'private' : 'public',
  };
}

/** A return link is always local to this workspace and never an arbitrary URL. */
export function calendarReturnHref(value: string | null): string {
  if (!value || !/^\/calendar(?:\?|$)/.test(value) || /[\r\n\\]/.test(value)) return '/calendar?tab=calendar';
  return value;
}

/**
 * Parameters for `update_calendar_event` from the edit form; null when the title is empty or a
 * date does not parse. The event keeps `state` (confirmed by default, as the list's edit does).
 */
export function updateCalendarEventParams(formData: Row, state = 'confirmed'): Row | null {
  const name = String(formData.name ?? '').trim();
  const start = new Date(String(formData.start ?? ''));
  const stop = new Date(String(formData.stop ?? ''));
  if (!name || Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime()) || stop.getTime() < start.getTime()) return null;
  return {
    name,
    start: BigInt(start.getTime() * 1000),
    stop: BigInt(stop.getTime() * 1000),
    allday: Boolean(formData.allday),
    privacy: (formData.privacy as string) ?? 'public',
    show_as: 'busy',
    state,
    location: formData.location ? String(formData.location) : undefined,
    description: formData.description ? String(formData.description) : undefined,
  };
}

/** draft → confirmed on the status bar; a cancelled event is shown outside the flow. */
export function eventStatusBar(
  event: Row,
  t: Translate,
): { steps: Array<{ id: string; label: string }>; current: string; terminal?: { label: string } } {
  const state = variantTag(event.state).toLowerCase();
  const steps = [
    { id: 'draft', label: t('calendar.events.filters.stateOptions.draft', { defaultValue: 'Draft' }) },
    { id: 'confirmed', label: t('calendar.events.filters.stateOptions.confirmed', { defaultValue: 'Confirmed' }) },
  ];
  if (state === 'cancelled' || state === 'cancel') {
    return {
      steps,
      current: '',
      terminal: { label: t('calendar.events.filters.stateOptions.cancelled', { defaultValue: 'Cancelled' }) },
    };
  }
  return { steps, current: state };
}

/** Lower-cased state of an event row (`draft`, `confirmed`, `cancelled`, ...), or ''. */
export function eventStateTag(event: { state?: unknown }): string {
  return variantTag(event.state).toLowerCase();
}

/** Which state changes the page offers: confirm unless confirmed, cancel unless cancelled. */
export function eventStateActions(event: Row): { confirm: boolean; cancel: boolean } {
  const state = eventStateTag(event);
  const cancelled = state === 'cancelled' || state === 'cancel';
  return { confirm: state !== 'confirmed', cancel: !cancelled };
}

/** Parameters for a state-only `update_calendar_event` (every other field is optional). */
export function eventStateParams(state: 'confirmed' | 'cancelled'): Row {
  return { state };
}

/** Attendee names of an event (`partner_ids` are contact ids); unknown ids read `#id`. */
export function eventAttendees(event: Row, contacts: ReadonlyArray<Row>): Array<{ id: string; label: string }> {
  const raw = event.partner_ids ?? event.partnerIds;
  if (!Array.isArray(raw)) return [];
  const names = new Map(contacts.map((c) => [String(c.id), String(c.display_name ?? c.displayName ?? c.name ?? '').trim()]));
  return raw.map((value) => {
    const id = String(value);
    return { id, label: names.get(id) || `#${id}` };
  });
}

/**
 * Parameters for a recurrence-only `update_calendar_event`. The reducer keeps the stored rule
 * when `rrule` / `rrule_type` are omitted (it cannot clear them), so empty text is left out.
 */
export function recurrenceParams(formData: Row): Row {
  const rrule = String(formData.rrule ?? '').trim();
  const rruleType = String(formData.rruleType ?? '').trim();
  return {
    recurrency: Boolean(formData.recurrency),
    ...(rrule ? { rrule } : {}),
    ...(rruleType ? { rrule_type: rruleType } : {}),
  };
}
