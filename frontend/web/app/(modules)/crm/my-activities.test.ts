import assert from 'node:assert/strict'
import test from 'node:test'

import { activityTargetHref, deadlineMs, identityKey, isOverdue, myOpenActivities } from './my-activities'

const ME = 'ab12'
const day = 86_400_000_000 // micros

test('identityKey reads hex strings and identity objects', () => {
  assert.equal(identityKey('0xAB12'), 'ab12')
  assert.equal(identityKey({ __identity__: 'AB12' }), 'ab12')
  assert.equal(identityKey({ toHexString: () => 'AB12' }), 'ab12')
  assert.equal(identityKey(null), '')
})

test('deadlineMs reads micros, timestamp objects and ISO strings', () => {
  assert.equal(deadlineMs(5000), 5)
  assert.equal(deadlineMs({ microsSinceUnixEpoch: 7000n }), 7)
  assert.equal(deadlineMs('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'))
  assert.equal(deadlineMs(null), null)
  assert.equal(deadlineMs(0), null)
})

test('myOpenActivities keeps open activities assigned to me (or mine and unassigned), by deadline', () => {
  const rows = [
    { id: 1, assignedTo: ME, dateDeadline: 3 * day },
    { id: 2, assignedTo: ME, dateDeadline: 1 * day },
    { id: 3, userId: ME, assignedTo: null, dateDeadline: 2 * day },
    { id: 4, userId: ME, assignedTo: 'ffff', dateDeadline: 1 * day },
    { id: 5, assignedTo: ME, isDone: true, dateDeadline: 1 * day },
    { id: 6, assignedTo: ME, state: 'done' },
    { id: 7, assignedTo: ME },
    { id: 8, assignedTo: 'other', userId: ME },
  ]
  assert.deepEqual(myOpenActivities(rows, ME).map((r) => r.id), [2, 3, 1, 7])
  assert.deepEqual(myOpenActivities(rows, undefined), [])
})

test('isOverdue only for past deadlines', () => {
  assert.equal(isOverdue({ dateDeadline: 1 * day }, 2 * day / 1000), true)
  assert.equal(isOverdue({ dateDeadline: 3 * day }, 2 * day / 1000), false)
  assert.equal(isOverdue({}, 2 * day / 1000), false)
})

test('activityTargetHref follows record-page-href', () => {
  assert.equal(activityTargetHref({ resModel: 'sale_order', resId: 4 }), '/sales/orders/4')
  assert.equal(activityTargetHref({ resModel: 'lead', resId: 4 }), undefined)
})
