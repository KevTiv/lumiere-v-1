import assert from 'node:assert/strict';
import test from 'node:test';

import { calendarEventHref, eventInputValue, eventMicros, eventStatusBar, updateCalendarEventParams, eventStateActions, eventStateParams, eventAttendees, recurrenceParams } from './calendar-event';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

test('an event links to its own page by id', () => {
  assert.equal(calendarEventHref({ id: 12 }), '/calendar/events/12');
  assert.equal(calendarEventHref({}), undefined);
});

test('timestamps read from micros, a bigint or a wrapped cell', () => {
  assert.equal(eventMicros(1_000_000), 1_000_000);
  assert.equal(eventMicros(5n), 5);
  assert.equal(eventMicros({ microsSinceUnixEpoch: 7n }), 7);
  assert.equal(eventMicros(null), 0);
  assert.equal(eventInputValue(Date.UTC(2026, 9, 6, 14, 30) * 1000), '2026-10-06T14:30');
});

test('the edit form becomes update parameters, or nothing when it is incomplete', () => {
  const params = updateCalendarEventParams({
    name: ' Review ',
    start: '2026-10-06T09:00',
    stop: '2026-10-06T10:00',
    allday: false,
    privacy: 'private',
    location: 'Room 1',
  });

  assert.equal(params?.name, 'Review');
  assert.equal(typeof params?.start, 'bigint');
  assert.equal(params?.privacy, 'private');
  assert.equal(params?.location, 'Room 1');
  assert.equal(params?.description, undefined);
  assert.equal(updateCalendarEventParams({ name: '', start: '2026-10-06T09:00', stop: '2026-10-06T10:00' }), null);
  assert.equal(updateCalendarEventParams({ name: 'x', start: 'nope', stop: '2026-10-06T10:00' }), null);
});

test('status bar runs draft to confirmed, cancelled outside the flow', () => {
  assert.equal(eventStatusBar({ state: 'confirmed' }, t).current, 'confirmed');
  assert.equal(eventStatusBar({ state: { tag: 'draft' } }, t).current, 'draft');
  assert.equal(eventStatusBar({ state: 'cancelled' }, t).terminal?.label, 'Cancelled');
});

test('the edit keeps the given state', () => {
  const form = { name: 'x', start: '2026-10-06T09:00', stop: '2026-10-06T10:00' };

  assert.equal(updateCalendarEventParams(form)?.state, 'confirmed');
  assert.equal(updateCalendarEventParams(form, 'cancelled')?.state, 'cancelled');
});

test('confirm and cancel are offered by state', () => {
  assert.deepEqual(eventStateActions({ state: 'draft' }), { confirm: true, cancel: true });
  assert.deepEqual(eventStateActions({ state: 'confirmed' }), { confirm: false, cancel: true });
  assert.deepEqual(eventStateActions({ state: 'cancelled' }), { confirm: true, cancel: false });
  assert.deepEqual(eventStateParams('cancelled'), { state: 'cancelled' });
});

test('attendees resolve to contact names, else the id', () => {
  const attendees = eventAttendees({ partner_ids: [1n, 2] }, [{ id: 1, display_name: 'Ada' }]);

  assert.deepEqual(attendees, [{ id: '1', label: 'Ada' }, { id: '2', label: '#2' }]);
  assert.deepEqual(eventAttendees({}, []), []);
});

test('recurrenceParams leaves empty rule text out', () => {
  assert.deepEqual(recurrenceParams({ recurrency: true, rrule: ' FREQ=DAILY ', rruleType: '' }), { recurrency: true, rrule: 'FREQ=DAILY' });
  assert.deepEqual(recurrenceParams({ recurrency: false }), { recurrency: false });
});
