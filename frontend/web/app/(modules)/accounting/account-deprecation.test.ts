import assert from 'node:assert/strict';
import test from 'node:test';

import { accountIsDeprecated, deprecateAccountParams } from './account-deprecation';

test('an active account is deprecated and a deprecated one reactivated', () => {
  assert.equal(accountIsDeprecated({ deprecated: true }), true);
  assert.equal(accountIsDeprecated({ deprecated: false }), false);
  assert.equal(accountIsDeprecated({}), false);
  assert.deepEqual(deprecateAccountParams({ id: 1, deprecated: false }, 5n), { companyId: 5n, deprecated: true });
  assert.deepEqual(deprecateAccountParams({ id: 1, deprecated: true }, 5n), { companyId: 5n, deprecated: false });
});

test('the account company wins over the operating company, and one is required', () => {
  assert.equal(deprecateAccountParams({ companyId: '9' }, 5n)?.companyId, 9n);
  assert.equal(deprecateAccountParams({}, 0n), null);
});
