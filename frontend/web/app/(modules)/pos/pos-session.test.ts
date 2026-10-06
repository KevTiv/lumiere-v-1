import assert from 'node:assert/strict';
import test from 'node:test';

import { cashDifference, isPosSessionOpen, posSessionHref, posSessionStatusBar } from './pos-session';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

test('a session links to its own page', () => {
  assert.equal(posSessionHref({ id: 3 }), '/pos/sessions/3');
  assert.equal(posSessionHref({}), undefined);
});

test('the status bar follows the session state through its five stages', () => {
  assert.deepEqual(posSessionStatusBar({ state: 'Opened' }, t).steps.map((s) => s.id), [
    'newsession',
    'openingcontrol',
    'opened',
    'closingcontrol',
    'closed',
  ]);
  assert.equal(posSessionStatusBar({ state: { tag: 'Opened' } }, t).current, 'opened');
  assert.equal(posSessionStatusBar({ state: { tag: 'ClosingControl' } }, t).current, 'closingcontrol');
});

test('only a closed session is no longer open', () => {
  assert.equal(isPosSessionOpen({ state: 'Opened' }), true);
  assert.equal(isPosSessionOpen({ state: { tag: 'ClosingControl' } }), true);
  assert.equal(isPosSessionOpen({ state: 'Closed' }), false);
});

test('the cash difference is counted minus opening, rounded to cents', () => {
  assert.equal(cashDifference({ cashRegisterBalanceStart: 100, cashRegisterBalanceEndReal: 250.456 }), 150.46);
  assert.equal(cashDifference({ cash_register_balance_start: 10, cash_register_balance_end_real: 5 }), -5);
  assert.equal(cashDifference({}), null);
});
