import assert from 'node:assert/strict';
import test from 'node:test';

import { AmbiguousOperationEffectError } from './operation-effect';
import {
  resolveAcknowledgedIotActionEffect,
  type IotActionAcknowledgementProjection,
} from './iot-action-acknowledgement';

const row = (extra: Partial<IotActionAcknowledgementProjection> = {}): IotActionAcknowledgementProjection => ({
  id: 5n,
  organizationId: 1n,
  status: 'Acknowledged',
  acknowledgedAt: { microsSinceUnixEpoch: 10n },
  ...extra,
});

test('resolves the exact acknowledged action', () => {
  assert.deepEqual(resolveAcknowledgedIotActionEffect([row({ id: 4n, status: 'Sent' }), row()], 1n, 5n), {
    resource: 'iot-actions',
    id: '5',
  });
});

test('accepts snake_case rows', () => {
  const rows = [{ id: '5', organization_id: '1', status: 'Acknowledged', acknowledged_at: '10' }];
  assert.deepEqual(resolveAcknowledgedIotActionEffect(rows, 1n, 5n), { resource: 'iot-actions', id: '5' });
});

test('returns null unless acknowledged with a timestamp, in the same organization', () => {
  for (const other of [
    row({ status: 'Sent' }),
    row({ status: 'Failed' }),
    row({ status: 'Pending' }),
    row({ acknowledgedAt: null }),
    row({ acknowledgedAt: { none: [] } }),
    row({ organizationId: 2n }),
  ]) {
    assert.equal(resolveAcknowledgedIotActionEffect([other], 1n, 5n), null);
  }
  assert.equal(resolveAcknowledgedIotActionEffect([row({ id: 6n })], 1n, 5n), null);
});

test('throws on duplicate action ids', () => {
  assert.throws(() => resolveAcknowledgedIotActionEffect([row(), row()], 1n, 5n), AmbiguousOperationEffectError);
});
