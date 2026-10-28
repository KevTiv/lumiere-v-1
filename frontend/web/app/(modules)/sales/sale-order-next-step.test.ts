import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saleOrderNextStep } from './sale-order-next-step';

test('quotation guidance follows products, send, acceptance and confirmation', () => {
  assert.equal(saleOrderNextStep({ state: 'Draft' }, [], true), 'add-products');
  assert.equal(saleOrderNextStep({ state: { tag: 'Draft' } }, [{ id: '1' }], true), 'send');
  assert.equal(saleOrderNextStep({ state: 'Sent' }, [{ id: '1' }], true), 'accept');
  assert.equal(saleOrderNextStep({ state: 'Sent', signed_by: 'Customer' }, [{ id: '1' }], true), 'confirm');
});

test('unreadable lines never masquerade as an empty quotation', () => {
  assert.equal(saleOrderNextStep({ state: 'Draft' }, [], false), 'unavailable');
  assert.equal(saleOrderNextStep({ state: 'Sent', signedBy: 'Customer' }, [{ id: '1' }], false), 'unavailable');
});

test('approval, cancellation and lock take precedence over editing', () => {
  assert.equal(saleOrderNextStep({ state: 'ToApprove' }, [], false), 'approval');
  assert.equal(saleOrderNextStep({ state: 'Cancelled', isLocked: true }, [], true), 'cancelled');
  assert.equal(saleOrderNextStep({ state: 'Draft', isLocked: true }, [], true), 'locked');
});

test('delivery invoicing waits for uninvoiced delivered quantities', () => {
  const order = { state: 'Sale', invoicePolicy: 'delivery' };
  assert.equal(saleOrderNextStep(order, [{ qtyDelivered: 0, qtyInvoiced: 0 }], true), 'delivery');
  assert.equal(saleOrderNextStep(order, [{ qtyDelivered: 2, qtyInvoiced: 2 }], true), 'delivery');
  assert.equal(saleOrderNextStep(order, [{ qtyDelivered: 2, qtyInvoiced: 1 }], true), 'invoice');
  assert.equal(saleOrderNextStep({ ...order, invoiceStatus: { tag: 'Invoiced' } }, [], true), 'review');
  assert.equal(saleOrderNextStep({ state: 'Sale', invoicePolicy: 'order' }, [{ id: '1' }], true), 'invoice');
});
