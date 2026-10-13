import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RECORD_STANDARD_ACTIONS,
  archiveAction,
  archiveTargetActive,
  duplicateName,
  type RecordModel,
} from './record-standard-actions'

test('projects can be archived and unarchived by their active flag', () => {
  assert.equal(archiveAction('projects', { active: true }), 'archive')
  assert.equal(archiveAction('projects', {}), 'archive')
  assert.equal(archiveAction('projects', { active: false }), 'unarchive')
  assert.equal(archiveTargetActive('archive'), false)
  assert.equal(archiveTargetActive('unarchive'), true)
})

test('models without an archive command get no archive action', () => {
  assert.equal(archiveAction('calendar.events', { active: true }), null)
  assert.equal(archiveAction('fleet.vehicles', {}), null)
})

test('duplicate names carry the suffix; unsupported models give nothing', () => {
  assert.equal(duplicateName('projects', ' Alpha '), 'Alpha (copy)')
  assert.equal(duplicateName('calendar.events', undefined), ' (copy)')
  assert.equal(duplicateName('fleet.vehicles', 'Van'), '')
})

test('every model either has an action or says why it has none', () => {
  for (const [model, entry] of Object.entries(RECORD_STANDARD_ACTIONS) as Array<[RecordModel, (typeof RECORD_STANDARD_ACTIONS)[RecordModel]]>) {
    if (!entry.archive) assert.ok(entry.gaps?.archive, `${model} archive gap`)
    if (!entry.duplicate) assert.ok(entry.gaps?.duplicate, `${model} duplicate gap`)
  }
  assert.equal(Object.keys(RECORD_STANDARD_ACTIONS).length, 13)
})
