import { variantTag } from '@lumiere/erp-workflows';

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
  return new Date(eventMicros(value) / 1000).toISOString().slice(0, 16);
}

/**
 * Parameters for `update_calendar_event` from the edit form; null when the title is empty or a
 * date does not parse. The event keeps `state` (confirmed by default, as the list's edit does).
 */
export function updateCalendarEventParams(formData: Row, state = 'confirmed'): Row | null {
  const name = String(formData.name ?? '').trim();
  const start = new Date(String(formData.start ?? ''));
  const stop = new Date(String(formData.stop ?? ''));
  if (!name || Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) return null;
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
export function eventStateTag(event: Row): string {
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
