import type { WorkspaceProfile } from '@lumiere/ui/lib/workspace-profile';
import { moduleTabHref } from '@lumiere/erp-shared/record-links';

/** Resolve return links from the active profile, including direct record opens and reloads. */
export function transferWorkspaceNavigation(profile: WorkspaceProfile) {
  const moduleId = profile === 'finance-alpha' ? 'warehouse' : 'inventory';
  return {
    moduleId,
    rootHref: `/${moduleId}`,
    transfersHref: moduleTabHref(moduleId, 'transfers'),
  };
}

/** Where a stock transfer's page lives. */
export function transferRecordHref(transfer: Record<string, unknown>): string | undefined {
  return transfer.id == null ? undefined : `/inventory/transfers/${String(transfer.id)}`;
}

/**
 * The backorders a transfer spawned when it was validated in part: pickings that point back at it
 * through `backorderId`, plus any ids the transfer lists in `backorderIds`.
 */
export function transferBackorders(
  transfer: Record<string, unknown>,
  pickings: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const id = transfer.id == null ? undefined : String(transfer.id);
  if (id === undefined) return [];
  const listed = new Set(
    (Array.isArray(transfer.backorderIds ?? transfer.backorder_ids) ? ((transfer.backorderIds ?? transfer.backorder_ids) as unknown[]) : []).map(
      (value) => String(value),
    ),
  );
  return pickings.filter((picking) => {
    const pickingId = String(picking.id);
    if (pickingId === id) return false;
    const parent = picking.backorderId ?? picking.backorder_id;
    return (parent != null && String(parent) === id) || listed.has(pickingId);
  });
}
