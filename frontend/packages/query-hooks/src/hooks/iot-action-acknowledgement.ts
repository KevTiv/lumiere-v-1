import { parseStrictU64 } from '@lumiere/erp-shared/u64';

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from './operation-effect';

export type IotActionAcknowledgementProjection = {
  readonly id?: unknown;
  readonly organizationId?: unknown;
  readonly organization_id?: unknown;
  readonly status?: unknown;
  readonly acknowledgedAt?: unknown;
  readonly acknowledged_at?: unknown;
};

/** `status` is a plain string on `iot_action` (`Pending` | `Sent` | `Acknowledged` | `Failed`). */
function statusText(status: unknown): string {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object' && 'tag' in status && typeof status.tag === 'string') return status.tag;
  return '';
}

/**
 * COV-16: resolve the exact acknowledged action from a canonical readback: same id,
 * same organization, status `Acknowledged` and a non-null `acknowledged_at`.
 */
export function resolveAcknowledgedIotActionEffect(
  rows: readonly IotActionAcknowledgementProjection[],
  organizationId: bigint,
  actionId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === actionId);
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one IoT action, found ${matches.length}`);
  const row = matches[0];
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null;
  if (statusText(row.status) !== 'Acknowledged') return null;
  const acknowledgedAt = row.acknowledgedAt ?? row.acknowledged_at;
  if (acknowledgedAt == null || (typeof acknowledgedAt === 'object' && 'none' in acknowledgedAt)) return null;
  return { resource: 'iot-actions', id: actionId.toString() };
}
