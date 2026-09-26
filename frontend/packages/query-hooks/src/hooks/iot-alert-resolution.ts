import { parseStrictU64 } from '@lumiere/erp-shared/u64';

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from './operation-effect';

export type IotAlertResolutionProjection = {
  readonly id?: unknown;
  readonly organizationId?: unknown;
  readonly organization_id?: unknown;
  readonly resolvedAt?: unknown;
  readonly resolved_at?: unknown;
};

/** COV-16: resolve the exact resolved alert from a canonical readback. */
export function resolveResolvedIotAlertEffect(
  rows: readonly IotAlertResolutionProjection[],
  organizationId: bigint,
  alertId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === alertId);
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one IoT alert, found ${matches.length}`);
  const row = matches[0];
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null;
  if ((row.resolvedAt ?? row.resolved_at) == null) return null;
  return { resource: 'iot-alerts', id: alertId.toString() };
}
