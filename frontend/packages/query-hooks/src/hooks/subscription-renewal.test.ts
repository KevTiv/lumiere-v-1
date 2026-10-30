import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeSubscriptionRenewal, requireMatchingRenewalCommand, resolveSubscriptionRenewalEffect } from './subscription-renewal';

const actor = 'ab'.repeat(32);
const request = { idempotencyKey: 'renewal-attempt-1', intervals: 2, notes: 'Extend support' };
const row = {
  id: '9007199254740993', organizationId: '7', companyId: '8', subscriptionId: '41', createdBy: actor,
  amendmentType: 'renew', version: 3, notes: request.notes,
  metadata: JSON.stringify({ idempotency_key: request.idempotencyKey, request_fingerprint: 'cd'.repeat(32) }),
  afterJson: JSON.stringify({ intervals: 2, recurring_next_date: 1_800_000_000 }),
};
const resolve = (rows = [row], input = request) => resolveSubscriptionRenewalEffect(rows, 7n, 8n, 41n, actor, input);

test('the encoded renewal command must match the retained key and payload before dispatch', () => {
  const encoded = { intervals: 2, idempotency_key: { some: request.idempotencyKey }, notes: { some: request.notes } };
  assert.doesNotThrow(() => requireMatchingRenewalCommand(encoded, request));
  for (const change of [{ intervals: 3 }, { idempotency_key: { some: 'different' } }, { notes: { none: [] } }]) {
    assert.throws(() => requireMatchingRenewalCommand({ ...encoded, ...change }, request), /does not match/);
  }
  assert.doesNotThrow(() => requireMatchingRenewalCommand({ ...encoded, notes: { none: [] } }, { ...request, notes: '' }));
});

test('renewal readback requires exact actor, tenant, company, subscription and request key', () => {
  assert.deepEqual(resolve(), { resource: 'subscription-amendments', id: row.id, subscriptionId: '41', version: 3, nextInvoiceSeconds: '1800000000' });
  for (const change of [{ organizationId: '9' }, { companyId: '9' }, { subscriptionId: '42' }, { createdBy: 'ef'.repeat(32) }, { amendmentType: 'amend' }, { metadata: '{}' }]) {
    assert.equal(resolve([{ ...row, ...change }]), null);
  }
  assert.equal(resolveSubscriptionRenewalEffect([{ ...row, createdBy: { __identity__: actor } }], 7n, 8n, 41n, actor, request)?.id, row.id);
});

test('renewal readback rejects duplicate receipts and changed payloads and treats masked evidence as unresolved', () => {
  assert.throws(() => resolve([row, row]), /Multiple immutable/);
  assert.throws(() => resolve([row], { ...request, intervals: 3 }), /different values/);
  assert.throws(() => resolve([row], { ...request, notes: 'Different note' }), /different values/);
  assert.equal(resolve([{ ...row, metadata: JSON.stringify({ idempotency_key: request.idempotencyKey }) }]), null);
  assert.equal(resolve([{ ...row, version: 0 }]), null);
  assert.throws(() => resolve([{ ...row, afterJson: '{}' }]), /different values/);
});

test('lost renewal response resolves its immutable receipt with one dispatch; recovery is read-only', async () => {
  let posts = 0;
  let saved = false;
  const resolveEffect = async () => saved ? resolve() : null;
  const dispatch = async () => { posts++; saved = true; throw new Error('connection lost after commit'); };
  const initial = await executeSubscriptionRenewal({ resolveEffect, dispatch, readbackDelayMs: 0 });
  assert.equal(initial.kind, 'converged');
  assert.equal(posts, 1);
  const resumed = await executeSubscriptionRenewal({ resolveEffect, dispatch, reconcileOnly: true });
  assert.equal(resumed.kind, 'already-applied');
  assert.equal(posts, 1);
  await assert.rejects(executeSubscriptionRenewal({ resolveEffect: async () => null, dispatch, reconcileOnly: true }), /remains unknown/);
  assert.equal(posts, 1);
});

test('denied or missing renewal readback cannot become success or trigger a reconciliation write', async () => {
  let posts = 0;
  const dispatch = async () => { posts++; throw new Error('lost'); };
  await assert.rejects(executeSubscriptionRenewal({ resolveEffect: async () => { throw new Error('Forbidden'); }, dispatch, reconcileOnly: true }), /Forbidden/);
  assert.equal(posts, 0);
  await assert.rejects(executeSubscriptionRenewal({ resolveEffect: async () => null, dispatch, readbackAttempts: 1 }), /unresolved/);
  assert.equal(posts, 1);
});
