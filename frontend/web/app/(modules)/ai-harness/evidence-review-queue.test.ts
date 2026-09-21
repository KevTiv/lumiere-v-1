import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReviewRequest, mapReviewQueue, shortIdentity } from './evidence-review-queue'

const ME = 'a'.repeat(64)
const HASH = 'b'.repeat(64)

test('maps the queue with creators, proposers, sources and affected workflow steps', () => {
  const view = mapReviewQueue({
    claims: [{
      id: 8,
      kind: 'sourced_fact',
      statement: 'Refunds above 731 EUR need sign-off.',
      status: 'current',
      queueReason: 'awaiting_human_review',
      verificationMethod: 'model_assisted',
      verificationOutcome: 'supported',
      verificationNote: 'model-assisted check (not domain approval)',
      passages: [{ id: 9, availability: 'available', status: 'current', sourceTitle: 'Refund policy' }],
      creatorUid: ME,
      proposerUid: 'c'.repeat(64),
      proposerKind: 'agent',
      reviewableByViewer: true,
      affectedComponents: [{ id: 3, workflowVersionId: 42, nodeKey: 'review', linkState: 'linked' }],
    }],
    decisions: [{ id: 4, title: 'Adopt', status: 'proposed', adoptedClaimIds: [8], creatorUid: ME, reviewableByViewer: false }],
    components: [{ id: 3, workflowVersionId: 42, nodeKey: 'review', linkState: 'changed', version: 2, contentHash: HASH, decisionIds: [4], claimIds: [8] }],
    claimsTruncated: true,
  })

  assert.ok(view)
  assert.equal(view.claims[0]?.passages[0]?.sourceTitle, 'Refund policy')
  assert.equal(view.claims[0]?.affectedComponents[0]?.nodeKey, 'review')
  assert.equal(view.claims[0]?.reviewableByViewer, true)
  assert.equal(view.decisions[0]?.reviewableByViewer, false)
  assert.equal(view.components[0]?.contentHash, HASH)
  assert.equal(view.claimsTruncated, true)
  assert.equal(shortIdentity(view.claims[0]?.creatorUid ?? null), 'aaaaaaaa…')
})

test('never surfaces a source title or status for a passage the reviewer cannot see', () => {
  for (const availability of ['restricted', 'tombstoned', 'out_of_scope', 'missing']) {
    const view = mapReviewQueue({
      claims: [{ id: 8, passages: [{ id: 9, availability, status: 'current', sourceTitle: 'must not leak' }] }],
    })
    assert.deepEqual(view?.claims[0]?.passages[0], {
      id: 9,
      availability,
      status: null,
      sourceTitle: null,
    })
  }
})

test('defaults to not reviewable and drops malformed identities, ids and components', () => {
  const view = mapReviewQueue({
    claims: [
      { id: 1, creatorUid: 'not-an-identity', proposerUid: 'ABCD' },
      { id: 0 },
      { id: '2' },
    ],
    decisions: [{ id: 3 }],
    // A component with no exact hash cannot be confirmed against what was reviewed.
    components: [{ id: 5, contentHash: 'short', linkState: 'changed' }, { id: 6, contentHash: HASH, linkState: 'changed' }],
  })
  assert.ok(view)
  assert.equal(view.claims.length, 1)
  assert.equal(view.claims[0]?.reviewableByViewer, false)
  assert.equal(view.claims[0]?.creatorUid, null)
  assert.equal(view.claims[0]?.proposerUid, null)
  assert.equal(view.decisions[0]?.reviewableByViewer, false)
  assert.deepEqual(view.components.map((component) => component.id), [6])
})

test('bounds the queue and rejects malformed envelopes', () => {
  const claims = Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }))
  assert.equal(mapReviewQueue({ claims })?.claims.length, 50)
  assert.equal(mapReviewQueue(null), null)
  assert.equal(mapReviewQueue([]), null)
  assert.equal(mapReviewQueue('queue'), null)
})

test('a verdict request carries only company intent, target, verdict and note', () => {
  const claim = buildReviewRequest(9, { kind: 'claim', id: 8, outcome: 'supported' }, '  checked ')
  assert.deepEqual(claim, { companyId: 9, kind: 'claim', id: 8, outcome: 'supported', note: 'checked' })
  assert.deepEqual(Object.keys(claim ?? {}).sort(), ['companyId', 'id', 'kind', 'note', 'outcome'])

  const decision = buildReviewRequest(9, { kind: 'decision', id: 4, outcome: 'accepted' }, '')
  assert.equal(decision?.note, null)
})

test('a qualified verdict needs its qualification and a confirmation needs the exact hash', () => {
  assert.equal(buildReviewRequest(9, { kind: 'claim', id: 8, outcome: 'qualified' }, '  '), null)
  assert.ok(buildReviewRequest(9, { kind: 'claim', id: 8, outcome: 'qualified' }, 'EU only'))

  assert.equal(buildReviewRequest(9, { kind: 'component', id: 3, outcome: 'confirmed' }, ''), null)
  assert.equal(
    buildReviewRequest(9, { kind: 'component', id: 3, outcome: 'confirmed', expectedContentHash: 'nothex' }, ''),
    null,
  )
  const confirmed = buildReviewRequest(
    9,
    { kind: 'component', id: 3, outcome: 'confirmed', expectedContentHash: HASH },
    'reviewed the edit',
  )
  assert.equal(confirmed?.expectedContentHash, HASH)
  // Marking unresolved binds nothing.
  const unresolved = buildReviewRequest(9, { kind: 'component', id: 3, outcome: 'unresolved' }, '')
  assert.equal('expectedContentHash' in (unresolved ?? {}), false)
})

test('an invalid company or target builds no request', () => {
  assert.equal(buildReviewRequest(0, { kind: 'claim', id: 8, outcome: 'supported' }, ''), null)
  assert.equal(buildReviewRequest(9, { kind: 'claim', id: 0, outcome: 'supported' }, ''), null)
  assert.equal(buildReviewRequest(Number.NaN, { kind: 'claim', id: 8, outcome: 'supported' }, ''), null)
})
