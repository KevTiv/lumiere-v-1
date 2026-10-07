import assert from 'node:assert/strict';
import test from 'node:test';

import { commissionPlanRows, commissionSplitListRows, optionRowsForOrder } from './commission-plans';

test('plans carry their splits, resolved partner names and share total', () => {
  const rows = commissionPlanRows(
    [
      { id: 1n, name: 'Standard', isActive: true, defaultRatePercent: 5 },
      { id: 2n, name: 'Legacy', is_active: false, default_rate_percent: 3 },
    ],
    [
      { id: 10n, planId: 2n, partnerId: 7n, sharePercent: 60 },
      { id: 11n, plan_id: 2n, partner_id: 8n, share_percent: 40.5 },
      { id: 12n, planId: 99n, partnerId: 7n, sharePercent: 10 },
    ],
    new Map([['7', 'Acme']]),
  );
  assert.deepEqual(rows.map((r) => r.id), ['2', '1']);
  assert.equal(rows[0].isActive, false);
  assert.equal(rows[0].defaultRatePercent, 3);
  assert.equal(rows[0].splitCount, 2);
  assert.equal(rows[0].splitTotalPercent, 100.5);
  assert.deepEqual(rows[0].splits.map((s) => [s.partner, s.sharePercent]), [['Acme', 60], [null, 40.5]]);
  assert.equal(rows[1].splitCount, 0);
  assert.equal(rows[1].splitTotalPercent, null);
});

test('order options are those of the order, with the discounted subtotal', () => {
  const rows = optionRowsForOrder(
    4n,
    [
      { id: 2n, orderId: 4n, productId: 5n, name: 'Extended warranty', quantity: 2, priceUnit: 50, discount: 10, isPresent: false },
      { id: 1n, order_id: 4n, product_id: 6n, quantity: 1 },
      { id: 3n, orderId: 5n, productId: 5n, quantity: 1, priceUnit: 1 },
    ],
    new Map([['5', 'Warranty']]),
  );
  assert.deepEqual(rows.map((r) => r.id), ['1', '2']);
  assert.deepEqual(rows[0], {
    id: '1', product: null, description: null, quantity: 1, priceUnit: null, discount: null, subtotal: null, isPresent: false,
  });
  assert.equal(rows[1].product, 'Warranty');
  assert.equal(rows[1].subtotal, 90);
  assert.deepEqual(optionRowsForOrder(undefined, [], new Map()), []);
});

test('split list repeats the plan name on each split', () => {
  const plans = commissionPlanRows(
    [{ id: 1n, name: 'Standard' }],
    [{ id: 10n, planId: 1n, partnerId: 7n, sharePercent: 50 }],
    new Map([['7', 'Acme']]),
  );
  assert.deepEqual(commissionSplitListRows(plans), [{ id: '10', partner: 'Acme', sharePercent: 50, plan: 'Standard' }]);
});
