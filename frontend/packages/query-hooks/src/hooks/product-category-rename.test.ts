import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renameCategory } from './product-category-rename'

test('lost reply resolves one exact rename without redispatch on retry', async () => {
  let row = { id: '9007199254740993', name: 'Old' }; let writes = 0
  const read = async () => [row]
  const update = async () => { writes++; row = { ...row, name: 'Shop product references' }; throw new Error('reply lost') }
  const result = await renameCategory(row.id, 'Old', 'Shop product references', read, update)
  assert.equal(result.outcome, 'applied')
  assert.equal((await renameCategory(row.id, 'Old', 'Shop product references', read, update)).outcome, 'alreadyApplied')
  assert.equal(writes, 1)
})
test('missing, duplicate and stale exact identities reject before dispatch', async () => {
  let writes = 0
  for (const rows of [[], [{ id: '8', name: 'Other' }], [{ id: '8', name: 'Old' }, { id: '8', name: 'Old' }]]) {
    await assert.rejects(renameCategory('8', 'Old', 'New', async () => rows, async () => { writes++ }))
  }
  assert.equal(writes, 0)
})
test('accepted transport without saved name does not report success', async () => {
  await assert.rejects(renameCategory('8', 'Old', 'New', async () => [{ id: '8', name: 'Old' }], async () => undefined), /could not be confirmed/)
})
test('unreadable result remains uncertain and does not dispatch again', async () => {
  let reads = 0; let writes = 0
  await assert.rejects(renameCategory('8', 'Old', 'New', async () => {
    if (++reads > 1) throw new Error('Read denied')
    return [{ id: '8', name: 'Old' }]
  }, async () => { writes++ }), /Read denied/)
  assert.equal(writes, 1)
})
test('blank names reject before a read or mutation', async () => {
  await assert.rejects(renameCategory('8', 'Old', ' ', async () => { throw new Error('must not read') }, async () => undefined), /Enter a category name/)
})
