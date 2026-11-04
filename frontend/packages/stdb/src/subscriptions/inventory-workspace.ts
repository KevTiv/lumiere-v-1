import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Inventory list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 *
 * Bounded exception keys (`inventory-exceptions-short-atp`,
 * `inventory-exceptions-expired-lots`, `inventory-exceptions-open-qc`) use
 * server-side `extraWhere` filters in `ERP_ORG_SQL`.
 *
 * Intentionally excludes:
 * - `warehouse-3d` (orphan key; no registry/table)
 * - `inventory-valuations` (unused/mis-shaped table; avoid live fan-out)
 */
export const INVENTORY_WORKSPACE_RESOURCE_KEYS = [
  "adjustment-reasons",
  "barcode-nomenclatures",
  "barcode-rules",
  "cartonization-results",
  "inventory-adjustments",
  "inventory-exceptions",
  "inventory-exceptions-expired-lots",
  "inventory-exceptions-open-qc",
  "inventory-exceptions-short-atp",
  "packaging-materials",
  "picking-waves",
  "product-categories",
  "products",
  "quality-alerts",
  "quality-checks",
  "replenishment-rules",
  "serial-lot-traceability",
  "stock-cycle-counts",
  "stock-inventories",
  "stock-locations",
  "stock-moves",
  "stock-packages",
  "stock-pickings",
  "stock-production-lots",
  "stock-production-serials",
  "stock-quants",
  "stock-routes",
  "stock-rules",
  "stock-traceability-reports",
  "uoms",
  "warehouse-3d-zones",
  "warehouse-sync-intents",
  "warehouse-sync-intents-pending",
  "warehouse-tasks",
  "warehouses",
] as const;

export type InventoryWorkspaceResourceKey =
  (typeof INVENTORY_WORKSPACE_RESOURCE_KEYS)[number];

export type InventoryWorkspace = "inventory" | "products" | "warehouse";

/** Product masters have no stock, WMS or quality subscription requirement. */
export const PRODUCT_CATALOG_RESOURCE_KEYS = [
  "products", "product-categories", "uoms",
] as const satisfies readonly InventoryWorkspaceResourceKey[];

/** Includes supporting reads for the existing forms and stock-operation owners. */
export const WAREHOUSE_OPERATIONS_RESOURCE_KEYS = [
  "adjustment-reasons", "inventory-adjustments", "products", "replenishment-rules",
  "stock-cycle-counts", "stock-inventories", "stock-locations", "stock-moves",
  "stock-packages", "stock-pickings", "stock-production-lots",
  "stock-production-serials", "stock-quants", "uoms", "warehouses",
] as const satisfies readonly InventoryWorkspaceResourceKey[];

const WORKSPACE_RESOURCES = {
  inventory: INVENTORY_WORKSPACE_RESOURCE_KEYS,
  products: PRODUCT_CATALOG_RESOURCE_KEYS,
  warehouse: WAREHOUSE_OPERATIONS_RESOURCE_KEYS,
} as const;

/** Stable resource arrays retain full Inventory behavior for existing callers. */
export function inventoryWorkspaceResourceKeys(workspace: InventoryWorkspace = "inventory"): readonly InventoryWorkspaceResourceKey[] {
  return WORKSPACE_RESOURCES[workspace];
}

/** Presentation/read activation only; native read authorization remains authoritative. */
export function isInventoryWorkspaceReadEnabled(workspace: InventoryWorkspace, resource: string): boolean {
  if (workspace === "inventory") return true;
  if (workspace === "products" && ["product-supplier-infos", "product-packagings"].includes(resource)) return true;
  return inventoryWorkspaceResourceKeys(workspace).some((key) => key === resource);
}

export type InventoryWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
