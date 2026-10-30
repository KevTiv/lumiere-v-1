import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRagGuideReferences } from './guide-references'

test('guide references preserve exact large u64 identities and discard supplied content', () => {
  assert.deepEqual(parseRagGuideReferences([
    { guideId: '9007199254740993', revision: 2, markdown: 'untrusted body', companyId: 'other' },
    { guideId: '18446744073709551615', revision: 1 },
    { guideId: '9007199254740993', revision: 2 },
  ]), [
    { guideId: '9007199254740993', revision: 2 },
    { guideId: '18446744073709551615', revision: 1 },
  ])
})

test('invalid or ambiguous guide identities fail instead of being silently coerced', () => {
  for (const guideId of [1, 9007199254740992, '0', '-1', '01', ' 1', '1e3', '1/../../', '18446744073709551616']) {
    assert.throws(() => parseRagGuideReferences([{ guideId, revision: 1 }]))
  }
  for (const revision of [0, -1, 1.5, '1', NaN, Infinity, 4_294_967_296]) {
    assert.throws(() => parseRagGuideReferences([{ guideId: '1', revision }]))
  }
})

test('guide reference collections are bounded and optional', () => {
  assert.equal(parseRagGuideReferences(undefined), undefined)
  assert.equal(parseRagGuideReferences([]), undefined)
  for (const raw of [null, '1', {}, [null], [[]], Array(5).fill({ guideId: '1', revision: 1 })]) {
    assert.throws(() => parseRagGuideReferences(raw))
  }
})
