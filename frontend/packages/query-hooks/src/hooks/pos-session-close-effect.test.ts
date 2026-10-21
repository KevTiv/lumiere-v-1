import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveClosedPosSessionEffect,
  type PosConfigScopeProjection,
  type PosSessionCloseProjection,
} from './pos';
import { AmbiguousOperationEffectError } from './operation-effect';

const session: PosSessionCloseProjection = {
  id: '41',
  organizationId: '7',
  configId: '12',
  state: { tag: 'Closed' },
  cashRegisterBalanceEndReal: 125.5,
};

const config: PosConfigScopeProjection = {
  id: '12',
  organizationId: '7',
  companyId: '8',
};

describe('COV-13 POS session close exact effect', () => {
  it('resolves the same closed session through its exact config/company scope', () => {
    assert.deepEqual(
      resolveClosedPosSessionEffect(
        [session],
        [config],
        7n,
        8n,
        41n,
        125.5,
      ),
      {
        resource: 'pos-sessions',
        id: '41',
        configId: '12',
        companyId: '8',
        closingBalance: 125.5,
      },
    );
  });

  it('accepts SATS-key states and snake-case scope fields', () => {
    assert.deepEqual(
      resolveClosedPosSessionEffect(
        [
          {
            ...session,
            organizationId: undefined,
            organization_id: 7n,
            configId: undefined,
            config_id: 12n,
            state: { closed: [] },
            cashRegisterBalanceEndReal: undefined,
            cash_register_balance_end_real: 10,
          },
        ],
        [
          {
            id: 12n,
            organization_id: 7n,
            company_id: 8n,
          },
        ],
        7n,
        8n,
        41n,
        10,
      ),
      {
        resource: 'pos-sessions',
        id: '41',
        configId: '12',
        companyId: '8',
        closingBalance: 10,
      },
    );
  });

  it('fails closed for session scope, config scope, state, or closing balance mismatch', () => {
    assert.equal(
      resolveClosedPosSessionEffect(
        [{ ...session, organizationId: '9' }],
        [config],
        7n,
        8n,
        41n,
        125.5,
      ),
      null,
    );
    assert.equal(
      resolveClosedPosSessionEffect(
        [session],
        [{ ...config, companyId: '9' }],
        7n,
        8n,
        41n,
        125.5,
      ),
      null,
    );
    assert.equal(
      resolveClosedPosSessionEffect(
        [{ ...session, state: { tag: 'Opened' } }],
        [config],
        7n,
        8n,
        41n,
        125.5,
      ),
      null,
    );
    assert.equal(
      resolveClosedPosSessionEffect(
        [session],
        [config],
        7n,
        8n,
        41n,
        99,
      ),
      null,
    );
  });

  it('rejects duplicate exact session or config identities', () => {
    assert.throws(
      () =>
        resolveClosedPosSessionEffect(
          [session, { ...session }],
          [config],
          7n,
          8n,
          41n,
          125.5,
        ),
      AmbiguousOperationEffectError,
    );
    assert.throws(
      () =>
        resolveClosedPosSessionEffect(
          [session],
          [config, { ...config }],
          7n,
          8n,
          41n,
          125.5,
        ),
      AmbiguousOperationEffectError,
    );
  });
});
