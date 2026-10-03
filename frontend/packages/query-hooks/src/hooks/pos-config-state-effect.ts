import { parseStrictU64 } from '@lumiere/erp-shared/u64';

import {
  AmbiguousOperationEffectError,
  type CanonicalRecordRef,
} from './operation-effect';

export interface PosConfigStateProjection {
  readonly id?: unknown;
  readonly organizationId?: unknown;
  readonly organization_id?: unknown;
  readonly isActive?: unknown;
  readonly is_active?: unknown;
}

export interface PosConfigStateRef extends CanonicalRecordRef {
  readonly resource: 'pos-configs';
  readonly isActive: boolean;
}

/** Resolve one POS config by its exact tenant-scoped identity and target state. */
export function resolvePosConfigStateEffect(
  configs: readonly PosConfigStateProjection[],
  organizationId: bigint,
  configId: bigint,
  isActive: boolean,
): PosConfigStateRef | null {
  const matches = configs.filter((row) => parseStrictU64(row.id) === configId);
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one POS config, found ${matches.length}`,
    );
  }
  const config = matches[0];
  if (
    !config ||
    parseStrictU64(config.organizationId ?? config.organization_id) !==
      organizationId ||
    (config.isActive ?? config.is_active) !== isActive
  ) {
    return null;
  }

  return {
    resource: 'pos-configs',
    id: configId.toString(),
    isActive,
  };
}
