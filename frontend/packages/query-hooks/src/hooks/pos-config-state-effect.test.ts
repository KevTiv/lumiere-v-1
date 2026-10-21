import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolvePosConfigStateEffect,
  type PosConfigStateProjection,
} from './pos-config-state-effect';
import { AmbiguousOperationEffectError } from './operation-effect';

const activeConfig: PosConfigStateProjection = {
  id: '41',
  organizationId: '7',
  isActive: true,
};

describe('COV-D10 POS config state effect', () => {
  it('resolves the exact tenant-scoped config in the requested state', () => {
    assert.deepEqual(
      resolvePosConfigStateEffect([activeConfig], 7n, 41n, true),
      {
        resource: 'pos-configs',
        id: '41',
        isActive: true,
      },
    );
  });

  it('accepts snake-case projection fields', () => {
    assert.deepEqual(
      resolvePosConfigStateEffect(
        [{ id: 41n, organization_id: 7n, is_active: false }],
        7n,
        41n,
        false,
      ),
      {
        resource: 'pos-configs',
        id: '41',
        isActive: false,
      },
    );
  });

  it('fails closed for identity, tenant, or state mismatch', () => {
    assert.equal(
      resolvePosConfigStateEffect([activeConfig], 7n, 42n, true),
      null,
    );
    assert.equal(
      resolvePosConfigStateEffect([activeConfig], 8n, 41n, true),
      null,
    );
    assert.equal(
      resolvePosConfigStateEffect([activeConfig], 7n, 41n, false),
      null,
    );
  });

  it('rejects duplicate exact identities', () => {
    assert.throws(
      () =>
        resolvePosConfigStateEffect(
          [activeConfig, { ...activeConfig }],
          7n,
          41n,
          true,
        ),
      AmbiguousOperationEffectError,
    );
  });
});
