import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GenerateSubscriptionInvoiceParams } from '@lumiere/stdb/types';

import {
  resolvePaidSubscriptionInvoiceEffect,
  resolveSubscriptionBillingRunEffect,
  subscriptionBillingRunKey,
} from './subscriptions';
import { AmbiguousOperationEffectError } from './operation-effect';

const run = {
  id: '71',
  organizationId: '7',
  companyId: '8',
  subscriptionId: '41',
  billingRunKey: 'run-41-2026-09',
  invoiceMoveId: '501',
};

const invoice = {
  id: '501',
  organizationId: '7',
  companyId: '8',
  moveType: { tag: 'OutInvoice' },
  state: { tag: 'Draft' },
  paymentState: { tag: 'NotPaid' },
  amountTotal: 100,
  amountResidual: 100,
};

describe('COV-12 subscription invoice exact effects', () => {
  it('derives the reducer default billing key from encoded invoice date', () => {
    const params = {
      invoice_date: {
        __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000,
      },
    } as unknown as GenerateSubscriptionInvoiceParams;

    assert.equal(
      subscriptionBillingRunKey(41n, params),
      'sub:41:period:1700000000',
    );
  });

  it('prefers an explicit billing key, including SATS option encoding', () => {
    assert.equal(
      subscriptionBillingRunKey(
        41n,
        {
          billing_run_key: { some: 'explicit-run' },
          invoice_date: {
            __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000,
          },
        } as unknown as GenerateSubscriptionInvoiceParams,
      ),
      'explicit-run',
    );
  });

  it('resolves one exact billing run to its scoped invoice move', () => {
    assert.deepEqual(
      resolveSubscriptionBillingRunEffect(
        [run],
        [invoice],
        7n,
        8n,
        41n,
        'run-41-2026-09',
      ),
      {
        resource: 'account-moves',
        id: '501',
        subscriptionId: '41',
        billingRunId: '71',
        billingRunKey: 'run-41-2026-09',
      },
    );
  });

  it('fails closed when run scope or invoice relation does not match', () => {
    assert.equal(
      resolveSubscriptionBillingRunEffect(
        [{ ...run, companyId: '9' }],
        [invoice],
        7n,
        8n,
        41n,
        'run-41-2026-09',
      ),
      null,
    );
    assert.equal(
      resolveSubscriptionBillingRunEffect(
        [run],
        [{ ...invoice, id: '999' }],
        7n,
        8n,
        41n,
        'run-41-2026-09',
      ),
      null,
    );
  });

  it('rejects duplicate exact run or invoice identity', () => {
    assert.throws(
      () =>
        resolveSubscriptionBillingRunEffect(
          [run, { ...run }],
          [invoice],
          7n,
          8n,
          41n,
          'run-41-2026-09',
        ),
      AmbiguousOperationEffectError,
    );
    assert.throws(
      () =>
        resolveSubscriptionBillingRunEffect(
          [run],
          [invoice, { ...invoice }],
          7n,
          8n,
          41n,
          'run-41-2026-09',
        ),
      AmbiguousOperationEffectError,
    );
  });

  it('resolves full and partial payment on the exact invoice move', () => {
    assert.deepEqual(
      resolvePaidSubscriptionInvoiceEffect(
        [
          {
            ...invoice,
            state: { posted: [] },
            paymentState: { paid: [] },
            amountResidual: 0,
          },
        ],
        7n,
        8n,
        41n,
        501n,
        0,
      ),
      {
        resource: 'account-moves',
        id: '501',
        subscriptionId: '41',
        residual: 0,
      },
    );

    assert.deepEqual(
      resolvePaidSubscriptionInvoiceEffect(
        [
          {
            ...invoice,
            state: 'Posted',
            paymentState: 'Partial',
            amountResidual: 40,
          },
        ],
        7n,
        8n,
        41n,
        501n,
        40,
      ),
      {
        resource: 'account-moves',
        id: '501',
        subscriptionId: '41',
        residual: 40,
      },
    );
  });
});
