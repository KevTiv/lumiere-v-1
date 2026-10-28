import type { ModuleConfig } from '@lumiere/ui';
import { variantTag } from '@lumiere/erp-workflows';

export type InventoryTab = ModuleConfig['tabs'][number];
export type ScalarId = bigint | number | string;

/** Preserve the inventory action gates for wire enums and plain state strings. */
export function rowState(
  row: { state?: unknown; status?: unknown },
  key: 'state' | 'status' = 'state',
): string {
  return variantTag(row[key]).toLowerCase();
}
