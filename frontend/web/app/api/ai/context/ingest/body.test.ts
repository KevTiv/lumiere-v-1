import assert from 'node:assert/strict'
import test from 'node:test'

import { parseActivityIngestBody } from './body'

const reference = (resource_id: unknown = '42') => ({ resource_kind: 'sale_order', resource_id })
const body = (resources: unknown = [reference()]) => ({ companyId: 7, resources })

test('indexing accepts only bounded canonical references, preserving full u64 identity', () => {
  assert.deepEqual(parseActivityIngestBody(body([reference('18446744073709551615')])), body([reference('18446744073709551615')]))
  for (const id of [0, 42, '', '0', '01', '-1', '1.0', '1e3', ' 1', '18446744073709551616']) {
    assert.throws(() => parseActivityIngestBody(body([reference(id)])))
  }
  for (const resources of [[], Array.from({ length: 9 }, (_, index) => reference(String(index + 1))), [reference(), reference()], [null]]) {
    assert.throws(() => parseActivityIngestBody(body(resources)))
  }
})

test('indexing rejects caller credentials, source text and unregistered table identities', () => {
  for (const injected of [{ org_id: 99 }, { identity_hex: 'forged' }, { stdb_token: 'forged' }, { text: 'private' }]) {
    assert.throws(() => parseActivityIngestBody({ ...body(), ...injected }))
  }
  assert.throws(() => parseActivityIngestBody(body([{ ...reference(), text: 'forged' }])))
  assert.throws(() => parseActivityIngestBody(body([{ resource_kind: 'private_table', resource_id: '1' }])))
  for (const companyId of [0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseActivityIngestBody({ ...body(), companyId }))
  }
})
