import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecordNavigation } from './record-navigation';

const rows = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '10' }];
const base = { rows, basePath: '/x', labelOf: (r: { id: string }) => `R${r.id}` };

test('without a list context the default order is newest first', () => {
  const nav = buildRecordNavigation({ ...base, currentId: '3' });
  assert.equal(nav?.position, 2);
  assert.equal(nav?.total, 4);
  assert.deepEqual(nav?.previous, { href: '/x/10', label: 'R10' });
  assert.deepEqual(nav?.next, { href: '/x/2', label: 'R2' });
});

test('a list context sets the order and the total', () => {
  const nav = buildRecordNavigation({ ...base, currentId: '2', contextIds: ['3', '2', '1'] });
  assert.equal(nav?.position, 2);
  assert.equal(nav?.total, 3);
  assert.equal(nav?.previous?.href, '/x/3');
  assert.equal(nav?.next?.href, '/x/1');
});

test('ids that no longer exist are skipped', () => {
  const nav = buildRecordNavigation({ ...base, currentId: '2', contextIds: ['99', '2', '1'] });
  assert.equal(nav?.position, 1);
  assert.equal(nav?.previous, undefined);
  assert.equal(nav?.next?.href, '/x/1');
});

test('a context that does not hold the record falls back to the default order', () => {
  const nav = buildRecordNavigation({ ...base, currentId: '10', contextIds: ['1', '2'] });
  assert.equal(nav?.total, 4);
  assert.equal(nav?.position, 1);
});

test('a record outside the rows has no navigation', () => {
  assert.equal(buildRecordNavigation({ ...base, currentId: '7' }), undefined);
});

test('a page can set its own default order', () => {
  const nav = buildRecordNavigation({ ...base, currentId: '2', compare: (a, b) => Number(a.id) - Number(b.id) });
  assert.equal(nav?.previous?.href, '/x/1');
  assert.equal(nav?.next?.href, '/x/3');
});
