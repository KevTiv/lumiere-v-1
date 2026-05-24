import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Inventory list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const INVENTORY_WORKSPACE_RESOURCE_KEYS = [
  "adjustment-reasons",
  "barcode-nomenclatures",
  "barcode-rules",
  "inventory-adjustments",
  "inventory-valuations",
  "picking-waves",
  "product-categories",
  "products",
  "quality-checks",
  "replenishment-rules",
  "serial-lot-traceability",
  "stock-cycle-counts",
  "stock-inventories",
  "stock-locations",
  "stock-moves",
  "stock-pickings",
  "stock-production-lots",
  "stock-production-serials",
  "stock-quants",
  "stock-routes",
  "stock-rules",
  "stock-traceability-reports",
  "uoms",
  "warehouse-3d",
  "warehouse-3d-zones",
  "warehouse-tasks",
  "warehouses",
] as const;

export type InventoryWorkspaceResourceKey =
  (typeof INVENTORY_WORKSPACE_RESOURCE_KEYS)[number];

export type InventoryWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
