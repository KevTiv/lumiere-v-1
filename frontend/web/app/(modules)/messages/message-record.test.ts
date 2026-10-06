import assert from 'node:assert/strict';
import test from 'node:test';

import { messageKind, messageRecordHref, messageRecordPageHref, messageTitle, optionalId, repliesTo } from './message-record';

test('a message links to its own page, and to the page of the record it is filed on', () => {
  assert.equal(messageRecordHref({ id: 5 }), '/messages/5');
  assert.equal(messageRecordHref({}), undefined);
  assert.equal(messageRecordPageHref({ model: 'sale_order', resId: 9 }), '/sales/orders/9');
  assert.equal(messageRecordPageHref({ model: 'lead', resId: 9 }), undefined);
});

test('optional ids read from numbers, strings and option cells', () => {
  assert.equal(optionalId(7), '7');
  assert.equal(optionalId({ some: 7 }), '7');
  assert.equal(optionalId({ none: [] }), undefined);
  assert.equal(optionalId(null), undefined);
  assert.equal(optionalId(''), undefined);
});

test('replies are the messages whose parent is this one, oldest first', () => {
  const messages = [
    { id: 3, parentId: 1, date: 30 },
    { id: 2, parent_id: { some: 1 }, date: 20 },
    { id: 4, parentId: 2, date: 40 },
    { id: 1, parentId: null, date: 10 },
  ];

  assert.deepEqual(repliesTo(messages, '1').map((row) => row.id), [2, 3]);
});

test('a title is the plain text of the body, shortened', () => {
  assert.equal(messageTitle({ id: 1, body: '<p>Hello   <b>world</b></p>' }), 'Hello world');
  assert.equal(messageTitle({ id: 1, body: 'x'.repeat(100) }, 10), `${'x'.repeat(9)}…`);
  assert.equal(messageTitle({ id: 8, body: '  ' }), '#8');
});

test('the message type reads as a lower-case word', () => {
  assert.equal(messageKind({ messageType: { tag: 'Comment' } }), 'comment');
  assert.equal(messageKind({}), 'message');
});
