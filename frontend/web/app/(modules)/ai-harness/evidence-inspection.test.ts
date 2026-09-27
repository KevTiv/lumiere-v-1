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

test('maps a workflow step through its revisions to the reviewer of its claim', () => {
  const reviewer = 'd'.repeat(64)
  const view = mapEvidenceInspection({
    targetKind: 'component',
    targetId: 7,
    lineagePasses: true,
    revisions: [
      { id: 7, artifactRef: 'workflow-version:42', componentKey: 'node:review', version: 2, linkState: 'linked', status: 'current', contentHash: 'b'.repeat(64), parentComponentId: 4 },
      { id: 4, artifactRef: 'workflow-version:41', componentKey: 'node:review', version: 1, linkState: 'linked', status: 'superseded', contentHash: 'a'.repeat(64) },
    ],
    claims: [{ id: 8, kind: 'sourced_fact', statement: 'Claim', verificationMethod: 'human_reviewed', verificationOutcome: 'supported', status: 'current', reviewerUid: reviewer, reviewedAtMicros: 1_700_000_000_000_000 }],
    decisions: [{ id: 4, title: 'Adopt', rationale: 'Reason', status: 'accepted', adoptedClaimIds: [8] }],
    passages: [{ id: 9, availability: 'available', excerpt: 'text', excerptTruncated: false, coordinates: [] }],
  })

  assert.ok(view)
  assert.deepEqual(view.revisions.map((revision) => revision.id), [7, 4])
  assert.equal(view.revisions[0]?.parentComponentId, 4)
  assert.equal(view.revisions[1]?.parentComponentId, null)
  assert.equal(view.claims[0]?.reviewerUid, reviewer)
  assert.equal(view.claims[0]?.reviewedAtMicros, 1_700_000_000_000_000)
})

test('ignores a reviewer identity that is not a persisted identity', () => {
  const view = mapEvidenceInspection({
    targetKind: 'claim',
    targetId: 8,
    claims: [{ id: 8, reviewerUid: 'not an identity', reviewedAtMicros: '12' }],
  })
  assert.ok(view)
  assert.equal(view.claims[0]?.reviewerUid, null)
  assert.equal(view.claims[0]?.reviewedAtMicros, null)
})

