import type { WorkspaceProfile } from '@lumiere/ui/lib/workspace-profile';

export const PRODUCT_CATALOG_TAB_IDS = ['products', 'product-categories'] as const;

export const WAREHOUSE_TAB_IDS = [
  'stock', 'lots', 'serials', 'transfers', 'stock-moves', 'adjustments',
  'cycle-counts', 'cycle-wizard', 'warehouses', 'locations', 'replenishment',
] as const;

/** Project only the admitted Inventory tabs; canonical resources and filters stay unchanged. */
export function inventoryWorkspaceModule(
  profile: WorkspaceProfile,
  moduleId: string,
  tabId: string,
): string {
  if (profile !== 'finance-alpha' || moduleId !== 'inventory') return moduleId;
  if ((PRODUCT_CATALOG_TAB_IDS as readonly string[]).includes(tabId)) return 'products';
  if ((WAREHOUSE_TAB_IDS as readonly string[]).includes(tabId)) return 'warehouse';
  return moduleId;
}
