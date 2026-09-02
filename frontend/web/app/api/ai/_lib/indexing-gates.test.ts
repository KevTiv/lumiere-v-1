import assert from 'node:assert/strict'
import test from 'node:test'

import { deferredIndexingResponse } from './indexing-gates'

test('activity and document indexing remain fail-closed', () => {
  const activity = deferredIndexingResponse('activity')
  const document = deferredIndexingResponse('document')

  assert.equal(activity.status, 503)
  assert.equal(document.status, 503)
  assert.match(activity.body.error, /authorized indexing projection/)
  assert.match(document.body.error, /FileVersion lifecycle/)
})
