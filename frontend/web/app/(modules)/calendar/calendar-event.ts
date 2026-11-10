import { variantTag } from '@lumiere/erp-workflows';
import { calendarEventFormRange, localCalendarDate } from '../../../lib/calendar-event-range';
import { zonedCalendarInput } from "@lumiere/erp-shared/calendar-timezone";
import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import { stbTimestampMicros } from '@lumiere/erp-shared/stb-timestamp';
import { unwrapSome } from '@lumiere/erp-shared/form-coercion';
import type { CalendarEvent } from '@lumiere/ui/lib/calendar-types';

type Row = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Keep the calendar's selected local date when starting a new event. */
export function calendarEventCreationDefaults(day: string): { start: string; stop: string } | undefined {
  return localCalendarDate(day) ? { start: `${day}T09:00`, stop: `${day}T10:00` } : undefined;
}

/** Where a calendar event's page lives. Return context is limited to the workspace. */
export function calendarEventHref(event: Row, returnTo?: string): string | undefined {
  const id = parseStrictU64(event.id);
  if (!id) return undefined;
  const href = `/calendar/events/${id}`;
  return returnTo ? `${href}?returnTo=${encodeURIComponent(calendarReturnHref(returnTo))}` : href;
}

export function eventText(value: unknown): string | undefined {
  const text = unwrapSome(value);
  return typeof text === 'string' && text.trim() ? text : undefined;
}

function exactEventMicros(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return stbTimestampMicros(value);
}

/** Microseconds since the epoch, for the existing edit and duplicate form defaults. */
export function eventMicros(value: unknown): number {
  return Number(exactEventMicros(value) ?? 0n);
}

function eventDate(value: unknown): Date | null {
  const micros = exactEventMicros(value);
  if (micros == null) return null;
  const date = new Date(Number(micros) / 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Shared event list/detail display in the active calendar timezone. */
export function eventTimestampLabel(value: unknown, locale?: string, timeZone?: string): string {
  return eventDate(value)?.toLocaleString(locale, { timeZone }) ?? '—';
}

/** All-day stop is an exclusive boundary; show the actual last occupied day. */
export function eventBoundaryLabel(event: Row, boundary: 'start' | 'stop', locale?: string, timeZone?: string): string {
  if (event.allday !== true) return eventTimestampLabel(event[boundary], locale, timeZone);
  const date = eventDate(event[boundary]);
  if (!date) return '—';
  const start = eventDate(event.start);
  const display = boundary === 'stop' && start && date > start ? new Date(date.getTime() - 1) : date;
  return display.toLocaleDateString(locale, { timeZone });
}

/** `datetime-local` text of a timestamp cell, for form defaults. */
export function eventInputValue(value: unknown, timeZone?: string): string {
  const date = eventDate(value);
  if (!date) return '';
  if (timeZone) return zonedCalendarInput(date, timeZone);
  // datetime-local is read back as local time by the form mapper. Using UTC here
  // changes the saved instant when the browser timezone is not UTC.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Authorized event projection for the calendar; invalid ranges are not epoch-zero events. */
export function calendarEventForView(event: Row, contacts: readonly Row[] = []): CalendarEvent | null {
  const id = parseStrictU64(event.id);
  const startTime = eventDate(event.start);
  const endTime = eventDate(event.stop);
  if (!id || !startTime || !endTime || endTime < startTime) return null;
  const state = eventStateTag(event);
  const privacy = variantTag(event.privacy).toLowerCase();
  return {
    id: String(id),
    title: eventText(event.name) ?? `#${id}`,
    description: eventText(event.description),
    startTime,
    endTime,
    allDay: event.allday === true,
    type: 'meeting',
    status: state === 'cancelled' || state === 'cancel' ? 'cancelled' : state === 'confirmed' ? 'confirmed' : state === 'completed' ? 'completed' : 'scheduled',
    createdBy: '',
    attendees: eventAttendees(event, contacts).map(({ label }) => label),
    location: eventText(event.location),
    // Confidential rows must never be advertised as public.
    visibility: privacy === 'private' || privacy === 'confidential' ? 'private' : 'public',
  };
}

/** A return link is always local to this workspace and never an arbitrary URL. */
export function calendarReturnHref(value: string | null, clearSelection = false): string {
  if (!value || !/^\/calendar(?:\?|$)/.test(value) || /[\r\n\\]/.test(value)) return '/calendar?tab=calendar';
  if (!clearSelection) return value;
  const params = new URLSearchParams(value.split('?')[1] ?? '');
  params.delete('calendarEvent');
  return params.size ? `/calendar?${params}` : '/calendar';
}

/**
 * Parameters for `update_calendar_event` from the edit form; null when the title is empty or a
 * date does not parse. The event keeps `state` (confirmed by default, as the list's edit does).
 */
export function updateCalendarEventParams(formData: Row, state = 'confirmed', timeZone?: string, originalEvent?: Row): Row | null {
  const name = String(formData.name ?? '').trim();
  const range = calendarEventFormRange(formData, { timeZone, originalStart: originalEvent?.start != null ? new Date(eventMicros(originalEvent.start) / 1000) : undefined, originalStop: originalEvent?.stop != null ? new Date(eventMicros(originalEvent.stop) / 1000) : undefined });
  if (!name || !range) return null;
  return {
    name,
    start: BigInt(range.start.getTime() * 1000),
    stop: BigInt(range.stop.getTime() * 1000),
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
  const names = new Map(contacts.map((contact) => [
    String(parseStrictU64(contact.id) ?? ''),
    (eventText(contact.display_name) ?? eventText(contact.displayName) ?? eventText(contact.name))?.trim(),
  ]));
  const ids = new Set(raw.map(parseStrictU64).filter((id): id is bigint => id != null && id > 0n));
  return [...ids].map((id) => ({ id: String(id), label: names.get(String(id)) || `#${id}` }));
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
