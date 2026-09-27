import assert from 'node:assert/strict';
import test from 'node:test';

import { AmbiguousOperationEffectError } from './operation-effect';
import {
  resolveResolvedIotAlertEffect,
  type IotAlertResolutionProjection,
} from './iot-alert-resolution';

const resolvedAt = { __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000 };

const row = (
  id: bigint,
  organizationId: bigint,
  resolved: boolean,
): IotAlertResolutionProjection => ({ id, organizationId, resolvedAt: resolved ? resolvedAt : null });

test('returns the canonical ref for the exact resolved alert', () => {
  assert.deepEqual(
    resolveResolvedIotAlertEffect([row(4n, 1n, false), row(5n, 1n, true)], 1n, 5n),
    { resource: 'iot-alerts', id: '5' },
  );
});

test('accepts snake_case projection rows', () => {
  assert.deepEqual(
    resolveResolvedIotAlertEffect([{ id: '5', organization_id: '1', resolved_at: resolvedAt }], 1n, 5n),
    { resource: 'iot-alerts', id: '5' },
  );
});

test('returns null while the alert is unresolved', () => {
  assert.equal(resolveResolvedIotAlertEffect([row(5n, 1n, false)], 1n, 5n), null);
  assert.equal(resolveResolvedIotAlertEffect([{ id: 5n, organizationId: 1n }], 1n, 5n), null);
});

test('returns null for a missing or foreign-organization alert', () => {
  assert.equal(resolveResolvedIotAlertEffect([row(6n, 1n, true)], 1n, 5n), null);
  assert.equal(resolveResolvedIotAlertEffect([row(5n, 2n, true)], 1n, 5n), null);
});

test('throws on duplicate alert ids', () => {
  assert.throws(
    () => resolveResolvedIotAlertEffect([row(5n, 1n, true), row(5n, 1n, true)], 1n, 5n),
    AmbiguousOperationEffectError,
  );
});
