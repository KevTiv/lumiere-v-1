import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPosOrdersPath,
  filterPosOrdersBySession,
  mergePosOrderPages,
  nextPosOrdersCursor,
  parsePosOrdersPage,
} from './pos-orders-pages';

test('path carries only the supported params', () => {
  assert.equal(buildPosOrdersPath({}), '/api/query/pos-orders');
  assert.equal(buildPosOrdersPath({ companyId: 7n, cursor: 'a b', limit: 25 }), '/api/query/pos-orders?companyId=7&cursor=a+b&limit=25');
});

test('envelope is parsed and malformed bodies throw', () => {
  assert.deepEqual(parsePosOrdersPage({ data: [{ id: 1 }, 3, null], nextCursor: 'c1' }), { rows: [{ id: 1 }], nextCursor: 'c1' });
  assert.equal(parsePosOrdersPage({ data: [], nextCursor: null }).nextCursor, null);
  assert.equal(parsePosOrdersPage({ data: [], nextCursor: '' }).nextCursor, null);
  assert.throws(() => parsePosOrdersPage({ data: 'x' }));
  assert.throws(() => parsePosOrdersPage([]));
});

test('pages merge in order without duplicate ids', () => {
  const merged = mergePosOrderPages([
    { rows: [{ id: 3 }, { id: 2 }], nextCursor: 'x' },
    { rows: [{ id: 2 }, { id: 1 }], nextCursor: null },
  ]);
  assert.deepEqual(merged.map((r) => r.id), [3, 2, 1]);
});

test('next cursor is that of the last page', () => {
  assert.equal(nextPosOrdersCursor([]), null);
  assert.equal(nextPosOrdersCursor([{ rows: [], nextCursor: 'a' }, { rows: [], nextCursor: null }]), null);
  assert.equal(nextPosOrdersCursor([{ rows: [], nextCursor: 'a' }]), 'a');
});

test('filters by session id across camel and snake case', () => {
  const rows = [{ id: 1, sessionId: 5 }, { id: 2, session_id: '5' }, { id: 3, sessionId: 6 }, { id: 4 }];
  assert.deepEqual(filterPosOrdersBySession(rows, 5n).map((r) => r.id), [1, 2]);
});
