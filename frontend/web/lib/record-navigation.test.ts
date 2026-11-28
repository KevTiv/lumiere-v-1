import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecordNavigation } from './record-navigation';
import { listRouteFromQuery, recordHrefWithListRoute, recordListRoute } from './record-list-route';

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

test('sibling links keep the originating list route', () => {
  const returnHref = '/sales?tab=orders&filter=state%3Asale';
  const nav = buildRecordNavigation({ ...base, currentId: '2', returnHref });
  const next = new URL(nav!.next!.href, 'https://example.test');
  assert.equal(next.pathname, '/x/1');
  assert.equal(next.searchParams.get('returnTo'), returnHref);
});

test('sales record links round-trip repeated route filters and strip action parameters', () => {
  const fallback = '/sales?tab=orders';
  const list = listRouteFromQuery(fallback, 'tab=orders&filter=state%3Asale&filter=teamId%3A3&activationForm=create');
  const record = new URL(recordHrefWithListRoute('/sales/orders/7', list), 'https://example.test');

  assert.equal(record.pathname, '/sales/orders/7');
  assert.equal(recordListRoute(record.searchParams.get('returnTo'), fallback), '/sales?tab=orders&filter=state%3Asale&filter=teamId%3A3');
});

test('the warehouse transfer returns to the originating workspace and tab', () => {
  const fallback = '/warehouse?tab=transfers';
  assert.equal(listRouteFromQuery(fallback, 'tab=transfers&filter=state%3Aassigned'), '/warehouse?tab=transfers&filter=state%3Aassigned');
  assert.equal(listRouteFromQuery(fallback, 'tab=stock&filter=state%3Aassigned'), fallback);
  assert.equal(recordListRoute('/inventory?tab=transfers&filter=state%3Aassigned', fallback), fallback);
});

test('a direct open or invalid return target keeps the canonical list', () => {
  const fallback = '/sales?tab=orders';
  for (const value of [null, '//another.test/sales?tab=orders', '/sales/orders?tab=orders', '/sales?tab=orders&tab=returns', '/sales?tab=orders&next=/settings']) {
    assert.equal(recordListRoute(value, fallback), fallback);
  }
  assert.equal(recordHrefWithListRoute('/sales/orders/7'), '/sales/orders/7');
});
