import assert from 'node:assert/strict'
import test from 'node:test'

import { mapEvidenceInspection } from './evidence-inspection'

test('maps reviewer lineage and bounds passage excerpts', () => {
  const view = mapEvidenceInspection({
    targetKind: 'decision',
    targetId: 4,
    lineagePasses: false,
    decisions: [{ id: 4, title: 'Use weighted average', rationale: 'Reason', status: 'accepted', adoptedClaimIds: [8] }],
    claims: [{ id: 8, kind: 'policy', statement: 'Claim', verificationMethod: 'human_reviewed', verificationOutcome: 'supported', status: 'accepted' }],
    passages: [{ id: 9, availability: 'available', excerpt: 'x'.repeat(1_200), excerptTruncated: false, coordinates: ['p:12'] }],
    sources: [{ id: 10, outOfScope: false, title: 'Inventory Practice', authors: ['A. Author'], authorAttribution: 'known', scope: 'organization' }],
    findings: [{ severity: 'blocking', code: 'dependency_changed', message: 'Review required' }],
  })

  assert.ok(view)
  assert.equal(view.passages[0]?.excerpt?.length, 1_000)
  assert.equal(view.passages[0]?.excerptTruncated, true)
  assert.equal(view.decisions[0]?.adoptedClaimIds[0], 8)
})

test('never maps metadata from an out-of-scope source', () => {
  const view = mapEvidenceInspection({
    targetKind: 'claim',
    targetId: 8,
    lineagePasses: false,
    sources: [{
      id: 10,
      outOfScope: true,
      title: 'must not leak',
      authors: ['must not leak'],
      authorAttribution: 'known',
      scope: 'company',
    }],
  })

  assert.ok(view)
  assert.deepEqual(view.sources[0], {
    id: 10,
    outOfScope: true,
    title: null,
    authors: [],
    authorAttribution: null,
    scope: null,
  })
})

test('never maps unavailable passage content or coordinates', () => {
  for (const availability of ['restricted', 'tombstoned', 'out_of_scope']) {
    const view = mapEvidenceInspection({
      targetKind: 'claim',
      targetId: 8,
      passages: [{
        id: 9,
        availability,
        excerpt: 'must not leak',
        excerptTruncated: true,
        coordinates: ['must not leak'],
      }],
    })

    assert.ok(view)
    assert.deepEqual(view.passages[0], {
      id: 9,
      availability,
      excerpt: null,
      excerptTruncated: false,
      coordinates: [],
    })
  }
})

test('rejects malformed inspection envelopes', () => {
  assert.equal(mapEvidenceInspection(null), null)
  assert.equal(mapEvidenceInspection({ targetId: 0 }), null)
  assert.equal(mapEvidenceInspection({ targetId: '4' }), null)
})
